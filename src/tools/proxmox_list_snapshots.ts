import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_list_snapshots";

interface SnapshotEntry {
  name: string;
  description?: string;
  snaptime?: number;
  parent?: string;
  vmstate?: boolean | number;
}

export function createProxmoxListSnapshotsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list snapshots",
    description:
      "List snapshots for one LXC container or QEMU VM via GET /nodes/{node}/{type}/{vmid}/snapshot.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const snapshots = await client.get<SnapshotEntry[]>(`/nodes/${node}/${type}/${args.vmid}/snapshot`);
      return jsonToolResult({ vmid: args.vmid, node, type, count: snapshots.length, snapshots });
    },
  };
}
