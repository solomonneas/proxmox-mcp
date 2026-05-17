import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCreateVmTool } from "../../src/tools/proxmox_create_vm.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxCreateVmTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_create_vm", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 300, name: "vm-test" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("posts form-encoded body to /nodes/{node}/qemu with defaults", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve", type: "node" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu",
        status: 200,
        body: { data: "UPID:pve:00011:qemu-create" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", { vmid: 300, name: "vm-test", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(300);
    expect(payload.node).toBe("pve");
    expect(payload.name).toBe("vm-test");
    expect(payload.upid).toBe("UPID:pve:00011:qemu-create");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/qemu");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.vmid).toBe("300");
    expect(form.name).toBe("vm-test");
    expect(form.memory).toBe("2048");
    expect(form.cores).toBe("2");
    expect(form.scsi0).toBe("local-lvm:32");
    expect(form.net0).toBe("model=virtio,bridge=vmbr0");
    expect(form.start).toBe("0");
    expect(form.cdrom).toBeUndefined();
    expect(form.ide2).toBeUndefined();
  });
});
