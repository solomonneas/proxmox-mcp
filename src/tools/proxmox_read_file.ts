import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource } from "./_util.ts";
import type { ProxmoxClient } from "../proxmox-client.ts";
import type { SshHostConfig } from "../ssh-executor.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute file path inside the resource." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_read_file";

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

export function createProxmoxReadFileTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: read file from container or VM",
    description:
      "Read a file from inside an LXC container or QEMU VM. Tier-1 read; no confirm required.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = raw as { vmid: number; path: string };
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const command = `cat -- ${shellSingleQuote(args.path)}`;
      const ssh = getSsh();
      const timeoutMs = 30_000;
      let result;
      if (type === "lxc") {
        result = await ssh.execInLxc(args.vmid, command, timeoutMs);
      } else {
        const host = await resolveVmHost(client, node, args.vmid);
        if (!host) {
          throw new Error(
            `vmid ${args.vmid} is QEMU and has no PROXMOX_VM_${args.vmid}_SSH_HOST set and guest agent did not return a usable IP.`,
          );
        }
        result = await ssh.execViaDirectSsh(vmSshTarget(args.vmid, host, vmDefaults), command, timeoutMs);
      }
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `read_file failed with exit code ${result.exitCode}`);
      }
      return jsonToolResult({ vmid: args.vmid, path: args.path, content: result.stdout });
    },
  };
}
