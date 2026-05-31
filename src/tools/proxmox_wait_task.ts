import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, parseTaskUpid, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    upid: Type.String({ minLength: 1, description: "Task UPID to wait for." }),
    timeoutSeconds: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, description: "Max wait time in seconds. Default 60." }),
    ),
    intervalMs: Type.Optional(
      Type.Integer({ minimum: 100, maximum: 10000, description: "Polling interval in milliseconds. Default 1000." }),
    ),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_wait_task";

interface TaskStatus {
  upid: string;
  node?: string;
  status?: string;
  exitstatus?: string;
  type?: string;
  id?: string;
}

export function createProxmoxWaitTaskTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: wait task",
    description:
      "Poll a Proxmox task by UPID until it stops or the timeout expires. Returns done:false on timeout with the last status.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ upid: string; timeoutSeconds?: number; intervalMs?: number }>(Schema, raw, NAME);
      const { node } = parseTaskUpid(args.upid);
      const timeoutMs = (args.timeoutSeconds ?? 60) * 1000;
      const intervalMs = args.intervalMs ?? 1000;
      const deadline = Date.now() + timeoutMs;
      const client = getClient();
      let polls = 0;
      let lastStatus: TaskStatus | null = null;
      while (Date.now() <= deadline) {
        polls += 1;
        lastStatus = await client.get<TaskStatus>(
          `/nodes/${node}/tasks/${encodeURIComponent(args.upid)}/status`,
        );
        if (lastStatus.status === "stopped" || lastStatus.exitstatus) {
          return jsonToolResult({ upid: args.upid, node, done: true, polls, status: lastStatus });
        }
        await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
      }
      return jsonToolResult({ upid: args.upid, node, done: false, polls, status: lastStatus });
    },
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
