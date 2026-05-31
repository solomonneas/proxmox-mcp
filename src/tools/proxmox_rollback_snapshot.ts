import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    snapname: Type.String({ minLength: 1, description: "Snapshot name to roll back to." }),
    start: Type.Optional(
      Type.Boolean({ description: "Start the resource after rollback completes (default false)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
    destructive: Type.Boolean({ description: "Must be true. Tier-3 destructive gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_rollback_snapshot";

export function createProxmoxRollbackSnapshotTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: rollback snapshot",
    description:
      "Roll back an LXC container or QEMU VM to a named snapshot. Tier-3 destructive because it reverts guest state; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        snapname: string;
        start?: boolean;
        confirm: boolean;
        destructive: boolean;
      }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.post<string>(
        `/nodes/${node}/${type}/${args.vmid}/snapshot/${encodeURIComponent(args.snapname)}/rollback`,
        { start: args.start ? 1 : 0 },
      );
      return jsonToolResult({ vmid: args.vmid, node, type, snapname: args.snapname, start: args.start === true, upid });
    },
  };
}
