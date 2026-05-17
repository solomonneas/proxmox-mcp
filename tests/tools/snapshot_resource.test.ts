import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxSnapshotResourceTool } from "../../src/tools/proxmox_snapshot_resource.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxSnapshotResourceTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_snapshot_resource", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 110, snapname: "pre-upgrade" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("posts snapname (and description when provided) to /snapshot", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu/110/snapshot",
        status: 200,
        body: { data: "UPID:pve:00005:snap" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", {
      vmid: 110,
      snapname: "pre-upgrade",
      description: "before kernel bump",
      confirm: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(110);
    expect(payload.snapname).toBe("pre-upgrade");
    expect(payload.upid).toBe("UPID:pve:00005:snap");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/qemu/110/snapshot");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(postReq?.body ?? ""))).toEqual({
      snapname: "pre-upgrade",
      description: "before kernel bump",
    });
  });

  it("omits description from body when not provided", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc/100/snapshot",
        status: 200,
        body: { data: "UPID:pve:00006:snap" },
      },
    ]);
    const tool = makeTool();
    await tool.execute("test", { vmid: 100, snapname: "clean", confirm: true });
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(Object.fromEntries(new URLSearchParams(postReq?.body ?? ""))).toEqual({ snapname: "clean" });
  });
});
