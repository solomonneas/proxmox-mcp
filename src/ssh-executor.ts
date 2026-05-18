import { Client } from "ssh2";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

export interface SshHostConfig {
  host: string;
  port: number;
  user: string;
  keyPath: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type SshExecPhase = "connect" | "exec" | "timeout";

export class SshExecError extends Error {
  constructor(public phase: SshExecPhase, message: string) {
    super(`ssh ${phase}: ${message}`);
    this.name = "SshExecError";
  }
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  return p;
}

async function loadKey(keyPath: string): Promise<Buffer> {
  try {
    return await readFile(expandHome(keyPath));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new SshExecError("connect", `key file not found: ${keyPath}`);
    }
    throw new SshExecError("connect", `cannot read key file ${keyPath}: ${err.message}`);
  }
}

function base64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function buildLxcCommand(vmid: number, command: string): string {
  const b64 = base64(command);
  return `sudo pct exec ${vmid} -- bash -c "$(echo ${b64} | base64 -d)"`;
}

function buildDirectCommand(command: string): string {
  const b64 = base64(command);
  return `bash -c "$(echo ${b64} | base64 -d)"`;
}

async function runOverSsh(
  cfg: SshHostConfig,
  remoteCommand: string,
  timeoutMs: number,
  stdin?: string,
): Promise<ExecResult> {
  const key = await loadKey(cfg.keyPath);
  return new Promise<ExecResult>((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch {}
      try { conn.destroy(); } catch {}
      reject(new SshExecError("timeout", `command exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.end(); } catch {}
      resolve(result);
    };

    const fail = (phase: SshExecPhase, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.end(); } catch {}
      reject(new SshExecError(phase, message));
    };

    conn.on("error", (err: Error) => fail("connect", err.message));

    conn.on("ready", () => {
      conn.exec(remoteCommand, (err, stream) => {
        if (err) return fail("exec", err.message);
        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        stream.on("close", (code: number | null) => {
          finish({ stdout, stderr, exitCode: code ?? -1 });
        });
        if (stdin !== undefined) {
          stream.write(stdin);
          stream.end();
        }
      });
    });

    conn.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      privateKey: key,
      readyTimeout: timeoutMs,
    });
  });
}

export async function execInLxc(
  hostCfg: SshHostConfig,
  vmid: number,
  command: string,
  timeoutMs: number,
  stdin?: string,
): Promise<ExecResult> {
  return runOverSsh(hostCfg, buildLxcCommand(vmid, command), timeoutMs, stdin);
}

export async function execViaDirectSsh(
  targetCfg: SshHostConfig,
  command: string,
  timeoutMs: number,
  stdin?: string,
): Promise<ExecResult> {
  return runOverSsh(targetCfg, buildDirectCommand(command), timeoutMs, stdin);
}
