import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const NAME = "proxmox_recent_tasks";

const Schema = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 500, description: "Max tasks to return (default 25)." }),
    ),
    vmid: Type.Optional(
      Type.Integer({ minimum: 1, description: "Filter tasks by vmid (post-filter)." }),
    ),
  },
  { additionalProperties: false },
);

interface ClusterTask {
  upid: string;
  type: string;
  status?: string;
  node: string;
  user: string;
  starttime?: number;
  endtime?: number;
  id?: string;
  pid?: number;
}

export function createProxmoxRecentTasksTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: recent tasks",
    description:
      "List recent cluster tasks (UPID, type, status, node, user, timing) via GET /cluster/tasks. Optionally filter by vmid (post-filter client-side).",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ limit?: number; vmid?: number }>(Schema, raw, NAME);
      const limit = args.limit ?? 25;
      const client = getClient();
      const tasks = await client.get<ClusterTask[]>("/cluster/tasks");
      let filtered = tasks;
      if (args.vmid !== undefined) {
        const needle = String(args.vmid);
        filtered = tasks.filter((t) => {
          if (t.id === needle) return true;
          if (typeof t.upid === "string" && t.upid.includes(`:${needle}:`)) return true;
          return false;
        });
      }
      const trimmed = filtered.slice(0, limit);
      return jsonToolResult({ count: trimmed.length, tasks: trimmed });
    },
  };
}
