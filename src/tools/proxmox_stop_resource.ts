import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    confirm: Type.Boolean({
      description: "Must be true to write. Tier-2 safe-write gate.",
    }),
    timeoutSeconds: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Optional shutdown timeout in seconds (passed through to PVE as `timeout`).",
      }),
    ),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_stop_resource";

export function createProxmoxStopResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: stop resource",
    description:
      "Gracefully shutdown an LXC container or QEMU VM by vmid (POST status/shutdown). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; timeoutSeconds?: number; confirm: boolean }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const body: Record<string, unknown> = {};
      if (typeof args.timeoutSeconds === "number") {
        body.timeout = args.timeoutSeconds;
      }
      const upid = await client.post<string>(
        `/nodes/${node}/${type}/${args.vmid}/status/shutdown`,
        body,
      );
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
