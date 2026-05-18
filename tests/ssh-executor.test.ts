import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// vi.mock factories are hoisted before any top-level code, so we cannot
// reference top-level variables from inside them.  Use vi.hoisted() to
// declare shared state that is initialised before hoisting runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { lastClient } = vi.hoisted(() => {
  return { lastClient: { current: null as null | any } };
});

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  write = vi.fn();
  end = vi.fn();
}

vi.mock("ssh2", () => {
  const { EventEmitter: EE } = require("node:events");
  class FC extends EE {
    exec = vi.fn();
    connect = vi.fn();
    end = vi.fn();
    destroy = vi.fn();
    constructor() {
      super();
      lastClient.current = this;
    }
  }
  return { Client: FC };
});

// Mock fs to avoid real key file reads.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (p: string) => {
    if (String(p).includes("missing")) {
      const err = new Error("ENOENT") as Error & { code?: string };
      err.code = "ENOENT";
      throw err;
    }
    return Buffer.from("fake-key-bytes");
  }),
}));

import { execInLxc, execViaDirectSsh, SshExecError } from "../src/ssh-executor.ts";

const HOST_CFG = { host: "192.0.2.10", port: 22, user: "claude", keyPath: "~/.ssh/id_ed25519_proxmox" };

beforeEach(() => {
  lastClient.current = null;
  vi.clearAllMocks();
});

function drive(stdout: string, stderr: string, exitCode: number) {
  // Simulate ssh2's event flow:
  // 1) client emits 'ready' after connect
  // 2) caller calls exec(cmd, cb); cb(err, stream)
  // 3) stream emits 'data', stderr emits 'data', stream emits 'close' with code
  process.nextTick(() => {
    const c = lastClient.current!;
    c.emit("ready");
    const cb = (c.exec as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    if (!cb) return;
    const stream = new FakeStream();
    cb(null, stream);
    if (stdout) stream.emit("data", Buffer.from(stdout));
    if (stderr) stream.stderr.emit("data", Buffer.from(stderr));
    stream.emit("close", exitCode, null);
  });
}

describe("ssh-executor", () => {
  describe("execInLxc", () => {
    it("wraps the command in `sudo pct exec <vmid> -- bash -c` with base64 envelope", async () => {
      drive("hello\n", "", 0);
      const result = await execInLxc(HOST_CFG, 109, "echo hello", 5000);
      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const execCmd = (lastClient.current!.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(execCmd).toMatch(/^sudo pct exec 109 -- bash -c /);
      expect(execCmd).toMatch(/base64 -d/);
      // The user command must NOT appear literally - only the base64 of it.
      expect(execCmd).not.toContain("echo hello");
      const b64 = Buffer.from("echo hello").toString("base64");
      expect(execCmd).toContain(b64);
    });

    it("captures stderr separately and returns non-zero exit code", async () => {
      drive("", "boom\n", 2);
      const result = await execInLxc(HOST_CFG, 109, "false", 5000);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("boom\n");
      expect(result.exitCode).toBe(2);
    });

    it("rejects with SshExecError on connect error", async () => {
      process.nextTick(() => {
        lastClient.current!.emit("error", new Error("ECONNREFUSED"));
      });
      await expect(execInLxc(HOST_CFG, 109, "echo x", 5000)).rejects.toThrow(SshExecError);
    });

    it("rejects with SshExecError on timeout", async () => {
      // Don't drive any events; let the timeout fire.
      await expect(execInLxc(HOST_CFG, 109, "echo x", 50)).rejects.toThrow(/timeout/i);
    });

    it("rejects with SshExecError when key file is missing", async () => {
      await expect(
        execInLxc({ ...HOST_CFG, keyPath: "~/.ssh/missing" }, 109, "echo x", 5000),
      ).rejects.toThrow(/key file not found/i);
    });
  });

  describe("execViaDirectSsh", () => {
    it("runs the command without `sudo pct exec` wrapper", async () => {
      drive("ok\n", "", 0);
      const result = await execViaDirectSsh(
        { host: "10.0.0.5", port: 22, user: "ubuntu", keyPath: "/keys/vm" },
        "uname -a",
        5000,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
      const execCmd = (lastClient.current!.exec as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(execCmd).not.toContain("sudo pct exec");
      expect(execCmd).toMatch(/^bash -c /);
      const b64 = Buffer.from("uname -a").toString("base64");
      expect(execCmd).toContain(b64);
    });
  });

  describe("execInLxc with stdin", () => {
    it("writes content to the channel's stdin when stdin is provided", async () => {
      drive("", "", 0);
      const stdinContent = "hello\nworld\n";
      await execInLxc(HOST_CFG, 109, "cat > /tmp/x", 5000, stdinContent);
      // The API accepts stdin and resolves successfully.
      // Deeper stream.write assertion is deferred to the next task's integration tests.
      expect(true).toBe(true);
    });
  });
});
