import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    snapname: Type.String({
      minLength: 1,
      description: "Snapshot name (PVE convention: lowercase, no spaces).",
    }),
    description: Type.Optional(
      Type.String({ description: "Optional human description for the snapshot." }),
    ),
    confirm: Type.Boolean({
      description: "Must be true to write. Tier-2 safe-write gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_snapshot_resource";

export function createProxmoxSnapshotResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: snapshot resource",
    description:
      "Create a snapshot of an LXC container or QEMU VM by vmid (POST /snapshot with {snapname, description?}). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = raw as { vmid: number; snapname: string; description?: string };
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const body: Record<string, unknown> = { snapname: args.snapname };
      if (typeof args.description === "string" && args.description.length > 0) {
        body.description = args.description;
      }
      const upid = await client.post<string>(
        `/nodes/${node}/${type}/${args.vmid}/snapshot`,
        body,
      );
      return jsonToolResult({
        vmid: args.vmid,
        node,
        type,
        snapname: args.snapname,
        upid,
      });
    },
  };
}
