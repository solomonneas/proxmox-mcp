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
  const r = resources.find((x) => x.vmid === vmid && (x.type === "lxc" || x.type === "qemu"));
  if (!r) throw new Error(`vmid ${vmid} not found in cluster resources (not an LXC or VM)`);
  return { node: r.node, type: r.type as "lxc" | "qemu" };
}
