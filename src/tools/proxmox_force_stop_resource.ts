import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertDestructive, assertEnvFlag } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID to hard-stop." }),
    confirm: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
    destructive: Type.Boolean({
      description: "Must be true. Tier-3 destructive gate.",
    }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_force_stop_resource";

export function createProxmoxForceStopResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: force stop resource",
    description:
      "Hard-kill an LXC container or QEMU VM (POST /nodes/{node}/{type}/{vmid}/status/stop). Unlike reboot/shutdown this is a non-graceful stop. Tier-3 destructive; requires confirm:true, destructive:true, and env PROXMOX_ENABLE_DESTRUCTIVE=1.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", NAME);
      assertDestructive(raw, NAME);
      const args = validateToolArgs<{ vmid: number; confirm: boolean; destructive: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.post<string>(
        `/nodes/${node}/${type}/${args.vmid}/status/stop`,
        {},
      );
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
