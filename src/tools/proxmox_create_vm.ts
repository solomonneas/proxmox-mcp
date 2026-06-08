import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { registerSecret } from "../security.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "VMID for the new VM." }),
    name: Type.String({ minLength: 1, description: "VM display name." }),
    node: Type.Optional(
      Type.String({ minLength: 1, description: "Node to create on (defaults to first node)." }),
    ),
    memory: Type.Optional(
      Type.Integer({ minimum: 16, description: "Memory in MiB (default 2048)." }),
    ),
    cores: Type.Optional(
      Type.Integer({ minimum: 1, description: "CPU cores (default 2)." }),
    ),
    iso: Type.Optional(
      Type.String({
        minLength: 1,
        description: "ISO volid for install media (e.g. 'local:iso/ubuntu-24.04.iso'). If set, attaches as ide2 cdrom.",
      }),
    ),
    disk_size: Type.Optional(
      Type.String({ minLength: 1, description: "Primary disk size in GB on scsi0 (default '32')." }),
    ),
    storage: Type.Optional(
      Type.String({ minLength: 1, description: "Disk storage (default 'local-lvm')." }),
    ),
    net: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Network config for net0 (default 'model=virtio,bridge=vmbr0').",
      }),
    ),
    start: Type.Optional(
      Type.Boolean({ description: "Start after create (default false)." }),
    ),
    pool: Type.Optional(
      Type.String({ minLength: 1, description: "Optional resource pool ID to place the VM into." }),
    ),
    onboot: Type.Optional(
      Type.Boolean({ description: "Start VM on host boot (default false)." }),
    ),
    protection: Type.Optional(
      Type.Boolean({ description: "Enable Proxmox protection flag (default false)." }),
    ),
    agent: Type.Optional(
      Type.Boolean({ description: "Enable QEMU guest agent in VM config (default false)." }),
    ),
    scsihw: Type.Optional(
      Type.String({ minLength: 1, description: "Optional SCSI controller, e.g. 'virtio-scsi-pci'." }),
    ),
    boot: Type.Optional(
      Type.String({ minLength: 1, description: "Optional boot order string." }),
    ),
    bios: Type.Optional(
      Type.Union([Type.Literal("seabios"), Type.Literal("ovmf")], { description: "Optional VM BIOS type." }),
    ),
    machine: Type.Optional(
      Type.String({ minLength: 1, description: "Optional machine type." }),
    ),
    cpu: Type.Optional(
      Type.String({ minLength: 1, description: "Optional CPU type." }),
    ),
    sockets: Type.Optional(
      Type.Integer({ minimum: 1, description: "Optional socket count." }),
    ),
    description: Type.Optional(
      Type.String({ description: "Optional VM description." }),
    ),
    tags: Type.Optional(
      Type.String({ minLength: 1, description: "Optional semicolon-delimited Proxmox tags." }),
    ),
    ciuser: Type.Optional(
      Type.String({ minLength: 1, description: "Optional cloud-init username." }),
    ),
    cipassword: Type.Optional(
      Type.String({ description: "Optional cloud-init password." }),
    ),
    sshkeys: Type.Optional(
      Type.String({ description: "Optional cloud-init SSH public keys." }),
    ),
    ipconfig0: Type.Optional(
      Type.String({ minLength: 1, description: "Optional cloud-init ipconfig0, e.g. 'ip=dhcp'." }),
    ),
    nameserver: Type.Optional(
      Type.String({ minLength: 1, description: "Optional cloud-init DNS server list." }),
    ),
    searchdomain: Type.Optional(
      Type.String({ minLength: 1, description: "Optional cloud-init DNS search domain." }),
    ),
    confirm: Type.Boolean({
      description: "Must be true to write. Tier-2 safe-write gate.",
    }),
  },
  { additionalProperties: false },
);

interface NodeResource {
  node: string;
  type: string;
}

const NAME = "proxmox_create_vm";

export function createProxmoxCreateVmTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create vm",
    description:
      "Create a new QEMU VM on a node (POST /nodes/{node}/qemu) with sensible defaults (2GiB, 2 cores, 32GB disk on local-lvm, virtio net). Optionally attaches an ISO as ide2 cdrom. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        name: string;
        node?: string;
        memory?: number;
        cores?: number;
        iso?: string;
        disk_size?: string;
        storage?: string;
        net?: string;
        start?: boolean;
        pool?: string;
        onboot?: boolean;
        protection?: boolean;
        agent?: boolean;
        scsihw?: string;
        boot?: string;
        bios?: "seabios" | "ovmf";
        machine?: string;
        cpu?: string;
        sockets?: number;
        description?: string;
        tags?: string;
        ciuser?: string;
        cipassword?: string;
        sshkeys?: string;
        ipconfig0?: string;
        nameserver?: string;
        searchdomain?: string;
        confirm: boolean;
      }>(Schema, raw, NAME);
      if (typeof args.cipassword === "string" && args.cipassword.length > 0) {
        registerSecret(args.cipassword);
      }
      const client = getClient();
      let node = args.node;
      if (!node) {
        const nodes = await client.get<NodeResource[]>("/cluster/resources?type=node");
        if (nodes.length === 0) throw new Error("no nodes found in cluster resources");
        node = nodes[0].node;
      }
      const storage = args.storage ?? "local-lvm";
      const diskSize = args.disk_size ?? "32";
      const body: Record<string, unknown> = {
        vmid: args.vmid,
        name: args.name,
        memory: args.memory ?? 2048,
        cores: args.cores ?? 2,
        scsi0: `${storage}:${diskSize}`,
        net0: args.net ?? "model=virtio,bridge=vmbr0",
        start: args.start ? 1 : 0,
        onboot: args.onboot ? 1 : 0,
        protection: args.protection ? 1 : 0,
        agent: args.agent ? 1 : 0,
      };
      if (typeof args.iso === "string" && args.iso.length > 0) {
        body.ide2 = `${args.iso},media=cdrom`;
      }
      for (const key of ["pool", "scsihw", "boot", "bios", "machine", "cpu", "description", "tags", "ciuser", "cipassword", "sshkeys", "ipconfig0", "nameserver", "searchdomain"] as const) {
        const value = args[key];
        if (typeof value === "string" && value.length > 0) body[key] = value;
      }
      if (typeof args.sockets === "number") body.sockets = args.sockets;
      const upid = await client.post<string>(`/nodes/${node}/qemu`, body);
      return jsonToolResult({
        vmid: args.vmid,
        node,
        name: args.name,
        upid,
      });
    },
  };
}
