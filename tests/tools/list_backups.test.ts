import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxListBackupsTool } from "../../src/tools/proxmox_list_backups.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_list_backups", () => {
  it("walks each backup-capable storage on the given node", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage?content=backup",
        status: 200,
        body: { data: [{ storage: "local", content: "backup" }, { storage: "nas", content: "backup" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage/local/content?content=backup",
        status: 200,
        body: {
          data: [{ volid: "local:backup/vzdump-lxc-100-2026.tar.zst", vmid: 100, size: 12345, ctime: 1234567890 }],
        },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage/nas/content?content=backup",
        status: 200,
        body: {
          data: [{ volid: "nas:backup/vzdump-qemu-110-2026.tar.zst", vmid: 110, size: 99999, ctime: 1234567999 }],
        },
      },
    ]);
    const tool = createProxmoxListBackupsTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { node: "pve" });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.node).toBe("pve");
    expect(payload.count).toBe(2);
    expect(payload.backups[0].storage).toBe("local");
    expect(payload.backups[1].storage).toBe("nas");
  });

  it("filters by vmid when provided", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage?content=backup",
        status: 200,
        body: { data: [{ storage: "local", content: "backup" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/storage/local/content?content=backup",
        status: 200,
        body: {
          data: [
            { volid: "local:backup/a", vmid: 100, size: 1 },
            { volid: "local:backup/b", vmid: 110, size: 2 },
          ],
        },
      },
    ]);
    const tool = createProxmoxListBackupsTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { node: "pve", vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.backups[0].vmid).toBe(110);
  });
});
