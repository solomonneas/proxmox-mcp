// content-guard: allow private-ipv4 file
import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxGuestNetworkTool } from "../../src/tools/proxmox_guest_network.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxGuestNetworkTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

describe("proxmox_guest_network", () => {
  it("returns usable QEMU guest-agent IPv4 addresses", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 200, node: "pve", type: "qemu" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/qemu/200/agent/network-get-interfaces",
        status: 200,
        body: {
          data: {
            result: [
              { name: "lo", "ip-addresses": [{ "ip-address-type": "ipv4", "ip-address": "127.0.0.1" }] },
              { name: "eth0", "ip-addresses": [{ "ip-address-type": "ipv4", "ip-address": "10.0.0.5", prefix: 24 }] },
            ],
          },
        },
      },
    ]);
    const r = await makeTool().execute("t", { vmid: 200 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.ipv4).toEqual([{ interface: "eth0", address: "10.0.0.5", prefix: 24 }]);
  });

  it("returns LXC interface IPv4 addresses", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "lxc" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/lxc/110/interfaces",
        status: 200,
        body: { data: [{ name: "eth0", inet: "10.0.0.6/24" }, { name: "lo", inet: "127.0.0.1/8" }] },
      },
    ]);
    const r = await makeTool().execute("t", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.ipv4).toEqual([{ interface: "eth0", address: "10.0.0.6", prefix: 24 }]);
  });
});
