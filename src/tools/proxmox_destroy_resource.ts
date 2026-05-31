import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID to destroy." }),
    purge: Type.Optional(
      Type.Boolean({
        description: "Remove from PVE backup/replication config too (default true).",
      }),
    ),
    force: Type.Optional(
      Type.Boolean({
        description: "Allow destroying a running VM (default false).",
      }),
    ),
    confirm: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
    destructive: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_destroy_resource";

export function createProxmoxDestroyResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: destroy resource",
    description:
      "Permanently delete an LXC container or QEMU VM by vmid (DELETE /nodes/{node}/{type}/{vmid}). Tier-3 destructive; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        purge?: boolean;
        force?: boolean;
        confirm: boolean;
        destructive: boolean;
      }>(Schema, raw, NAME);
      const purge = args.purge !== false;
      const force = args.force === true;
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const params = new URLSearchParams();
      if (purge) {
        params.append("purge", "1");
        params.append("destroy-unreferenced-disks", "1");
      }
      // PVE: `force` is documented on LXC destroy but not on QEMU destroy.
      // Only emit it for LXC so QEMU rejects don't bounce on an unknown param.
      if (force && type === "lxc") params.append("force", "1");
      const qs = params.toString();
      const path = qs.length > 0
        ? `/nodes/${node}/${type}/${args.vmid}?${qs}`
        : `/nodes/${node}/${type}/${args.vmid}`;
      const upid = await client.delete<string>(path);
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
