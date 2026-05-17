import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

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
      const args = raw as {
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
      };
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
      };
      if (typeof args.iso === "string" && args.iso.length > 0) {
        body.cdrom = args.iso;
        body.ide2 = `${args.iso},media=cdrom`;
      }
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
