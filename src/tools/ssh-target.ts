import type { ProxmoxClient } from "../proxmox-client.ts";
import type { SshHostConfig } from "../ssh-executor.ts";

export interface VmSshDefaults {
  vmUser: string;
  vmKeyPath: string;
}

interface AgentIface {
  name?: string;
  "ip-addresses"?: Array<{ "ip-address-type"?: string; "ip-address"?: string }>;
}

function nonEmptyEnv(key: string): string | null {
  const value = process.env[key];
  return value && value.length > 0 ? value : null;
}

function usableIpv4(ip: string): boolean {
  if (ip.startsWith("127.")) return false;
  if (ip.startsWith("169.254.")) return false;
  if (ip === "0.0.0.0") return false;
  return true;
}

export async function resolveQemuSshHost(
  client: ProxmoxClient,
  node: string,
  vmid: number,
): Promise<string | null> {
  const envHost = nonEmptyEnv(`PROXMOX_VM_${vmid}_SSH_HOST`);
  if (envHost) return envHost;
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
        if (!usableIpv4(ip)) continue;
        return ip;
      }
    }
  } catch {
    // Guest agent unavailable. Callers produce the user-facing error.
  }
  return null;
}

export function qemuSshTarget(vmid: number, host: string, defaults: VmSshDefaults): SshHostConfig {
  return {
    host,
    port: 22,
    user: nonEmptyEnv(`PROXMOX_VM_${vmid}_SSH_USER`) ?? defaults.vmUser,
    keyPath: nonEmptyEnv(`PROXMOX_VM_${vmid}_SSH_KEY`) ?? defaults.vmKeyPath,
  };
}

export function missingQemuSshHostMessage(vmid: number): string {
  return (
    `vmid ${vmid} is QEMU and has no PROXMOX_VM_${vmid}_SSH_HOST set and guest agent did not return a usable IP. ` +
    `Install qemu-guest-agent in the VM and enable it with 'qm set ${vmid} --agent 1', or pin the IP via env.`
  );
}
