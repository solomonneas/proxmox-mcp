import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ProxmoxClient } from "../proxmox-client.ts";
import type { ExecResult, SshHostConfig } from "../ssh-executor.ts";

export type ClientFactory = () => ProxmoxClient;

export interface SshExecutor {
  execInLxc(vmid: number, command: string, timeoutMs: number, stdin?: string): Promise<ExecResult>;
  execViaDirectSsh(targetCfg: SshHostConfig, command: string, timeoutMs: number, stdin?: string): Promise<ExecResult>;
}

export type SshExecutorFactory = () => SshExecutor;

export function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export function validateToolArgs<T extends object>(
  schema: TSchema,
  raw: Record<string, unknown>,
  toolName: string,
): T {
  if (Value.Check(schema, raw)) return raw as unknown as T;
  const first = [...Value.Errors(schema, raw)][0];
  const where = first?.path ? ` at ${first.path}` : "";
  const message = first?.message ?? "input does not match schema";
  throw new ToolInputError(`${toolName} invalid input${where}: ${message}`);
}

// Proxmox node/storage/pool identifiers are restricted to a conservative
// charset. Validating tool-supplied segments before they are interpolated into
// an API request path blocks request-path injection (slashes, '?', '#', '..').
const SAFE_SEGMENT_RE = /^[\w.-]+$/;

export function assertSafePathSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT_RE.test(value)) {
    throw new ToolInputError(
      `invalid ${label} "${value}": expected only letters, digits, '_', '.', or '-'`,
    );
  }
  return value;
}

export async function resolveResource(
  client: ProxmoxClient,
  vmid: number,
): Promise<{ node: string; type: "lxc" | "qemu" }> {
  const resources = await client.get<Array<{ vmid: number; node: string; type: string }>>(
    "/cluster/resources",
  );
  const matches = resources.filter((x) => x.vmid === vmid && (x.type === "lxc" || x.type === "qemu"));
  if (matches.length === 0) {
    throw new Error(`vmid ${vmid} not found in cluster resources (not an LXC or VM)`);
  }
  if (matches.length > 1) {
    const where = matches.map((m) => `${m.node}/${m.type}`).join(", ");
    throw new Error(`vmid ${vmid} ambiguous - found on multiple nodes: ${where}. Refusing to proceed.`);
  }
  return { node: matches[0].node, type: matches[0].type as "lxc" | "qemu" };
}

export function parseTaskUpid(upid: string): { node: string } {
  if (typeof upid !== "string" || !upid.startsWith("UPID:")) {
    throw new Error(`invalid UPID format: ${upid}`);
  }
  const parts = upid.split(":");
  if (parts.length < 8) throw new Error(`invalid UPID format: ${upid}`);
  const node = parts[1];
  if (!node) throw new Error(`UPID missing node segment: ${upid}`);
  return { node };
}
