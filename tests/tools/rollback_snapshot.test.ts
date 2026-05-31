import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxRollbackSnapshotTool } from "../../src/tools/proxmox_rollback_snapshot.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  vi.unstubAllEnvs();
});

function makeTool() {
  return createProxmoxRollbackSnapshotTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_rollback_snapshot", () => {
  it("refuses without destructive env flag", async () => {
    fake = await startFakeProxmox([]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "");
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 100, snapname: "pre", confirm: true, destructive: true }),
    ).rejects.toThrow(WriteGateError);
  });

  it("POSTs to snapshot rollback endpoint with start option", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc/100/snapshot/pre-smoke/rollback",
        status: 200,
        body: { data: "UPID:pve:0001:0002:0003:rollback:100:root@pam:" },
      },
    ]);
    vi.stubEnv("PROXMOX_ENABLE_DESTRUCTIVE", "1");
    const tool = makeTool();
    const r = await tool.execute("test", {
      vmid: 100,
      snapname: "pre-smoke",
      start: true,
      confirm: true,
      destructive: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(100);
    expect(payload.start).toBe(true);
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/lxc/100/snapshot/pre-smoke/rollback");
    expect(Object.fromEntries(new URLSearchParams(postReq?.body ?? ""))).toEqual({ start: "1" });
  });
});
