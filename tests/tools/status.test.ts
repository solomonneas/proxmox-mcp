import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxStatusTool } from "../../src/tools/proxmox_status.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_status", () => {
  it("returns version + node list", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/version",
        status: 200,
        body: { data: { version: "9.1.6", release: "9.1" } },
      },
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: {
          data: [{ node: "pve", status: "online", cpu: 0.12, mem: 1234, maxmem: 99999 }],
        },
      },
    ]);
    const tool = createProxmoxStatusTool(
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
    expect(payload.version).toBe("9.1.6");
    expect(payload.release).toBe("9.1");
    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0].node).toBe("pve");
  });
});
