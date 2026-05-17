import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource } from "./_util.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
  },
  { additionalProperties: false },
);

export function createProxmoxGetResourceTool(getClient: ClientFactory) {
  return {
    name: "proxmox_get_resource",
    label: "proxmox: get resource",
    description:
      "Get full current status for one LXC or VM by vmid (resolves node+type from cluster resources, then GET /nodes/{node}/{type}/{vmid}/status/current).",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = raw as { vmid: number };
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const status = await client.get<Record<string, unknown>>(
        `/nodes/${node}/${type}/${args.vmid}/status/current`,
      );
      return jsonToolResult({ vmid: args.vmid, node, type, status });
    },
  };
}
