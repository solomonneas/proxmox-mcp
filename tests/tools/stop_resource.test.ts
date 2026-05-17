import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxStopResourceTool } from "../../src/tools/proxmox_stop_resource.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxStopResourceTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_stop_resource", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(tool.execute("test", { vmid: 110 })).rejects.toThrow(WriteGateError);
  });

  it("posts to status/shutdown for the resolved node+type (qemu)", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu/110/status/shutdown",
        status: 200,
        body: { data: "UPID:pve:00002:stop" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", { vmid: 110, confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(110);
    expect(payload.type).toBe("qemu");
    expect(payload.upid).toBe("UPID:pve:00002:stop");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/qemu/110/status/shutdown");
    expect(JSON.parse(postReq?.body ?? "{}")).toEqual({});
  });

  it("includes timeout in body when timeoutSeconds is passed", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu/110/status/shutdown",
        status: 200,
        body: { data: "UPID:pve:00003:stop" },
      },
    ]);
    const tool = makeTool();
    await tool.execute("test", { vmid: 110, confirm: true, timeoutSeconds: 60 });
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(JSON.parse(postReq?.body ?? "{}")).toEqual({ timeout: 60 });
  });
});
