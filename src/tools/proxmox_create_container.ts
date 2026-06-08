import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";
import { registerSecret } from "../security.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "VMID for the new container." }),
    hostname: Type.String({ minLength: 1, description: "Container hostname." }),
    ostemplate: Type.String({
      minLength: 1,
      description: "OS template volid (e.g. 'local:vztmpl/ubuntu-24.04-standard_*.tar.zst').",
    }),
    node: Type.Optional(
      Type.String({ minLength: 1, description: "Node to create on (defaults to first node)." }),
    ),
    storage: Type.Optional(
      Type.String({ minLength: 1, description: "Root storage (default 'local-lvm')." }),
    ),
    memory: Type.Optional(
      Type.Integer({ minimum: 16, description: "Memory in MiB (default 512)." }),
    ),
    cores: Type.Optional(
      Type.Integer({ minimum: 1, description: "CPU cores (default 1)." }),
    ),
    rootfs_size: Type.Optional(
      Type.String({ minLength: 1, description: "Root filesystem size in GB (default '8')." }),
    ),
    net: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Network config for net0 (default 'name=eth0,bridge=vmbr0,ip=dhcp').",
      }),
    ),
    start: Type.Optional(
      Type.Boolean({ description: "Start after create (default false)." }),
    ),
    pool: Type.Optional(
      Type.String({ minLength: 1, description: "Optional resource pool ID to place the container into." }),
    ),
    onboot: Type.Optional(
      Type.Boolean({ description: "Start container on host boot (default false)." }),
    ),
    unprivileged: Type.Optional(
      Type.Boolean({ description: "Create an unprivileged container (default true)." }),
    ),
    protection: Type.Optional(
      Type.Boolean({ description: "Enable Proxmox protection flag (default false)." }),
    ),
    features: Type.Optional(
      Type.String({ minLength: 1, description: "Optional LXC features string, e.g. 'nesting=1'." }),
    ),
    description: Type.Optional(
      Type.String({ description: "Optional container description." }),
    ),
    tags: Type.Optional(
      Type.String({ minLength: 1, description: "Optional semicolon-delimited Proxmox tags." }),
    ),
    password: Type.Optional(
      Type.String({ description: "Root password (optional)." }),
    ),
    ssh_public_keys: Type.Optional(
      Type.String({ description: "SSH public keys (optional)." }),
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

const NAME = "proxmox_create_container";

export function createProxmoxCreateContainerTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: create container",
    description:
      "Create a new LXC container on a node (POST /nodes/{node}/lxc) with sensible defaults (storage local-lvm, 512MiB, 1 core, 8GB rootfs, DHCP net). Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = validateToolArgs<{
        vmid: number;
        hostname: string;
        ostemplate: string;
        node?: string;
        storage?: string;
        memory?: number;
        cores?: number;
        rootfs_size?: string;
        net?: string;
        start?: boolean;
        pool?: string;
        onboot?: boolean;
        unprivileged?: boolean;
        protection?: boolean;
        features?: string;
        description?: string;
        tags?: string;
        password?: string;
        ssh_public_keys?: string;
        confirm: boolean;
      }>(Schema, raw, NAME);
      if (typeof args.password === "string" && args.password.length > 0) {
        registerSecret(args.password);
      }
      const client = getClient();
      let node = args.node;
      if (!node) {
        const nodes = await client.get<NodeResource[]>("/cluster/resources?type=node");
        if (nodes.length === 0) throw new Error("no nodes found in cluster resources");
        node = nodes[0].node;
      }
      const storage = args.storage ?? "local-lvm";
      const rootfsSize = args.rootfs_size ?? "8";
      const body: Record<string, unknown> = {
        vmid: args.vmid,
        hostname: args.hostname,
        ostemplate: args.ostemplate,
        storage,
        memory: args.memory ?? 512,
        cores: args.cores ?? 1,
        rootfs: `${storage}:${rootfsSize}`,
        net0: args.net ?? "name=eth0,bridge=vmbr0,ip=dhcp",
        start: args.start ? 1 : 0,
        onboot: args.onboot ? 1 : 0,
        unprivileged: args.unprivileged === false ? 0 : 1,
        protection: args.protection ? 1 : 0,
      };
      for (const key of ["pool", "features"] as const) {
        const value = args[key];
        if (typeof value === "string" && value.length > 0) body[key] = value;
      }
      if (typeof args.password === "string" && args.password.length > 0) {
        body.password = args.password;
      }
      if (typeof args.ssh_public_keys === "string" && args.ssh_public_keys.length > 0) {
        body["ssh-public-keys"] = args.ssh_public_keys;
      }
      if (typeof args.description === "string" && args.description.length > 0) {
        body.description = args.description;
      }
      if (typeof args.tags === "string" && args.tags.length > 0) {
        body.tags = args.tags;
      }
      const upid = await client.post<string>(`/nodes/${node}/lxc`, body);
      return jsonToolResult({
        vmid: args.vmid,
        node,
        hostname: args.hostname,
        upid,
      });
    },
  };
}
