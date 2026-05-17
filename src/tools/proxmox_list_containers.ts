import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

interface ContainerResource {
  vmid: number;
  name?: string;
  node: string;
  status: string;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  uptime?: number;
  tags?: string;
}

export function createProxmoxListContainersTool(getClient: ClientFactory) {
  return {
    name: "proxmox_list_containers",
    label: "proxmox: list containers",
    description:
      "List every LXC container across the cluster (vmid, name, node, status, CPU/mem) via GET /cluster/resources?type=vm filtered client-side to type=lxc.",
    parameters: Schema,
    execute: async () => {
      const client = getClient();
      const all = await client.get<Array<ContainerResource & { type: string }>>("/cluster/resources?type=vm");
      const containers = all.filter((r) => r.type === "lxc");
      return jsonToolResult({ count: containers.length, containers });
    },
  };
}
