import type { ProxmoxClient } from "../proxmox-client.ts";

export type ClientFactory = () => ProxmoxClient;

export function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export async function resolveResource(
  client: ProxmoxClient,
  vmid: number,
): Promise<{ node: string; type: "lxc" | "qemu" }> {
  const resources = await client.get<Array<{ vmid: number; node: string; type: string }>>(
    "/cluster/resources",
  );
  const matches = resources.filter((x) => x.vmid === vmid && (x.type === "lxc" || x.type === "qemu"));
  if (matches.length === 0) {
    throw new Error(`vmid ${vmid} not found in cluster resources (not an LXC or VM)`);
  }
  if (matches.length > 1) {
    const where = matches.map((m) => `${m.node}/${m.type}`).join(", ");
    throw new Error(`vmid ${vmid} ambiguous - found on multiple nodes: ${where}. Refusing to proceed.`);
  }
  return { node: matches[0].node, type: matches[0].type as "lxc" | "qemu" };
}
