import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCreateContainerTool } from "../../src/tools/proxmox_create_container.ts";
import { WriteGateError } from "../../src/gates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxCreateContainerTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_create_container", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", {
        vmid: 200,
        hostname: "ct-test",
        ostemplate: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
      }),
    ).rejects.toThrow(WriteGateError);
  });

  it("posts form-encoded body to /nodes/{node}/lxc with vmid, hostname, storage, memory", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve", type: "node" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc",
        status: 200,
        body: { data: "UPID:pve:00010:lxc-create" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", {
      vmid: 200,
      hostname: "ct-test",
      ostemplate: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
      confirm: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(200);
    expect(payload.node).toBe("pve");
    expect(payload.upid).toBe("UPID:pve:00010:lxc-create");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/lxc");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.vmid).toBe("200");
    expect(form.hostname).toBe("ct-test");
    expect(form.storage).toBe("local-lvm");
    expect(form.memory).toBe("512");
    expect(form.cores).toBe("1");
    expect(form.rootfs).toBe("local-lvm:8");
    expect(form.net0).toBe("name=eth0,bridge=vmbr0,ip=dhcp");
    expect(form.start).toBe("0");
  });
});
