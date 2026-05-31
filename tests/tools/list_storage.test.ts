import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxListStorageTool } from "../../src/tools/proxmox_list_storage.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxListStorageTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

describe("proxmox_list_storage", () => {
  it("lists storage for all nodes by default", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve-a", type: "node" }, { node: "pve-b", type: "node" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve-a/storage",
        status: 200,
        body: { data: [{ storage: "local", type: "dir", active: 1 }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve-b/storage",
        status: 200,
        body: { data: [{ storage: "fast", type: "zfspool", active: 1 }] },
      },
    ]);
    const r = await makeTool().execute("t", {});
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(2);
    expect(payload.nodes.map((n: { node: string }) => n.node)).toEqual(["pve-a", "pve-b"]);
  });

  it("lists storage for one explicit node without cluster discovery", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage",
        status: 200,
        body: { data: [{ storage: "local-lvm", type: "lvmthin", active: 1 }] },
      },
    ]);
    const r = await makeTool().execute("t", { node: "pve" });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(1);
    expect(fake.requests).toHaveLength(1);
  });
});
