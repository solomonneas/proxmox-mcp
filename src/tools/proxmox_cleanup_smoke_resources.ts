import { Type } from "@sinclair/typebox";
import type { ProxmoxClient } from "../proxmox-client.ts";
import { jsonToolResult, parseTaskUpid, validateToolArgs } from "./_util.ts";
import type { ClientFactory } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";
import type { PoolMember } from "./proxmox_list_pool_resources.ts";

const Schema = Type.Object(
  {
    pool: Type.Optional(
      Type.String({ minLength: 1, description: "Pool ID to clean up (default mcp-smoke)." }),
    ),
    name_prefix: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Only delete guest names starting with this prefix (default mcp-smoke-).",
      }),
    ),
    force: Type.Optional(
      Type.Boolean({
        description: "Allow deleting running smoke guests. Also passes force=1 for LXC cleanup (default false).",
      }),
    ),
    dry_run: Type.Optional(
      Type.Boolean({ description: "Preview matching targets without deleting them (default true)." }),
    ),
    wait: Type.Optional(
      Type.Boolean({ description: "Wait for delete tasks to finish when dry_run:false (default true)." }),
    ),
    confirm: Type.Optional(
      Type.Boolean({ description: "Must be true when dry_run:false. Tier-3 destructive gate." }),
    ),
    destructive: Type.Optional(
      Type.Boolean({ description: "Must be true when dry_run:false. Tier-3 destructive gate." }),
    ),
    timeoutSeconds: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, description: "Max seconds to wait per delete task (default 180)." }),
    ),
    intervalMs: Type.Optional(
      Type.Integer({ minimum: 100, maximum: 10000, description: "Task polling interval in milliseconds (default 1000)." }),
    ),
  },
  { additionalProperties: false },
);

interface TaskStatus {
  upid: string;
  node?: string;
  status?: string;
  exitstatus?: string;
  type?: string;
  id?: string;
}

interface PoolDetail {
  members?: PoolMember[];
}

interface CleanupTarget {
  vmid: number;
  node: string;
  type: "lxc" | "qemu";
  name: string;
  status?: string;
}

interface DestroyedTarget extends CleanupTarget {
  upid: string;
  wait?: Awaited<ReturnType<typeof waitForTask>>;
}

const NAME = "proxmox_cleanup_smoke_resources";

function normalizeType(type: string | undefined): "lxc" | "qemu" | null {
  if (type === "qemu") return "qemu";
  if (type === "lxc" || type === "openvz") return "lxc";
  return null;
}

function targetFromMember(member: PoolMember, namePrefix: string): CleanupTarget | null {
  const type = normalizeType(member.type);
  const name = member.name ?? "";
  if (!type || typeof member.vmid !== "number" || !member.node || !name.startsWith(namePrefix)) return null;
  return {
    vmid: member.vmid,
    node: member.node,
    type,
    name,
    status: member.status,
  };
}

async function waitForTask(client: ProxmoxClient, upid: string, timeoutSeconds: number, intervalMs: number) {
  const { node } = parseTaskUpid(upid);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let polls = 0;
  let status: TaskStatus | null = null;
  while (Date.now() <= deadline) {
    polls += 1;
    status = await client.get<TaskStatus>(`/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
    if (status.status === "stopped" || status.exitstatus) {
      return { upid, node, done: true, polls, status };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  return { upid, node, done: false, polls, status };
}

export function createProxmoxCleanupSmokeResourcesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: cleanup smoke resources",
    description:
      "Preview or destroy smoke-test LXC/QEMU resources from a pool when their names match the smoke prefix. Defaults to dry_run:true. Actual deletion requires dry_run:false, confirm:true, destructive:true, and PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{
        pool?: string;
        name_prefix?: string;
        force?: boolean;
        dry_run?: boolean;
        wait?: boolean;
        confirm?: boolean;
        destructive?: boolean;
        timeoutSeconds?: number;
        intervalMs?: number;
      }>(Schema, raw, NAME);
      const pool = args.pool ?? "mcp-smoke";
      const namePrefix = args.name_prefix ?? "mcp-smoke-";
      const force = args.force === true;
      const dryRun = args.dry_run !== false;
      const wait = args.wait !== false;
      const client = getClient();
      const detail = await client.get<PoolDetail>(`/pools/${encodeURIComponent(pool)}`);
      const members = Array.isArray(detail.members) ? detail.members : [];
      const targets = members
        .map((member) => targetFromMember(member, namePrefix))
        .filter((target): target is CleanupTarget => target !== null);
      const running = targets.filter((target) => target.status === "running");
      const deleteTargets = force ? targets : targets.filter((target) => target.status !== "running");
      const skippedRunning = force ? [] : running;
      if (dryRun) {
        return jsonToolResult({
          pool,
          name_prefix: namePrefix,
          dry_run: true,
          matched: targets.length,
          targets,
          skipped_running: skippedRunning,
          skipped: members.length - targets.length + skippedRunning.length,
        });
      }
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const destroyed: DestroyedTarget[] = [];
      for (const target of deleteTargets) {
        const params = new URLSearchParams();
        params.append("purge", "1");
        params.append("destroy-unreferenced-disks", "1");
        if (force && target.type === "lxc") params.append("force", "1");
        const upid = await client.delete<string>(
          `/nodes/${target.node}/${target.type}/${target.vmid}?${params.toString()}`,
        );
        const entry: DestroyedTarget = { ...target, upid };
        if (wait) {
          entry.wait = await waitForTask(client, upid, args.timeoutSeconds ?? 180, args.intervalMs ?? 1000);
        }
        destroyed.push(entry);
      }
      return jsonToolResult({
        pool,
        name_prefix: namePrefix,
        dry_run: false,
        matched: targets.length,
        destroyed,
        skipped_running: skippedRunning,
        skipped: members.length - targets.length + skippedRunning.length,
      });
    },
  };
}
