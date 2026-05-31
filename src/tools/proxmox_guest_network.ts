import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
  },
  { additionalProperties: false },
);

const NAME = "proxmox_guest_network";

interface QemuAgentIface {
  name?: string;
  "hardware-address"?: string;
  "ip-addresses"?: Array<{ "ip-address-type"?: string; "ip-address"?: string; prefix?: number }>;
}

interface LxcIface {
  name?: string;
  hwaddr?: string;
  inet?: string;
  inet6?: string;
}

function usableIpv4(ip: string): boolean {
  return !ip.startsWith("127.") && !ip.startsWith("169.254.") && ip !== "0.0.0.0";
}

export function createProxmoxGuestNetworkTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: guest network",
    description:
      "Return guest network interfaces and usable IPv4 addresses for a QEMU VM via guest agent or an LXC container via its interfaces endpoint.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{ vmid: number }>(Schema, raw, NAME);
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      if (type === "qemu") {
        const data = await client.get<{ result?: QemuAgentIface[] }>(
          `/nodes/${node}/qemu/${args.vmid}/agent/network-get-interfaces`,
        );
        const interfaces = data.result ?? [];
        const ipv4 = interfaces.flatMap((iface) =>
          (iface["ip-addresses"] ?? [])
            .filter((ip) => ip["ip-address-type"] === "ipv4" && ip["ip-address"] && usableIpv4(ip["ip-address"]))
            .map((ip) => ({ interface: iface.name, address: ip["ip-address"], prefix: ip.prefix })),
        );
        return jsonToolResult({ vmid: args.vmid, node, type, ipv4, interfaces });
      }
      const interfaces = await client.get<LxcIface[]>(`/nodes/${node}/lxc/${args.vmid}/interfaces`);
      const ipv4 = interfaces
        .filter((iface) => iface.inet && usableIpv4(iface.inet.split("/")[0]))
        .map((iface) => {
          const [address, prefix] = iface.inet!.split("/");
          return { interface: iface.name, address, prefix: prefix ? Number(prefix) : undefined };
        });
      return jsonToolResult({ vmid: args.vmid, node, type, ipv4, interfaces });
    },
  };
}
