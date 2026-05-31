import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    node: Type.Optional(
      Type.String({ minLength: 1, description: "Node to query. Defaults to all nodes." }),
    ),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_list_storage";

interface NodeResource {
  node: string;
  type: string;
}

interface StorageEntry {
  storage: string;
  type?: string;
  content?: string;
  active?: number;
  enabled?: number;
  shared?: number;
  total?: number;
  used?: number;
  avail?: number;
}

export function createProxmoxListStorageTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list storage",
    description:
      "List Proxmox storage status on one node or all nodes via GET /nodes/{node}/storage.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown> = {}) => {
      const args = validateToolArgs<{ node?: string }>(Schema, raw, NAME);
      const client = getClient();
      let nodes: string[];
      if (args.node) {
        nodes = [args.node];
      } else {
        const resources = await client.get<NodeResource[]>("/cluster/resources?type=node");
        nodes = resources.map((n) => n.node);
        if (nodes.length === 0) throw new Error("no nodes found in cluster resources");
      }
      const results = [];
      for (const node of nodes) {
        const storage = await client.get<StorageEntry[]>(`/nodes/${node}/storage`);
        results.push({ node, storage });
      }
      return jsonToolResult({ count: results.reduce((sum, n) => sum + n.storage.length, 0), nodes: results });
    },
  };
}
