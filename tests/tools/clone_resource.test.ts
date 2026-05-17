import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCloneResourceTool } from "../../src/tools/proxmox_clone_resource.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxCloneResourceTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_clone_resource", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", { source_vmid: 110, new_vmid: 210, name: "vm-clone" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("resolves source via cluster resources and POSTs to /nodes/{node}/{type}/{source_vmid}/clone", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu/110/clone",
        status: 200,
        body: { data: "UPID:pve:00012:clone" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", {
      source_vmid: 110,
      new_vmid: 210,
      name: "vm-clone",
      confirm: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.source_vmid).toBe(110);
    expect(payload.new_vmid).toBe(210);
    expect(payload.node).toBe("pve");
    expect(payload.type).toBe("qemu");
    expect(payload.upid).toBe("UPID:pve:00012:clone");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/qemu/110/clone");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.newid).toBe("210");
    expect(form.name).toBe("vm-clone");
    expect(form.full).toBe("1");
  });
});
