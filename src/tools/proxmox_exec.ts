import { Type } from "@sinclair/typebox";
import type { ClientFactory, SshExecutorFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";
import { missingQemuSshHostMessage, qemuSshTarget, resolveQemuSshHost, type VmSshDefaults } from "./ssh-target.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM id." }),
    command: Type.String({ minLength: 1, description: "Shell command to run inside the resource." }),
    timeout: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, description: "Timeout in seconds (default 30)." }),
    ),
    confirm: Type.Boolean({ description: "Must be true to execute. Tier-2 safe-write gate." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_exec";

export function createProxmoxExecTool(
  getClient: ClientFactory,
  getSsh: SshExecutorFactory,
  vmDefaults: VmSshDefaults,
) {
  return {
    name: NAME,
    label: "proxmox: exec in container or VM",
    description:
      "Run a shell command inside an LXC container (via SSH+pct exec) or QEMU VM (via direct SSH, IP from guest agent or env override). Returns stdout/stderr/exit_code. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{ vmid: number; command: string; timeout?: number; confirm: boolean }>(Schema, raw, NAME);
      const timeoutMs = (args.timeout ?? 30) * 1000;
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const ssh = getSsh();
      if (type === "lxc") {
        const result = await ssh.execInLxc(args.vmid, args.command, timeoutMs);
        return jsonToolResult({
          vmid: args.vmid,
          type,
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: result.exitCode,
        });
      }
      const host = await resolveQemuSshHost(client, node, args.vmid);
      if (!host) {
        throw new Error(missingQemuSshHostMessage(args.vmid));
      }
      const target = qemuSshTarget(args.vmid, host, vmDefaults);
      const result = await ssh.execViaDirectSsh(target, args.command, timeoutMs);
      return jsonToolResult({
        vmid: args.vmid,
        type,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
      });
    },
  };
}
