import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxExecTool } from "../../src/tools/proxmox_exec.ts";
import { WriteGateError } from "../../src/gates.ts";
import type { SshExecutor } from "../../src/tools/_util.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  delete process.env.PROXMOX_VM_109_SSH_HOST;
  delete process.env.PROXMOX_VM_109_SSH_USER;
  delete process.env.PROXMOX_VM_109_SSH_KEY;
});

function makeTool(ssh: SshExecutor) {
  return createProxmoxExecTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
    () => ssh,
    {
      vmUser: "ubuntu",
      vmKeyPath: "/keys/vm",
    },
  );
}

function fakeSsh(): SshExecutor & { lxcCalls: any[]; directCalls: any[] } {
  const lxcCalls: any[] = [];
  const directCalls: any[] = [];
  return {
    lxcCalls,
    directCalls,
    execInLxc: vi.fn(async (vmid, command, timeoutMs, stdin) => {
      lxcCalls.push({ vmid, command, timeoutMs, stdin });
      return { stdout: "lxc out\n", stderr: "", exitCode: 0 };
    }),
    execViaDirectSsh: vi.fn(async (target, command, timeoutMs, stdin) => {
      directCalls.push({ target, command, timeoutMs, stdin });
      return { stdout: "vm out\n", stderr: "", exitCode: 0 };
    }),
  };
}

describe("proxmox_exec", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const ssh = fakeSsh();
    await expect(
      makeTool(ssh).execute("t", { vmid: 109, command: "uptime" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("routes LXC to execInLxc and returns stdout/stderr/exit_code", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const ssh = fakeSsh();
    const r = await makeTool(ssh).execute("t", { vmid: 109, command: "uptime", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload).toEqual({
      vmid: 109,
      type: "lxc",
      stdout: "lxc out\n",
      stderr: "",
      exit_code: 0,
    });
    expect(ssh.lxcCalls).toHaveLength(1);
    expect(ssh.lxcCalls[0].vmid).toBe(109);
    expect(ssh.lxcCalls[0].command).toBe("uptime");
    expect(ssh.lxcCalls[0].timeoutMs).toBe(30000);
  });

  it("honors a custom timeout (converted to ms)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const ssh = fakeSsh();
    await makeTool(ssh).execute("t", { vmid: 109, command: "sleep 1", timeout: 60, confirm: true });
    expect(ssh.lxcCalls[0].timeoutMs).toBe(60000);
  });

  it("routes QEMU to execViaDirectSsh using guest-agent IP", async () => {
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
              { name: "lo", "ip-addresses": [{ "ip-address-type": "ipv4", "ip-address": "127.0.0.1" }] },
              { name: "eth0", "ip-addresses": [{ "ip-address-type": "ipv4", "ip-address": "10.0.0.5" }] },
            ],
          },
        },
      },
    ]);
    const ssh = fakeSsh();
    const r = await makeTool(ssh).execute("t", { vmid: 109, command: "uname -a", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.type).toBe("qemu");
    expect(payload.stdout).toBe("vm out\n");
    expect(ssh.directCalls).toHaveLength(1);
    expect(ssh.directCalls[0].target).toEqual({
      host: "10.0.0.5",
      port: 22,
      user: "ubuntu",
      keyPath: "/keys/vm",
    });
    expect(ssh.directCalls[0].command).toBe("uname -a");
  });

  it("honors PROXMOX_VM_<vmid>_SSH_HOST env override (skips guest-agent)", async () => {
    process.env.PROXMOX_VM_109_SSH_HOST = "192.168.5.10";
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "qemu" }] },
      },
    ]);
    const ssh = fakeSsh();
    await makeTool(ssh).execute("t", { vmid: 109, command: "uname", confirm: true });
    expect(ssh.directCalls[0].target.host).toBe("192.168.5.10");
    // No guest-agent call was needed - we only see the cluster/resources GET.
    expect(fake.requests.filter((r) => r.path.includes("agent/network-get-interfaces"))).toHaveLength(0);
  });

  it("honors per-VM PROXMOX_VM_<vmid>_SSH_USER and _SSH_KEY overrides", async () => {
    process.env.PROXMOX_VM_109_SSH_HOST = "192.168.5.10";
    process.env.PROXMOX_VM_109_SSH_USER = "admin";
    process.env.PROXMOX_VM_109_SSH_KEY = "/keys/per-vm";
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "qemu" }] },
      },
    ]);
    const ssh = fakeSsh();
    await makeTool(ssh).execute("t", { vmid: 109, command: "uname", confirm: true });
    expect(ssh.directCalls[0].target).toEqual({
      host: "192.168.5.10",
      port: 22,
      user: "admin",
      keyPath: "/keys/per-vm",
    });
  });

  it("throws a clear error when QEMU has no env override and guest agent returns no usable IP", async () => {
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
        status: 500,
        body: { message: "QEMU guest agent is not running" },
      },
    ]);
    const ssh = fakeSsh();
    await expect(
      makeTool(ssh).execute("t", { vmid: 109, command: "uname", confirm: true }),
    ).rejects.toThrow(/PROXMOX_VM_109_SSH_HOST/);
  });

  it("returns non-zero exit code in payload (does not throw)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 109, node: "pve", type: "lxc" }] },
      },
    ]);
    const ssh = fakeSsh();
    ssh.execInLxc = vi.fn(async () => ({ stdout: "", stderr: "no such file\n", exitCode: 1 }));
    const r = await makeTool(ssh).execute("t", { vmid: 109, command: "cat /missing", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.exit_code).toBe(1);
    expect(payload.stderr).toBe("no such file\n");
  });
});
