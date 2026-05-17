import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

interface Version {
  version: string;
  release?: string;
  repoid?: string;
}

interface Node {
  node: string;
  status: string;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  uptime?: number;
}

export function createProxmoxStatusTool(getClient: ClientFactory) {
  return {
    name: "proxmox_status",
    label: "proxmox: status",
    description:
      "Get PVE version + per-node status (online state, CPU, memory, uptime) via GET /version + GET /cluster/resources?type=node.",
    parameters: Schema,
    execute: async () => {
      const client = getClient();
      const [version, nodes] = await Promise.all([
        client.get<Version>("/version"),
        client.get<Node[]>("/cluster/resources?type=node"),
      ]);
      return jsonToolResult({ version: version.version, release: version.release, nodes });
    },
  };
}
