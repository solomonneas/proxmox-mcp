import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxReadFileTool } from "../../src/tools/proxmox_read_file.ts";
import type { SshExecutor } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool(ssh: SshExecutor) {
  return createProxmoxReadFileTool(
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

describe("proxmox_read_file", () => {
  it("does NOT require confirm (tier-1 read)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const ssh: SshExecutor = {
      execInLxc: vi.fn(async () => ({ stdout: "file content\n", stderr: "", exitCode: 0 })),
      execViaDirectSsh: vi.fn(),
    };
    const r = await makeTool(ssh).execute("t", { vmid: 109, path: "/etc/hostname" });
    const payload = JSON.parse(r.content[0].text);
    expect(payload).toEqual({ vmid: 109, path: "/etc/hostname", content: "file content\n" });
  });

  it("uses `cat -- '<path>'` with single-quote escaping", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    let captured = "";
    const ssh: SshExecutor = {
      execInLxc: vi.fn(async (_vmid, cmd) => {
        captured = cmd;
        return { stdout: "x", stderr: "", exitCode: 0 };
      }),
      execViaDirectSsh: vi.fn(),
    };
    await makeTool(ssh).execute("t", { vmid: 109, path: "/etc/hostname" });
    expect(captured).toBe("cat -- '/etc/hostname'");
  });

  it("escapes single quotes inside the path", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    let captured = "";
    const ssh: SshExecutor = {
      execInLxc: vi.fn(async (_vmid, cmd) => { captured = cmd; return { stdout: "x", stderr: "", exitCode: 0 }; }),
      execViaDirectSsh: vi.fn(),
    };
    await makeTool(ssh).execute("t", { vmid: 109, path: "/tmp/a'b" });
    // Single-quote escape: 'a'\''b' inside single-quoted wrapping.
    expect(captured).toBe("cat -- '/tmp/a'\\''b'");
  });

  it("throws a clean error on non-zero exit with stderr trimmed", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const ssh: SshExecutor = {
      execInLxc: vi.fn(async () => ({
        stdout: "",
        stderr: "cat: /missing: No such file or directory\n",
        exitCode: 1,
      })),
      execViaDirectSsh: vi.fn(),
    };
    await expect(
      makeTool(ssh).execute("t", { vmid: 109, path: "/missing" }),
    ).rejects.toThrow(/No such file or directory/);
  });
});
