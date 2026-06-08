import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCreateContainerTool } from "../../src/tools/proxmox_create_container.ts";
import { WriteGateError } from "../../src/gates.ts";
import { redact } from "../../src/security.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxCreateContainerTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_create_container", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", {
        vmid: 200,
        hostname: "ct-test",
        ostemplate: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
      }),
    ).rejects.toThrow(WriteGateError);
  });

  it("posts form-encoded body to /nodes/{node}/lxc with vmid, hostname, storage, memory", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve", type: "node" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc",
        status: 200,
        body: { data: "UPID:pve:00010:lxc-create" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", {
      vmid: 200,
      hostname: "ct-test",
      ostemplate: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst",
      confirm: true,
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(200);
    expect(payload.node).toBe("pve");
    expect(payload.upid).toBe("UPID:pve:00010:lxc-create");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/lxc");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.vmid).toBe("200");
    expect(form.hostname).toBe("ct-test");
    expect(form.storage).toBe("local-lvm");
    expect(form.memory).toBe("512");
    expect(form.cores).toBe("1");
    expect(form.rootfs).toBe("local-lvm:8");
    expect(form.net0).toBe("name=eth0,bridge=vmbr0,ip=dhcp");
    expect(form.start).toBe("0");
  });

  it("passes metadata fields when supplied", async () => {
    fake = await startFakeProxmox([
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc",
        status: 200,
        body: { data: "UPID:pve:00010:lxc-create" },
      },
    ]);
    const tool = makeTool();
    await tool.execute("test", {
      vmid: 201,
      hostname: "ct-meta",
      ostemplate: "local:vztmpl/debian.tar.zst",
      node: "pve",
      pool: "mcp-smoke",
      onboot: true,
      unprivileged: false,
      protection: true,
      features: "nesting=1",
      description: "scratch ct",
      tags: "mcp;smoke",
      confirm: true,
    });
    const postReq = fake.requests.find((q) => q.method === "POST");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.pool).toBe("mcp-smoke");
    expect(form.onboot).toBe("1");
    expect(form.unprivileged).toBe("0");
    expect(form.protection).toBe("1");
    expect(form.features).toBe("nesting=1");
    expect(form.description).toBe("scratch ct");
    expect(form.tags).toBe("mcp;smoke");
  });

  it("registers the root password as a secret so it is redacted from output", async () => {
    fake = await startFakeProxmox([
      {
        method: "POST",
        path: "/api2/json/nodes/pve/lxc",
        status: 200,
        body: { data: "UPID:pve:00010:lxc-create" },
      },
    ]);
    const tool = makeTool();
    const secret = "s3cr3t-ct-pw-unique";
    await tool.execute("test", {
      vmid: 202,
      hostname: "ct-pw",
      ostemplate: "local:vztmpl/debian.tar.zst",
      node: "pve",
      password: secret,
      confirm: true,
    });
    // The password was still sent to Proxmox...
    const postReq = fake.requests.find((q) => q.method === "POST");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.password).toBe(secret);
    // ...but is now a registered secret, so any later redact() masks it.
    expect(redact(`password: ${secret}`)).toContain("REDACTED");
    expect(redact(`password: ${secret}`)).not.toContain(secret);
  });
});
