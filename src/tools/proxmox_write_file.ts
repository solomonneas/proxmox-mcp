import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { ClientFactory, SshExecutor, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import type { ProxmoxClient } from "../proxmox-client.ts";
import type { ExecResult, SshHostConfig } from "../ssh-executor.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute destination path inside the resource." }),
    content: Type.String({ description: "Text content to write." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_write_file";

export interface VmSshDefaults {
  vmUser: string;
  vmKeyPath: string;
}

interface AgentIface {
  name?: string;
  "ip-addresses"?: Array<{ "ip-address-type"?: string; "ip-address"?: string }>;
}

async function resolveVmHost(client: ProxmoxClient, node: string, vmid: number): Promise<string | null> {
  const envHost = process.env[`PROXMOX_VM_${vmid}_SSH_HOST`];
  if (envHost && envHost.length > 0) return envHost;
  try {
    const data = await client.get<{ result?: AgentIface[] }>(
      `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
    );
    const ifaces = data?.result ?? [];
    for (const iface of ifaces) {
      if (iface.name === "lo") continue;
      const ips = iface["ip-addresses"] ?? [];
      for (const entry of ips) {
        const ip = entry["ip-address"];
        if (!ip) continue;
        if (entry["ip-address-type"] !== "ipv4") continue;
        if (ip.startsWith("127.")) continue;
        return ip;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

function vmSshTarget(vmid: number, host: string, defaults: VmSshDefaults): SshHostConfig {
  const userEnv = process.env[`PROXMOX_VM_${vmid}_SSH_USER`];
  const keyEnv = process.env[`PROXMOX_VM_${vmid}_SSH_KEY`];
  return {
    host,
    port: 22,
    user: (userEnv && userEnv.length > 0) ? userEnv : defaults.vmUser,
    keyPath: (keyEnv && keyEnv.length > 0) ? keyEnv : defaults.vmKeyPath,
  };
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function createProxmoxWriteFileTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: write file to container or VM",
    description:
      "Write a text file to a path inside an LXC container or QEMU VM. Creates parent directories. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = raw as { vmid: number; path: string; content: string };
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const ssh = getSsh();
      const timeoutMs = 30_000;

      const parent = path.posix.dirname(args.path);
      const mkdirCmd = `mkdir -p -- ${shellSingleQuote(parent)}`;
      const writeCmd = `cat > ${shellSingleQuote(args.path)}`;

      const runOne = async (command: string, stdin?: string): Promise<ExecResult> => {
        if (type === "lxc") {
          return ssh.execInLxc(args.vmid, command, timeoutMs, stdin);
        }
        const host = await resolveVmHost(client, node, args.vmid);
        if (!host) {
          throw new Error(
            `vmid ${args.vmid} is QEMU and has no PROXMOX_VM_${args.vmid}_SSH_HOST set and guest agent did not return a usable IP.`,
          );
        }
        return ssh.execViaDirectSsh(vmSshTarget(args.vmid, host, vmDefaults), command, timeoutMs, stdin);
      };

      const mkdirResult = await runOne(mkdirCmd);
      if (mkdirResult.exitCode !== 0) {
        throw new Error(mkdirResult.stderr.trim() || `mkdir failed with exit code ${mkdirResult.exitCode}`);
      }
      const writeResult = await runOne(writeCmd, args.content);
      if (writeResult.exitCode !== 0) {
        throw new Error(writeResult.stderr.trim() || `write failed with exit code ${writeResult.exitCode}`);
      }
      return jsonToolResult({
        vmid: args.vmid,
        path: args.path,
        bytes_written: Buffer.byteLength(args.content, "utf8"),
      });
    },
  };
}
