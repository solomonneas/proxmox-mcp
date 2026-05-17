import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxListVmsTool } from "../../src/tools/proxmox_list_vms.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_list_vms", () => {
  it("returns QEMU VM list with count", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=vm",
        status: 200,
        body: {
          data: [
            { vmid: 110, name: "app-vm", node: "pve", status: "running", type: "qemu" },
            { vmid: 100, name: "web-svc", node: "pve", status: "running", type: "lxc" },
          ],
        },
      },
    ]);
    const tool = createProxmoxListVmsTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute();
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.vms[0].vmid).toBe(110);
    expect(payload.vms[0].name).toBe("app-vm");
    expect(payload.vms.every((v: { type: string }) => v.type === "qemu")).toBe(true);
  });
});
