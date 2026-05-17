import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxRecentTasksTool } from "../../src/tools/proxmox_recent_tasks.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_recent_tasks", () => {
  it("returns recent cluster tasks capped at limit", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/tasks",
        status: 200,
        body: {
          data: [
            { upid: "UPID:pve:1:0:0:vzstart:100:root@pam:", type: "vzstart", node: "pve", user: "root@pam", id: "100" },
            { upid: "UPID:pve:2:0:0:vzshutdown:101:root@pam:", type: "vzshutdown", node: "pve", user: "root@pam", id: "101" },
            { upid: "UPID:pve:3:0:0:qmstart:110:root@pam:", type: "qmstart", node: "pve", user: "root@pam", id: "110" },
          ],
        },
      },
    ]);
    const tool = createProxmoxRecentTasksTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { limit: 2 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(2);
    expect(payload.tasks).toHaveLength(2);
  });

  it("filters by vmid when provided", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/tasks",
        status: 200,
        body: {
          data: [
            { upid: "UPID:pve:1:0:0:vzstart:100:root@pam:", type: "vzstart", node: "pve", user: "root@pam", id: "100" },
            { upid: "UPID:pve:2:0:0:qmstart:110:root@pam:", type: "qmstart", node: "pve", user: "root@pam", id: "110" },
          ],
        },
      },
    ]);
    const tool = createProxmoxRecentTasksTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.tasks[0].id).toBe("110");
  });
});
