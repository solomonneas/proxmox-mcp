import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { missingQemuSshHostMessage, qemuSshTarget, resolveQemuSshHost, type VmSshDefaults } from "./ssh-target.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute file path inside the resource." }),
    confirm: Type.Boolean({ description: "Must be true to read files from inside a guest." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_read_file";

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function assertAbsoluteGuestPath(path: string, toolName: string): void {
  if (!path.startsWith("/")) throw new Error(`${toolName} path must be absolute`);
  if (path.includes("\0")) throw new Error(`${toolName} path cannot contain NUL bytes`);
}

export function createProxmoxReadFileTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: read file from container or VM",
    description:
      "Read a file from inside an LXC container or QEMU VM. Gated guest read; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; path: string; confirm: boolean }>(Schema, raw, NAME);
      assertAbsoluteGuestPath(args.path, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const command = `cat -- ${shellSingleQuote(args.path)}`;
      const ssh = getSsh();
      const timeoutMs = 30_000;
      let result;
      if (type === "lxc") {
        result = await ssh.execInLxc(args.vmid, command, timeoutMs);
      } else {
        const host = await resolveQemuSshHost(client, node, args.vmid);
        if (!host) {
          throw new Error(missingQemuSshHostMessage(args.vmid));
        }
        result = await ssh.execViaDirectSsh(qemuSshTarget(args.vmid, host, vmDefaults), command, timeoutMs);
      }
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `read_file failed with exit code ${result.exitCode}`);
      }
      return jsonToolResult({ vmid: args.vmid, path: args.path, content: result.stdout });
    },
  };
}
