import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxCreateVmTool } from "../../src/tools/proxmox_create_vm.ts";
import { WriteGateError } from "../../src/gates.ts";
import { redact } from "../../src/security.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

function makeTool() {
  return createProxmoxCreateVmTool(
    () =>
      new ProxmoxClient({
        url: fake!.baseUrl,
        tokenId: "u@pam!t",
        tokenSecret: "s",
        tlsInsecure: false,
      }),
  );
}

describe("proxmox_create_vm", () => {
  it("refuses without confirm:true", async () => {
    fake = await startFakeProxmox([]);
    const tool = makeTool();
    await expect(
      tool.execute("test", { vmid: 300, name: "vm-test" }),
    ).rejects.toThrow(WriteGateError);
  });

  it("posts form-encoded body to /nodes/{node}/qemu with defaults", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources?type=node",
        status: 200,
        body: { data: [{ node: "pve", type: "node" }] },
      },
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu",
        status: 200,
        body: { data: "UPID:pve:00011:qemu-create" },
      },
    ]);
    const tool = makeTool();
    const r = await tool.execute("test", { vmid: 300, name: "vm-test", confirm: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(300);
    expect(payload.node).toBe("pve");
    expect(payload.name).toBe("vm-test");
    expect(payload.upid).toBe("UPID:pve:00011:qemu-create");
    const postReq = fake.requests.find((q) => q.method === "POST");
    expect(postReq?.path).toBe("/api2/json/nodes/pve/qemu");
    expect(postReq?.contentType).toBe("application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.vmid).toBe("300");
    expect(form.name).toBe("vm-test");
    expect(form.memory).toBe("2048");
    expect(form.cores).toBe("2");
    expect(form.scsi0).toBe("local-lvm:32");
    expect(form.net0).toBe("model=virtio,bridge=vmbr0");
    expect(form.start).toBe("0");
    expect(form.cdrom).toBeUndefined();
    expect(form.ide2).toBeUndefined();
  });

  it("passes metadata and cloud-init fields when supplied", async () => {
    fake = await startFakeProxmox([
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu",
        status: 200,
        body: { data: "UPID:pve:00011:qemu-create" },
      },
    ]);
    const tool = makeTool();
    await tool.execute("test", {
      vmid: 301,
      name: "vm-ci",
      node: "pve",
      pool: "mcp-smoke",
      onboot: true,
      protection: true,
      agent: true,
      scsihw: "virtio-scsi-single",
      boot: "order=scsi0",
      bios: "ovmf",
      machine: "q35",
      cpu: "host",
      sockets: 1,
      description: "scratch vm",
      tags: "mcp;smoke",
      ciuser: "ubuntu",
      sshkeys: "ssh-ed25519 AAAA...",
      ipconfig0: "ip=dhcp",
      nameserver: "dns.example.test",
      searchdomain: "example.test",
      confirm: true,
    });
    const postReq = fake.requests.find((q) => q.method === "POST");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.pool).toBe("mcp-smoke");
    expect(form.onboot).toBe("1");
    expect(form.protection).toBe("1");
    expect(form.agent).toBe("1");
    expect(form.scsihw).toBe("virtio-scsi-single");
    expect(form.boot).toBe("order=scsi0");
    expect(form.bios).toBe("ovmf");
    expect(form.machine).toBe("q35");
    expect(form.cpu).toBe("host");
    expect(form.sockets).toBe("1");
    expect(form.description).toBe("scratch vm");
    expect(form.tags).toBe("mcp;smoke");
    expect(form.ciuser).toBe("ubuntu");
    expect(form.sshkeys).toBe("ssh-ed25519 AAAA...");
    expect(form.ipconfig0).toBe("ip=dhcp");
    expect(form.nameserver).toBe("dns.example.test");
    expect(form.searchdomain).toBe("example.test");
  });

  it("registers the cloud-init password as a secret so it is redacted from output", async () => {
    fake = await startFakeProxmox([
      {
        method: "POST",
        path: "/api2/json/nodes/pve/qemu",
        status: 200,
        body: { data: "UPID:pve:00011:qemu-create" },
      },
    ]);
    const tool = makeTool();
    const secret = "s3cr3t-vm-pw-unique";
    await tool.execute("test", {
      vmid: 302,
      name: "vm-pw",
      node: "pve",
      cipassword: secret,
      confirm: true,
    });
    const postReq = fake.requests.find((q) => q.method === "POST");
    const form = Object.fromEntries(new URLSearchParams(postReq?.body ?? ""));
    expect(form.cipassword).toBe(secret);
    expect(redact(`cipassword: ${secret}`)).toContain("REDACTED");
    expect(redact(`cipassword: ${secret}`)).not.toContain(secret);
  });
});
