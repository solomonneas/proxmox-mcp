// content-guard: allow private-ipv4 file
import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxWriteFileTool } from "../../src/tools/proxmox_write_file.ts";
import { WriteGateError } from "../../src/gates.ts";
import type { SshExecutor } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool(ssh: SshExecutor) {
  return createProxmoxWriteFileTool(
    () => new ProxmoxClient({
      url: fake!.baseUrl,
      tokenId: "u@pam!t",
      tokenSecret: "s",
      tlsInsecure: false,
    }),
    () => ssh,
    { vmUser: "ubuntu", vmKeyPath: "/keys/vm" },
  );
}

describe("proxmox_write_file", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const ssh: SshExecutor = { execInLxc: vi.fn(), execViaDirectSsh: vi.fn() };
    await expect(
      makeTool(ssh).execute("t", { vmid: 109, path: "/tmp/x", content: "hi" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("requires an absolute guest path", async () => {
    const ssh: SshExecutor = { execInLxc: vi.fn(), execViaDirectSsh: vi.fn() };
    await expect(
      makeTool(ssh).execute("t", { vmid: 109, path: "tmp/x", content: "hi", confirm: true }),
    ).rejects.toThrow(/path must be absolute/);
  });

  it("mkdir -p then cat > <path> with content piped on stdin (LXC)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const calls: Array<{ command: string; stdin?: string }> = [];
    const ssh: SshExecutor = {
      execInLxc: vi.fn(async (_vmid, command, _timeout, stdin) => {
        calls.push({ command, stdin });
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
      execViaDirectSsh: vi.fn(),
    };
    const content = "hello\nworld\n";
    const r = await makeTool(ssh).execute("t", {
      vmid: 109,
      path: "/etc/myapp/config.toml",
      content,
      confirm: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload).toEqual({
      vmid: 109,
      path: "/etc/myapp/config.toml",
      bytes_written: Buffer.byteLength(content, "utf8"),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].command).toBe("mkdir -p -- '/etc/myapp'");
    expect(calls[0].stdin).toBeUndefined();
    expect(calls[1].command).toBe("cat > '/etc/myapp/config.toml'");
    expect(calls[1].stdin).toBe(content);
  });

  it("rejects when mkdir fails (non-zero exit on first call)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const ssh: SshExecutor = {
      execInLxc: vi.fn(async () => ({ stdout: "", stderr: "permission denied\n", exitCode: 1 })),
      execViaDirectSsh: vi.fn(),
    };
    await expect(
      makeTool(ssh).execute("t", { vmid: 109, path: "/root/x", content: "x", confirm: true }),
    ).rejects.toThrow(/permission denied/);
  });

  it("routes QEMU to execViaDirectSsh for both mkdir and cat", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "qemu" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/qemu/109/agent/network-get-interfaces",
        status: 200,
        body: {
          data: {
            result: [
              { name: "eth0", "ip-addresses": [{ "ip-address-type": "ipv4", "ip-address": "10.0.0.5" }] },
            ],
          },
        },
      },
    ]);
    const calls: Array<{ command: string }> = [];
    const ssh: SshExecutor = {
      execInLxc: vi.fn(),
      execViaDirectSsh: vi.fn(async (_target, command) => {
        calls.push({ command });
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    };
    await makeTool(ssh).execute("t", {
      vmid: 109,
      path: "/tmp/a.txt",
      content: "x",
      confirm: true,
    });
    expect(calls.map((c) => c.command)).toEqual([
      "mkdir -p -- '/tmp'",
      "cat > '/tmp/a.txt'",
    ]);
    expect(ssh.execInLxc).not.toHaveBeenCalled();
  });
});
