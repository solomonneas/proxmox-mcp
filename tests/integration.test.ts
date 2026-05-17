import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "./fake-proxmox.ts";
import { ProxmoxClient } from "../src/proxmox-client.ts";
import * as toolFactories from "../src/tools/index.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

describe("integration", () => {
  it("all 12 tools register with unique names", () => {
    const dummy = () =>
      new ProxmoxClient({ url: "http://x", tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
    const created = [
      toolFactories.createProxmoxStatusTool(dummy),
      toolFactories.createProxmoxListContainersTool(dummy),
      toolFactories.createProxmoxListVmsTool(dummy),
      toolFactories.createProxmoxGetResourceTool(dummy),
      toolFactories.createProxmoxRecentTasksTool(dummy),
      toolFactories.createProxmoxListBackupsTool(dummy),
      toolFactories.createProxmoxResourceUsageTool(dummy),
      toolFactories.createProxmoxStartResourceTool(dummy),
      toolFactories.createProxmoxStopResourceTool(dummy),
      toolFactories.createProxmoxRebootResourceTool(dummy),
      toolFactories.createProxmoxSnapshotResourceTool(dummy),
      toolFactories.createProxmoxRunBackupTool(dummy),
    ];
    expect(created).toHaveLength(12);
    const names = created.map((t) => t.name);
    expect(new Set(names).size).toBe(12);
    for (const n of names) expect(n).toMatch(/^proxmox_/);
  });

  it("end-to-end: status read + start_resource write via the fake server", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 200, body: { data: { version: "9.1.6", release: "9.1" } } },
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve", status: "online", cpu: 0.1, mem: 1024, maxmem: 4096, uptime: 1000 }] },
      },
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc/100/status/start",
        status: 200,
        body: { data: "UPID:pve:0001:0001:start" },
      },
    ]);
    const mkClient = () =>
      new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
    const status = toolFactories.createProxmoxStatusTool(mkClient);
    const start = toolFactories.createProxmoxStartResourceTool(mkClient);

    const sr = await status.execute();
    const sp = JSON.parse(sr.content[0].text);
    expect(sp.version).toBe("9.1.6");
    expect(sp.nodes).toHaveLength(1);
    expect(sp.nodes[0].node).toBe("pve");

    const ar = await start.execute("id", { vmid: 100, confirm: true });
    const payload = JSON.parse(ar.content[0].text);
    expect(payload.vmid).toBe(100);
    expect(payload.node).toBe("pve");
    expect(payload.type).toBe("lxc");
    expect(payload.upid).toBe("UPID:pve:0001:0001:start");
  });
});
