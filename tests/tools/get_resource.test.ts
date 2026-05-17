import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxGetResourceTool } from "../../src/tools/proxmox_get_resource.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_get_resource", () => {
  it("resolves vmid then fetches status/current", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: {
          data: [
            { vmid: 100, node: "pve", type: "lxc" },
            { vmid: 110, node: "pve", type: "qemu" },
          ],
        },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/lxc/100/status/current",
        status: 200,
        body: { data: { status: "running", cpu: 0.05, mem: 512, uptime: 12345 } },
      },
    ]);
    const tool = createProxmoxGetResourceTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { vmid: 100 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(100);
    expect(payload.node).toBe("pve");
    expect(payload.type).toBe("lxc");
    expect(payload.status.status).toBe("running");
  });

  it("throws when vmid is not in cluster resources", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
      },
    ]);
    const tool = createProxmoxGetResourceTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    await expect(tool.execute("test", { vmid: 999 })).rejects.toThrow(/vmid 999/);
  });
});
