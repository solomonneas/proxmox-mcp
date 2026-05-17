import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxStartResourceTool } from "../../src/tools/proxmox_start_resource.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxStartResourceTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_start_resource", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(tool.execute("test", { vmid: 100 })).rejects.toThrow(WriteGateError);
  });

  it("posts to status/start for the resolved node+type (lxc)", async () => {
    fake = await startFakeProxmox([
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
        body: { data: "UPID:pve:00001:start" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", { vmid: 100, confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(100);
    expect(payload.node).toBe("pve");
    expect(payload.type).toBe("lxc");
    expect(payload.upid).toBe("UPID:pve:00001:start");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/lxc/100/status/start");
  });

  it("fails closed when cluster/resources reports the same vmid on multiple nodes", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: {
          data: [
            { vmid: 100, node: "pve-a", type: "lxc" },
            { vmid: 100, node: "pve-b", type: "lxc" },
          ],
        },
      },
    ]);
    const tool = makeTool();
    await expect(tool.execute("test", { vmid: 100, confirm: true })).rejects.toThrow(/ambiguous/);
  });
});
