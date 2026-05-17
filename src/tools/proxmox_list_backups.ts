import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object(
  {
    node: Type.Optional(
      Type.String({ minLength: 1, description: "Node to query (defaults to first node)." }),
    ),
    vmid: Type.Optional(
      Type.Integer({ minimum: 1, description: "Filter backups to a single vmid (post-filter)." }),
    ),
  },
  { additionalProperties: false },
);

interface NodeResource {
  node: string;
  type: string;
}

interface Storage {
  storage: string;
  type?: string;
  content?: string;
  active?: number;
}

interface BackupEntry {
  volid: string;
  vmid?: number;
  size?: number;
  ctime?: number;
  format?: string;
  notes?: string;
  protected?: number;
}

export function createProxmoxListBackupsTool(getClient: ClientFactory) {
  return {
    name: "proxmox_list_backups",
    label: "proxmox: list backups",
    description:
      "List backup volumes on a node. Walks each backup-capable storage via GET /nodes/{node}/storage/{storage}/content?content=backup. Optionally filter by vmid.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = raw as { node?: string; vmid?: number };
      const client = getClient();
      let node = args.node;
      if (!node) {
        const nodes = await client.get<NodeResource[]>("/cluster/resources?type=node");
        if (nodes.length === 0) throw new Error("no nodes found in cluster resources");
        node = nodes[0].node;
      }
      const storages = await client.get<Storage[]>(`/nodes/${node}/storage?content=backup`);
      const all: Array<BackupEntry & { storage: string }> = [];
      for (const s of storages) {
        const entries = await client.get<BackupEntry[]>(
          `/nodes/${node}/storage/${s.storage}/content?content=backup`,
        );
        for (const e of entries) all.push({ ...e, storage: s.storage });
      }
      const filtered =
        args.vmid !== undefined ? all.filter((b) => b.vmid === args.vmid) : all;
      return jsonToolResult({ node, count: filtered.length, backups: filtered });
    },
  };
}
