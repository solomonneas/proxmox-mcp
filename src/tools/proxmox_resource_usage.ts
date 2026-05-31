import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const NAME = "proxmox_resource_usage";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
    timeframe: Type.Optional(
      Type.Union([Type.Literal("hour"), Type.Literal("day"), Type.Literal("week")], {
        description: "RRD timeframe window (default hour).",
      }),
    ),
  },
  { additionalProperties: false },
);

interface RrdSample {
  time: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
}

export function createProxmoxResourceUsageTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: resource usage",
    description:
      "Get historical CPU/memory/disk/network samples for one LXC or VM via GET /nodes/{node}/{type}/{vmid}/rrddata?timeframe=<hour|day|week>.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number; timeframe?: "hour" | "day" | "week" }>(Schema, raw, NAME);
      const timeframe = args.timeframe ?? "hour";
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const samples = await client.get<RrdSample[]>(
        `/nodes/${node}/${type}/${args.vmid}/rrddata?timeframe=${timeframe}`,
      );
      return jsonToolResult({ vmid: args.vmid, node, type, timeframe, samples });
    },
  };
}
