import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "QEMU VM ID." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_get_vm_config";

export function createProxmoxGetVmConfigTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: get VM config",
    description:
      "Get QEMU VM config by vmid (GET /nodes/{node}/qemu/{vmid}/config). Fails if the vmid is not a QEMU VM.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type !== "qemu") throw new Error(`vmid ${args.vmid} is ${type}, not qemu`);
      const config = await client.get<Record<string, unknown>>(`/nodes/${node}/qemu/${args.vmid}/config`);
      return jsonToolResult({ vmid: args.vmid, node, type, config });
    },
  };
}
