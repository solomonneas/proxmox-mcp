import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { assertAbsoluteGuestPath, runGuestCommand, shellSingleQuote } from "./guest-command.ts";
import type { VmSshDefaults } from "./ssh-target.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    path: Type.String({ minLength: 1, description: "Absolute directory path inside the guest." }),
    confirm: Type.Boolean({ description: "Must be true to inspect guest directory contents." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_list_directory";

interface DirectoryEntry {
  name: string;
  kind: string;
  size: number;
  mtime: number;
}

function parseFindEntries(stdout: string): DirectoryEntry[] {
  if (stdout === "") return [];
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 4 !== 0) {
    throw new Error(`${NAME} unexpected find output: incomplete NUL-delimited record`);
  }

  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < fields.length; i += 4) {
    entries.push({
      name: fields[i],
      kind: fields[i + 1],
      size: Number(fields[i + 2]),
      mtime: Number(fields[i + 3]),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export function createProxmoxListDirectoryTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: list guest directory",
    description:
      "List one directory inside an LXC container or QEMU VM. Gated guest read; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; path: string; confirm: boolean }>(Schema, raw, NAME);
      assertAbsoluteGuestPath(args.path, NAME);
      const command = `find ${shellSingleQuote(args.path)} -mindepth 1 -maxdepth 1 -printf '%f\\0%y\\0%s\\0%T@\\0'`;
      const { node, type, result } = await runGuestCommand(
        getClient(),
        getSsh(),
        vmDefaults,
        args.vmid,
        command,
        30_000,
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `list_directory failed with exit code ${result.exitCode}`);
      }
      const entries = parseFindEntries(result.stdout);
      return jsonToolResult({ vmid: args.vmid, node, type, path: args.path, count: entries.length, entries });
    },
  };
}
