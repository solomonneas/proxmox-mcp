import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    snapname: Type.String({
      minLength: 1,
      description: "Snapshot name to delete.",
    }),
    confirm: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
    destructive: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_delete_snapshot";

export function createProxmoxDeleteSnapshotTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: delete snapshot",
    description:
      "Delete a named snapshot from an LXC container or QEMU VM (DELETE /nodes/{node}/{type}/{vmid}/snapshot/{snapname}). Tier-3 destructive; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{ vmid: number; snapname: string; confirm: boolean; destructive: boolean }>(
        Schema,
        raw,
        NAME,
      );
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.delete<string>(
        `/nodes/${node}/${type}/${args.vmid}/snapshot/${encodeURIComponent(args.snapname)}`,
      );
      return jsonToolResult({ vmid: args.vmid, node, type, snapname: args.snapname, upid });
    },
  };
}
