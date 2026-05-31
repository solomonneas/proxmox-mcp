import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxAuditPermissionsTool } from "../../src/tools/proxmox_audit_permissions.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxAuditPermissionsTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_audit_permissions", () => {
  it("queries requested paths and reports missing required privileges", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/access/permissions?path=%2Fpool%2Fmcp-smoke&userid=mcp-smoke%40pve%21live-smoke",
        status: 200,
        body: { data: { "/pool/mcp-smoke": { "Pool.Audit": 1, "VM.Audit": 1 } } },
      },
      {
        method: "GET",
        path: "/api2/json/access/permissions?path=%2Fvms%2F103&userid=mcp-smoke%40pve%21live-smoke",
        status: 200,
        body: { data: { "/vms/103": { "VM.Audit": 1, "VM.Clone": 1 } } },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", {
      userid: "mcp-smoke@pve!live-smoke",
      paths: ["/pool/mcp-smoke", "/vms/103"],
      required_privileges: ["Pool.Audit", "VM.Clone"],
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.paths).toHaveLength(2);
    expect(payload.paths[0].missing_required).toEqual(["VM.Clone"]);
    expect(payload.paths[1].missing_required).toEqual(["Pool.Audit"]);
  });
});
