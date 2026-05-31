import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCleanupSmokeResourcesTool } from "../../src/tools/proxmox_cleanup_smoke_resources.ts";
import { createProxmoxListPoolResourcesTool } from "../../src/tools/proxmox_list_pool_resources.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  vi.unstubAllEnvs();
});

function mkClient() {
  return new ProxmoxClient({
    url: fake!.baseUrl,
    tokenId: "u@pam!t",
    tokenSecret: "s",
    tlsInsecure: false,
  });
}

describe("pool resource tools", () => {
  it("lists pool resources with count", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/pools/mcp-smoke",
        status: 200,
        body: {
          data: {
            poolid: "mcp-smoke",
            comment: "smoke resources",
            members: [
              { type: "lxc", vmid: 102, node: "pve", name: "mcp-smoke-102", status: "stopped" },
              { type: "qemu", vmid: 202, node: "pve", name: "mcp-smoke-qemu-202", status: "stopped" },
            ],
          },
        },
      },
    ]);
    const tool = createProxmoxListPoolResourcesTool(() => mkClient());
    const r = await tool.execute("test", {});
    const payload = JSON.parse(r.content[0].text);
    expect(payload.pool).toBe("mcp-smoke");
    expect(payload.count).toBe(2);
    expect(payload.resources[0].vmid).toBe(102);
  });

  it("dry-runs cleanup without the destructive env gate", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/pools/mcp-smoke",
        status: 200,
        body: {
          data: {
            members: [
              { type: "lxc", vmid: 102, node: "pve", name: "mcp-smoke-102", status: "running" },
            ],
          },
        },
      },
    ]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "");
    const tool = createProxmoxCleanupSmokeResourcesTool(() => mkClient());
    const r = await tool.execute("test", {});
    const payload = JSON.parse(r.content[0].text);
    expect(payload.dry_run).toBe(true);
    expect(payload.targets).toHaveLength(1);
    expect(payload.skipped_running).toHaveLength(1);
    expect(fake.requests.filter((q) => q.method === "DELETE")).toHaveLength(0);
  });

  it("requires the destructive env gate when dry_run:false", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/pools/mcp-smoke",
        status: 200,
        body: { data: { members: [] } },
      },
    ]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "");
    const tool = createProxmoxCleanupSmokeResourcesTool(() => mkClient());
    await expect(
      tool.execute("test", { dry_run: false, confirm: true, destructive: true }),
    ).rejects.toThrow(WriteGateError);
  });

  it("destroys only stopped pool members with the smoke name prefix and waits for tasks", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/pools/mcp-smoke",
        status: 200,
        body: {
          data: {
            members: [
              { type: "lxc", vmid: 102, node: "pve", name: "mcp-smoke-102", status: "stopped" },
              { type: "qemu", vmid: 202, node: "pve", name: "mcp-smoke-qemu-202", status: "stopped" },
              { type: "lxc", vmid: 103, node: "pve", name: "mcp-smoke-103", status: "running" },
              { type: "qemu", vmid: 300, node: "pve", name: "production-vm", status: "running" },
              { type: "storage", id: "local" },
            ],
          },
        },
      },
      {
        method: "DELETE",
        path: "/api2/json/nodes/pve/lxc/102?purge=1&destroy-unreferenced-disks=1",
        status: 200,
        body: { data: "UPID:pve:0001:0002:0003:vzdestroy:102:root@pam:" },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/tasks/UPID%3Apve%3A0001%3A0002%3A0003%3Avzdestroy%3A102%3Aroot%40pam%3A/status",
        status: 200,
        body: { data: { upid: "UPID:pve:0001:0002:0003:vzdestroy:102:root@pam:", status: "stopped", exitstatus: "OK" } },
      },
      {
        method: "DELETE",
        path: "/api2/json/nodes/pve/qemu/202?purge=1&destroy-unreferenced-disks=1",
        status: 200,
        body: { data: "UPID:pve:0002:0003:0004:qmdestroy:202:root@pam:" },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/tasks/UPID%3Apve%3A0002%3A0003%3A0004%3Aqmdestroy%3A202%3Aroot%40pam%3A/status",
        status: 200,
        body: { data: { upid: "UPID:pve:0002:0003:0004:qmdestroy:202:root@pam:", status: "stopped", exitstatus: "OK" } },
      },
    ]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const tool = createProxmoxCleanupSmokeResourcesTool(() => mkClient());
    const r = await tool.execute("test", {
      dry_run: false,
      confirm: true,
      destructive: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.matched).toBe(3);
    expect(payload.destroyed.map((d: { vmid: number }) => d.vmid)).toEqual([102, 202]);
    expect(payload.skipped_running.map((d: { vmid: number }) => d.vmid)).toEqual([103]);
    expect(payload.skipped).toBe(3);
    expect(fake.requests.filter((q) => q.method === "DELETE")).toHaveLength(2);
    expect(payload.destroyed.every((d: { wait: { done: boolean } }) => d.wait.done)).toBe(true);
  });
});
