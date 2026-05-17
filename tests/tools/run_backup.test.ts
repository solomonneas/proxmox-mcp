import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxRunBackupTool } from "../../src/tools/proxmox_run_backup.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxRunBackupTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_run_backup", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 100, storage: "local" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("posts vzdump body with defaulted mode=snapshot + compress=zstd", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/vzdump",
        status: 200,
        body: { data: "UPID:pve:00007:vzdump" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", {
      vmid: 100,
      storage: "local",
      confirm: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(100);
    expect(payload.node).toBe("pve");
    expect(payload.storage).toBe("local");
    expect(payload.mode).toBe("snapshot");
    expect(payload.upid).toBe("UPID:pve:00007:vzdump");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/vzdump");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(postReq?.body ?? ""))).toEqual({
      vmid: "100",
      storage: "local",
      mode: "snapshot",
      compress: "zstd",
    });
  });

  it("honors explicit mode (stop)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/vzdump",
        status: 200,
        body: { data: "UPID:pve:00008:vzdump" },
      },
    ]);
    const tool = makeTool();
    await tool.execute("test", {
      vmid: 110,
      storage: "nas-backup",
      mode: "stop",
      confirm: true,
    });
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(postReq?.body ?? ""))).toEqual({
      vmid: "110",
      storage: "nas-backup",
      mode: "stop",
      compress: "zstd",
    });
  });
});
