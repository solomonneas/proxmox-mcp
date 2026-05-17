import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

interface VmResource {
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

export function createProxmoxListVmsTool(getClient: ClientFactory) {
  return {
    name: "proxmox_list_vms",
    label: "proxmox: list VMs",
    description:
      "List every QEMU VM across the cluster (vmid, name, node, status, CPU/mem) via GET /cluster/resources?type=vm filtered client-side to type=qemu.",
    parameters: Schema,
    execute: async () => {
      const client = getClient();
      const all = await client.get<Array<VmResource & { type: string }>>("/cluster/resources?type=vm");
      const vms = all.filter((r) => r.type === "qemu");
      return jsonToolResult({ count: vms.length, vms });
    },
  };
}
