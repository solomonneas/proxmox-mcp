import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const NAME = "proxmox_get_resource";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
  },
  { additionalProperties: false },
);

export function createProxmoxGetResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: get resource",
    description:
      "Get full current status for one LXC or VM by vmid (resolves node+type from cluster resources, then GET /nodes/{node}/{type}/{vmid}/status/current).",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const status = await client.get<Record<string, unknown>>(
        `/nodes/${node}/${type}/${args.vmid}/status/current`,
      );
      return jsonToolResult({ vmid: args.vmid, node, type, status });
    },
  };
}
