import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const NAME = "proxmox_list_templates";

const Schema = Type.Object(
  {
    node: Type.Optional(
      Type.String({ minLength: 1, description: "Node to query (defaults to first node)." }),
    ),
    storage: Type.Optional(
      Type.String({ minLength: 1, description: "Storage to query (defaults to 'local')." }),
    ),
    kind: Type.Optional(
      Type.Union(
        [Type.Literal("vztmpl"), Type.Literal("iso"), Type.Literal("both")],
        { description: "Template kind: 'vztmpl' (CT templates), 'iso' (VM ISOs), or 'both'. Defaults to 'both'." },
      ),
    ),
  },
  { additionalProperties: false },
);

interface NodeResource {
  node: string;
  type: string;
}

interface ContentEntry {
  volid: string;
  content?: string;
  size?: number;
  format?: string;
  ctime?: number;
}

type Kind = "vztmpl" | "iso" | "both";

export function createProxmoxListTemplatesTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: list templates",
    description:
      "List available LXC container templates (vztmpl) and/or VM ISOs on a node/storage (GET /nodes/{node}/storage/{storage}/content?content=vztmpl|iso). Defaults to both kinds on storage 'local'.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ node?: string; storage?: string; kind?: Kind }>(Schema, raw, NAME);
      const client = getClient();
      let node = args.node;
      if (!node) {
        const nodes = await client.get<NodeResource[]>("/cluster/resources?type=node");
        if (nodes.length === 0) throw new Error("no nodes found in cluster resources");
        node = nodes[0].node;
      }
      const storage = args.storage ?? "local";
      const kind: Kind = args.kind ?? "both";
      const out: { node: string; storage: string; container_templates?: ContentEntry[]; vm_isos?: ContentEntry[] } = {
        node,
        storage,
      };
      if (kind === "vztmpl" || kind === "both") {
        out.container_templates = await client.get<ContentEntry[]>(
          `/nodes/${node}/storage/${storage}/content?content=vztmpl`,
        );
      }
      if (kind === "iso" || kind === "both") {
        out.vm_isos = await client.get<ContentEntry[]>(
          `/nodes/${node}/storage/${storage}/content?content=iso`,
        );
      }
      return jsonToolResult(out);
    },
  };
}
