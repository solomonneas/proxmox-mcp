import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { ClientFactory, SshExecutor, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { missingQemuSshHostMessage, qemuSshTarget, resolveQemuSshHost, type VmSshDefaults } from "./ssh-target.ts";
import { assertConfirmedWrite } from "../gates.ts";
import type { ExecResult } from "../ssh-executor.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute destination path inside the resource." }),
    content: Type.String({ description: "Text content to write." }),
    confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_write_file";

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function assertAbsoluteGuestPath(path: string, toolName: string): void {
  if (!path.startsWith("/")) throw new Error(`${toolName} path must be absolute`);
  if (path.includes("\0")) throw new Error(`${toolName} path cannot contain NUL bytes`);
}

export function createProxmoxWriteFileTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: write file to container or VM",
    description:
      "Write a text file to a path inside an LXC container or QEMU VM. Creates parent directories. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; path: string; content: string; confirm: boolean }>(Schema, raw, NAME);
      assertAbsoluteGuestPath(args.path, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const ssh = getSsh();
      const timeoutMs = 30_000;

      const parent = path.posix.dirname(args.path);
      const mkdirCmd = `mkdir -p -- ${shellSingleQuote(parent)}`;
      const writeCmd = `cat > ${shellSingleQuote(args.path)}`;

      const runOne = async (command: string, stdin?: string): Promise<ExecResult> => {
        if (type === "lxc") {
          return ssh.execInLxc(args.vmid, command, timeoutMs, stdin);
        }
        const host = await resolveQemuSshHost(client, node, args.vmid);
        if (!host) {
          throw new Error(missingQemuSshHostMessage(args.vmid));
        }
        return ssh.execViaDirectSsh(qemuSshTarget(args.vmid, host, vmDefaults), command, timeoutMs, stdin);
      };

      const mkdirResult = await runOne(mkdirCmd);
      if (mkdirResult.exitCode !== 0) {
        throw new Error(mkdirResult.stderr.trim() || `mkdir failed with exit code ${mkdirResult.exitCode}`);
      }
      const writeResult = await runOne(writeCmd, args.content);
      if (writeResult.exitCode !== 0) {
        throw new Error(writeResult.stderr.trim() || `write failed with exit code ${writeResult.exitCode}`);
      }
      return jsonToolResult({
        vmid: args.vmid,
        path: args.path,
        bytes_written: Buffer.byteLength(args.content, "utf8"),
      });
    },
  };
}
