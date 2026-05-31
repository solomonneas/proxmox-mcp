import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    source_vmid: Type.Integer({ minimum: 1, description: "Source CT/VM ID to clone from." }),
    new_vmid: Type.Integer({ minimum: 1, description: "VMID for the cloned resource." }),
    name: Type.String({ minLength: 1, description: "Name/hostname for the new clone." }),
    full: Type.Optional(
      Type.Boolean({ description: "Full clone (default true). Set false for a linked clone." }),
    ),
    storage: Type.Optional(
      Type.String({ minLength: 1, description: "Target storage (default: same as source)." }),
    ),
    target_node: Type.Optional(
      Type.String({ minLength: 1, description: "Optional target node for the clone." }),
    ),
    pool: Type.Optional(
      Type.String({ minLength: 1, description: "Optional resource pool ID for the clone." }),
    ),
    snapname: Type.Optional(
      Type.String({ minLength: 1, description: "Clone from a named snapshot (optional)." }),
    ),
    description: Type.Optional(
      Type.String({ description: "Optional description for the clone." }),
    ),
    confirm: Type.Boolean({
      description: "Must be true to write. Tier-2 safe-write gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_clone_resource";

export function createProxmoxCloneResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: clone resource",
    description:
      "Clone an existing LXC or QEMU resource by source_vmid to a new_vmid (POST /nodes/{node}/{type}/{source_vmid}/clone). Resolves source node/type from cluster resources. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        source_vmid: number;
        new_vmid: number;
        name: string;
        full?: boolean;
        storage?: string;
        target_node?: string;
        pool?: string;
        snapname?: string;
        description?: string;
        confirm: boolean;
      }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.source_vmid);
      const body: Record<string, unknown> = {
        newid: args.new_vmid,
        name: args.name,
        full: args.full !== false ? 1 : 0,
      };
      if (typeof args.storage === "string" && args.storage.length > 0) {
        body.storage = args.storage;
      }
      if (typeof args.target_node === "string" && args.target_node.length > 0) {
        body.target = args.target_node;
      }
      if (typeof args.pool === "string" && args.pool.length > 0) {
        body.pool = args.pool;
      }
      if (typeof args.snapname === "string" && args.snapname.length > 0) {
        body.snapname = args.snapname;
      }
      if (typeof args.description === "string" && args.description.length > 0) {
        body.description = args.description;
      }
      const upid = await client.post<string>(
        `/nodes/${node}/${type}/${args.source_vmid}/clone`,
        body,
      );
      return jsonToolResult({
        source_vmid: args.source_vmid,
        new_vmid: args.new_vmid,
        node,
        type,
        name: args.name,
        upid,
      });
    },
  };
}
