import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    confirm: Type.Boolean({
      description: "Must be true to write. Tier-2 safe-write gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_reboot_resource";

export function createProxmoxRebootResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: reboot resource",
    description:
      "Reboot an LXC container or QEMU VM by vmid (POST status/reboot). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; confirm: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.post<string>(
        `/nodes/${node}/${type}/${args.vmid}/status/reboot`,
        {},
      );
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
