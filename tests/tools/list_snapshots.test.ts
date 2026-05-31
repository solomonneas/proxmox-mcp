import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxListSnapshotsTool } from "../../src/tools/proxmox_list_snapshots.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

function makeTool() {
  return createProxmoxListSnapshotsTool(
    () => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }),
  );
}

describe("proxmox_list_snapshots", () => {
  it("resolves the resource and lists snapshots", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "lxc" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/lxc/110/snapshot",
        status: 200,
        body: { data: [{ name: "current" }, { name: "pre-upgrade", snaptime: 123 }] },
      },
    ]);
    const r = await makeTool().execute("t", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload).toMatchObject({ vmid: 110, node: "pve", type: "lxc", count: 2 });
    expect(payload.snapshots[1].name).toBe("pre-upgrade");
  });
});
