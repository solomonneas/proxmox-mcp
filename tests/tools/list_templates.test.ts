import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxListTemplatesTool } from "../../src/tools/proxmox_list_templates.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_list_templates", () => {
  it("returns both container_templates and vm_isos when kind defaults to 'both'", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve", type: "node" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage/local/content?content=vztmpl",
        status: 200,
        body: {
          data: [
            { volid: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst", content: "vztmpl", size: 123 },
          ],
        },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage/local/content?content=iso",
        status: 200,
        body: {
          data: [{ volid: "local:iso/ubuntu-24.04.2-live-server-amd64.iso", content: "iso", size: 456 }],
        },
      },
    ]);
    const tool = createProxmoxListTemplatesTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", {});
    const payload = JSON.parse(r.content[0].text);
    expect(payload.node).toBe("pve");
    expect(payload.storage).toBe("local");
    expect(payload.container_templates).toHaveLength(1);
    expect(payload.container_templates[0].volid).toContain("ubuntu-24.04-standard");
    expect(payload.vm_isos).toHaveLength(1);
    expect(payload.vm_isos[0].volid).toContain(".iso");
  });

  it("rejects node/storage args containing path-injection characters", async () => {
    fake = await startFakeProxmox([]);
    const tool = createProxmoxListTemplatesTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    await expect(tool.execute("test", { node: "pve", storage: "../../access/users" })).rejects.toThrow(
      /invalid storage/,
    );
    await expect(tool.execute("test", { node: "pve/../foo", storage: "local" })).rejects.toThrow(
      /invalid node/,
    );
    // No request should have reached the fake server.
    expect(fake.requests).toHaveLength(0);
  });
});
