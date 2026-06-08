import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { WriteGateError } from "../../src/gates.ts";
import type { SshExecutor } from "../../src/tools/_util.ts";
import { createProxmoxStatPathTool } from "../../src/tools/proxmox_stat_path.ts";
import { createProxmoxListDirectoryTool } from "../../src/tools/proxmox_list_directory.ts";
import { createProxmoxServiceStatusTool } from "../../src/tools/proxmox_service_status.ts";
import { createProxmoxServiceRestartTool } from "../../src/tools/proxmox_service_restart.ts";
import { createProxmoxServiceStartTool } from "../../src/tools/proxmox_service_start.ts";
import { createProxmoxServiceStopTool } from "../../src/tools/proxmox_service_stop.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

const VM_DEFAULTS = { vmUser: "root", vmKeyPath: "/keys/vm" };

function getClient() {
  return new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
}

function fakeSsh(stdout: string, stderr = "", exitCode = 0): SshExecutor {
  return {
    execInLxc: vi.fn(async () => ({ stdout, stderr, exitCode })),
    execViaDirectSsh: vi.fn(async () => ({ stdout, stderr, exitCode })),
  };
}

function nulRecord(fields: string[]): string {
  return `${fields.join("\0")}\0`;
}

async function fakeLxc(vmid = 109) {
  fake = await startFakeProxmox([
    {
      method: "GET",
      path: "/api2/json/cluster/resources",
      status: 200,
      body: { data: [{ vmid, node: "pve", type: "lxc" }] },
    },
  ]);
}

describe("guest helper tools", () => {
  it("stat_path refuses without confirm:true", async () => {
    const ssh = fakeSsh("");
    const tool = createProxmoxStatPathTool(() => getClient(), () => ssh, VM_DEFAULTS);
    await expect(tool.execute("t", { vmid: 109, path: "/etc/hostname" })).rejects.toThrow(WriteGateError);
  });

  it("stat_path returns structured stat output", async () => {
    await fakeLxc();
    const ssh = fakeSsh(nulRecord(["regular file", "8", "root", "root", "644", "1710000000", "/etc/hostname"]));
    const tool = createProxmoxStatPathTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const r = await tool.execute("t", { vmid: 109, path: "/etc/hostname", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload).toMatchObject({
      vmid: 109,
      node: "pve",
      type: "lxc",
      file_type: "regular file",
      size: 8,
      owner: "root",
      mode: "644",
    });
    expect(ssh.execInLxc).toHaveBeenCalledWith(109, expect.stringContaining("stat -Lc"), 30000, undefined);
  });

  it("stat_path preserves pipe characters in returned path names", async () => {
    await fakeLxc();
    const ssh = fakeSsh(nulRecord(["regular file", "8", "root", "root", "644", "1710000000", "/tmp/a|b"]));
    const tool = createProxmoxStatPathTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const r = await tool.execute("t", { vmid: 109, path: "/tmp/a|b", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.name).toBe("/tmp/a|b");
  });

  it("list_directory parses find output", async () => {
    await fakeLxc();
    const ssh = fakeSsh(
      nulRecord(["hosts", "f", "120", "1710000000.1"]) +
      nulRecord(["ssh", "d", "4096", "1710000001.2"]),
    );
    const tool = createProxmoxListDirectoryTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const r = await tool.execute("t", { vmid: 109, path: "/etc", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(2);
    expect(payload.entries[0]).toEqual({ name: "hosts", kind: "f", size: 120, mtime: 1710000000.1 });
  });

  it("list_directory preserves tabs and newlines in filenames", async () => {
    await fakeLxc();
    const ssh = fakeSsh(
      nulRecord(["name\twith-tab", "f", "1", "1710000000.1"]) +
      nulRecord(["name\nwith-newline", "f", "2", "1710000001.2"]),
    );
    const tool = createProxmoxListDirectoryTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const r = await tool.execute("t", { vmid: 109, path: "/tmp", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.entries).toEqual([
      { name: "name\twith-tab", kind: "f", size: 1, mtime: 1710000000.1 },
      { name: "name\nwith-newline", kind: "f", size: 2, mtime: 1710000001.2 },
    ]);
  });

  it("service_status parses systemctl show output", async () => {
    await fakeLxc();
    const ssh = fakeSsh("Id=ssh.service\nLoadState=loaded\nActiveState=active\nSubState=running\nDescription=OpenSSH server\n");
    const tool = createProxmoxServiceStatusTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const r = await tool.execute("t", { vmid: 109, service: "ssh.service", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.status).toMatchObject({ Id: "ssh.service", ActiveState: "active", SubState: "running" });
  });

  it("service action tools run systemctl and return status", async () => {
    await fakeLxc();
    const ssh = fakeSsh("Id=ssh.service\nLoadState=loaded\nActiveState=active\nSubState=running\n");
    const tool = createProxmoxServiceRestartTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const r = await tool.execute("t", { vmid: 109, service: "ssh.service", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.action).toBe("restart");
    expect(payload.status.ActiveState).toBe("active");
    expect(ssh.execInLxc).toHaveBeenCalledWith(109, expect.stringContaining("systemctl restart"), 60000, undefined);
  });

  it("service action tools refuse without confirm:true", async () => {
    const ssh = fakeSsh("");
    const start = createProxmoxServiceStartTool(() => getClient(), () => ssh, VM_DEFAULTS);
    const stop = createProxmoxServiceStopTool(() => getClient(), () => ssh, VM_DEFAULTS);
    await expect(start.execute("t", { vmid: 109, service: "ssh.service" })).rejects.toThrow(WriteGateError);
    await expect(stop.execute("t", { vmid: 109, service: "ssh.service" })).rejects.toThrow(WriteGateError);
  });
});
