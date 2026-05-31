import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxGetContainerConfigTool } from "../../src/tools/proxmox_get_container_config.ts";
import { createProxmoxGetVmConfigTool } from "../../src/tools/proxmox_get_vm_config.ts";
import { createProxmoxValidateQemuSmokeSourceTool } from "../../src/tools/proxmox_validate_qemu_smoke_source.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function mkClient() {
  return new ProxmoxClient({
    url: fake!.baseUrl,
    tokenId: "u@pam!t",
    tokenSecret: "s",
    tlsInsecure: false,
  });
}

describe("config and QEMU smoke validator tools", () => {
  it("reads QEMU VM config", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/qemu/110/config",
        status: 200,
        body: { data: { name: "source", agent: "1" } },
      },
    ]);
    const tool = createProxmoxGetVmConfigTool(() => mkClient());
    const r = await tool.execute("test", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.type).toBe("qemu");
    expect(payload.config.name).toBe("source");
  });

  it("reads LXC container config", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 120, node: "pve", type: "lxc" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/lxc/120/config",
        status: 200,
        body: { data: { hostname: "ct-source", rootfs: "local-lvm:vm-120-disk-0,size=8G" } },
      },
    ]);
    const tool = createProxmoxGetContainerConfigTool(() => mkClient());
    const r = await tool.execute("test", { vmid: 120 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.type).toBe("lxc");
    expect(payload.config.hostname).toBe("ct-source");
  });

  it("accepts a stopped agent-enabled small QEMU source", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu", status: "stopped", maxdisk: 10 * 1024 ** 3 }] },
      },
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu", status: "stopped", maxdisk: 10 * 1024 ** 3 }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/qemu/110/config",
        status: 200,
        body: { data: { name: "smoke-source", agent: "enabled=1" } },
      },
    ]);
    const tool = createProxmoxValidateQemuSmokeSourceTool(() => mkClient());
    const r = await tool.execute("test", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.blockers).toEqual([]);
  });

  it("blocks risky QEMU sources", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu", status: "running", maxdisk: 200 * 1024 ** 3 }] },
      },
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu", status: "running", maxdisk: 200 * 1024 ** 3 }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/qemu/110/config",
        status: 200,
        body: { data: { name: "dani", agent: "0", hostpci0: "0000:01:00", usb0: "host=1-1" } },
      },
    ]);
    const tool = createProxmoxValidateQemuSmokeSourceTool(() => mkClient());
    const r = await tool.execute("test", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.blockers.join("\n")).toContain("hostpci0");
    expect(payload.blockers.join("\n")).toContain("guest agent");
    expect(payload.blockers.join("\n")).toContain("over 64 GiB");
    expect(payload.blockers.join("\n")).toContain("running");
  });
});
