import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxListContainersTool } from "../../src/tools/proxmox_list_containers.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_list_containers", () => {
  it("returns LXC list with count", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=lxc",
        status: 200,
        body: {
          data: [
            { vmid: 100, name: "adguard", node: "pve", status: "running", type: "lxc" },
            { vmid: 105, name: "wazuh", node: "pve", status: "running", type: "lxc" },
          ],
        },
      },
    ]);
    const tool = createProxmoxListContainersTool(
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
    expect(payload.count).toBe(2);
    expect(payload.containers).toHaveLength(2);
    expect(payload.containers[0].vmid).toBe(100);
  });
});
