import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxWaitTaskTool } from "../../src/tools/proxmox_wait_task.ts";

const UPID = "UPID:pve:00000001:00000002:00000003:vzstart:110:u@pam:";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

describe("proxmox_wait_task", () => {
  it("returns done:true when the task is stopped", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: `/api2/json/nodes/pve/tasks/${encodeURIComponent(UPID)}/status`,
        status: 200,
        body: { data: { upid: UPID, status: "stopped", exitstatus: "OK" } },
      },
    ]);
    const tool = createProxmoxWaitTaskTool(
      () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
    );
    const r = await tool.execute("t", { upid: UPID, timeoutSeconds: 1, intervalMs: 100 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.done).toBe(true);
    expect(payload.polls).toBe(1);
  });

  it("returns done:false on timeout with the last status", async () => {
    const client = {
      get: async () => ({ upid: UPID, status: "running" }),
    } as unknown as ProxmoxClient;
    const tool = createProxmoxWaitTaskTool(() => client);
    const r = await tool.execute("t", { upid: UPID, timeoutSeconds: 1, intervalMs: 100 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.done).toBe(false);
    expect(payload.status.status).toBe("running");
  });
});
