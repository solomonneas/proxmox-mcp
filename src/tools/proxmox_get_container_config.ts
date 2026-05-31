import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "LXC container ID." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_get_container_config";

export function createProxmoxGetContainerConfigTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: get container config",
    description:
      "Get LXC container config by vmid (GET /nodes/{node}/lxc/{vmid}/config). Fails if the vmid is not an LXC container.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type !== "lxc") throw new Error(`vmid ${args.vmid} is ${type}, not lxc`);
      const config = await client.get<Record<string, unknown>>(`/nodes/${node}/lxc/${args.vmid}/config`);
      return jsonToolResult({ vmid: args.vmid, node, type, config });
    },
  };
}
