import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, parseTaskUpid, validateToolArgs } from "./_util.ts";

const NAME = "proxmox_get_task_log";

const Schema = Type.Object(
  {
    upid: Type.String({
      minLength: 1,
      description: "Task UPID returned by a prior write tool.",
    }),
    start: Type.Optional(
      Type.Integer({ minimum: 0, description: "Line offset to start from (default 0)." }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 500,
        description: "Max lines to return (default 50, max 500).",
      }),
    ),
  },
  { additionalProperties: false },
);

interface TaskLogLine {
  n: number;
  t: string;
}

export function createProxmoxGetTaskLogTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: get task log",
    description:
      "Tail a Proxmox task log by UPID via GET /nodes/{node}/tasks/{upid}/log?start=N&limit=M. Node is parsed from the UPID. Returns { lines, total }.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ upid: string; start?: number; limit?: number }>(Schema, raw, NAME);
      const { node } = parseTaskUpid(args.upid);
      const start = args.start ?? 0;
      const limit = args.limit ?? 50;
      const client = getClient();
      const lines = await client.get<TaskLogLine[]>(
        `/nodes/${node}/tasks/${encodeURIComponent(args.upid)}/log?start=${start}&limit=${limit}`,
      );
      return jsonToolResult({ lines, total: lines.length });
    },
  };
}
