import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID to back up." }),
    storage: Type.String({
      minLength: 1,
      description: "PVE storage ID where the vzdump archive should be written.",
    }),
    mode: Type.Optional(
      Type.Union(
        [Type.Literal("snapshot"), Type.Literal("suspend"), Type.Literal("stop")],
        { description: "Backup mode. Defaults to 'snapshot'." },
      ),
    ),
    confirm: Type.Boolean({
      description: "Must be true to write. Tier-2 safe-write gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_run_backup";

type BackupMode = "snapshot" | "suspend" | "stop";

export function createProxmoxRunBackupTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: run backup",
    description:
      "Trigger a vzdump backup of a single vmid to a target storage (POST /nodes/{node}/vzdump with {vmid, storage, mode, compress:'zstd'}). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        storage: string;
        mode?: BackupMode;
        confirm: boolean;
      }>(Schema, raw, NAME);
      const mode: BackupMode = args.mode ?? "snapshot";
      const client = getClient();
      const { node } = await resolveResource(client, args.vmid);
      const upid = await client.post<string>(`/nodes/${node}/vzdump`, {
        vmid: args.vmid,
        storage: args.storage,
        mode,
        compress: "zstd",
      });
      return jsonToolResult({
        vmid: args.vmid,
        node,
        storage: args.storage,
        mode,
        upid,
      });
    },
  };
}
