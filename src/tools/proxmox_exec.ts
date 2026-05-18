import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import type { ProxmoxClient } from "../proxmox-client.ts";
import type { SshHostConfig } from "../ssh-executor.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    command: Type.String({ minLength: 1, description: "Shell command to run inside the resource." }),
    timeout: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, description: "Timeout in seconds (default 30)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to execute. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_exec";

export interface VmSshDefaults {
  vmUser: string;
  vmKeyPath: string;
}

interface AgentIface {
  name?: string;
  "hardware-address"?: string;
  "ip-addresses"?: Array<{ "ip-address-type"?: string; "ip-address"?: string }>;
}

async function resolveVmHost(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<string | null> {
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
    // guest agent unavailable - fall through
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

export function createProxmoxExecTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: exec in container or VM",
    description:
      "Run a shell command inside an LXC container (via SSH+pct exec) or QEMU VM (via direct SSH, IP from guest agent or env override). Returns stdout/stderr/exit_code. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = raw as { vmid: number; command: string; timeout?: number };
      const timeoutMs = (args.timeout ?? 30) * 1000;
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const ssh = getSsh();
      if (type === "lxc") {
        const result = await ssh.execInLxc(args.vmid, args.command, timeoutMs);
        return jsonToolResult({
          vmid: args.vmid,
          type,
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: result.exitCode,
        });
      }
      const host = await resolveVmHost(client, node, args.vmid);
      if (!host) {
        throw new Error(
          `vmid ${args.vmid} is QEMU and has no PROXMOX_VM_${args.vmid}_SSH_HOST set and guest agent did not return a usable IP. Install qemu-guest-agent in the VM (and enable it on the VM config with 'qm set ${args.vmid} --agent 1'), or pin the IP via env.`,
        );
      }
      const target = vmSshTarget(args.vmid, host, vmDefaults);
      const result = await ssh.execViaDirectSsh(target, args.command, timeoutMs);
      return jsonToolResult({
        vmid: args.vmid,
        type,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
      });
    },
  };
}
