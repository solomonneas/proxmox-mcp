import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "QEMU VM ID to validate as a smoke clone source." }),
    max_disk_gb: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum acceptable source disk size in GiB (default 64)." }),
    ),
    allow_running: Type.Optional(
      Type.Boolean({ description: "Allow running sources instead of requiring stopped/template state (default false)." }),
    ),
  },
  { additionalProperties: false },
);

interface ClusterResource {
  vmid: number;
  node: string;
  type: string;
  name?: string;
  status?: string;
  template?: number;
  maxdisk?: number;
  pool?: string;
  tags?: string;
}

const NAME = "proxmox_validate_qemu_smoke_source";
const GIB = 1024 ** 3;
const UNSAFE_PREFIXES = ["hostpci", "usb"];

function truthyProxmoxValue(value: unknown): boolean {
  if (value === 1 || value === true) return true;
  if (typeof value !== "string") return false;
  return value === "1" || value.startsWith("enabled=1") || value.split(",").includes("enabled=1");
}

function configKeysWithPrefixes(config: Record<string, unknown>, prefixes: string[]) {
  return Object.keys(config).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

function diskSizeGiB(resource: ClusterResource): number | undefined {
  return typeof resource.maxdisk === "number" ? resource.maxdisk / GIB : undefined;
}

export function createProxmoxValidateQemuSmokeSourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: validate QEMU smoke source",
    description:
      "Validate that a QEMU VM is a safe live-smoke clone source. Checks passthrough devices, guest agent, running state, and disk size before cloning.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number; max_disk_gb?: number; allow_running?: boolean }>(
        Schema,
        raw,
        NAME,
      );
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type !== "qemu") throw new Error(`vmid ${args.vmid} is ${type}, not qemu`);
      const resources = await client.get<ClusterResource[]>("/cluster/resources");
      const resource = resources.find((entry) => entry.vmid === args.vmid && entry.type === "qemu");
      if (!resource) throw new Error(`vmid ${args.vmid} not found in cluster resources as qemu`);
      const config = await client.get<Record<string, unknown>>(`/nodes/${node}/qemu/${args.vmid}/config`);
      const blockers: string[] = [];
      const warnings: string[] = [];
      const unsafeKeys = configKeysWithPrefixes(config, UNSAFE_PREFIXES);
      if (unsafeKeys.length > 0) {
        blockers.push(`unsafe passthrough/device config present: ${unsafeKeys.join(", ")}`);
      }
      if (typeof config.args === "string" && config.args.length > 0) {
        blockers.push("raw qemu args present");
      }
      if (!truthyProxmoxValue(config.agent)) {
        blockers.push("QEMU guest agent is not enabled in VM config");
      }
      const maxDiskGb = args.max_disk_gb ?? 64;
      const sizeGiB = diskSizeGiB(resource);
      if (typeof sizeGiB === "number" && sizeGiB > maxDiskGb) {
        blockers.push(`source disk is ${sizeGiB.toFixed(1)} GiB, over ${maxDiskGb} GiB limit`);
      }
      const isTemplate = resource.template === 1 || truthyProxmoxValue(config.template);
      if (!isTemplate && resource.status === "running" && args.allow_running !== true) {
        blockers.push("source VM is running; stop it first or pass allow_running:true");
      }
      if (!isTemplate && resource.status !== "stopped" && resource.status !== "running") {
        warnings.push(`source VM status is ${resource.status ?? "unknown"}`);
      }
      return jsonToolResult({
        vmid: args.vmid,
        node,
        ok: blockers.length === 0,
        blockers,
        warnings,
        resource: {
          name: resource.name,
          status: resource.status,
          template: resource.template === 1,
          pool: resource.pool,
          tags: resource.tags,
          disk_gb: typeof sizeGiB === "number" ? Number(sizeGiB.toFixed(1)) : undefined,
        },
        config_summary: {
          agent: config.agent,
          unsafe_keys: unsafeKeys,
          has_raw_args: typeof config.args === "string" && config.args.length > 0,
        },
      });
    },
  };
}
