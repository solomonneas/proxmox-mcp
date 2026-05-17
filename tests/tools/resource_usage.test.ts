import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxResourceUsageTool } from "../../src/tools/proxmox_resource_usage.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
});

describe("proxmox_resource_usage", () => {
  it("resolves vmid and fetches hourly rrddata by default", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 110, node: "pve", type: "qemu" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/qemu/110/rrddata?timeframe=hour",
        status: 200,
        body: {
          data: [
            { time: 1234567890, cpu: 0.05, mem: 512 },
            { time: 1234567950, cpu: 0.08, mem: 520 },
          ],
        },
      },
    ]);
    const tool = createProxmoxResourceUsageTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { vmid: 110 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.vmid).toBe(110);
    expect(payload.node).toBe("pve");
    expect(payload.type).toBe("qemu");
    expect(payload.timeframe).toBe("hour");
    expect(payload.samples).toHaveLength(2);
  });

  it("honors timeframe argument", async () => {
    fake = await startFakeProxmox([
      {
        method: "GET",
        path: "/api2/json/cluster/resources",
        status: 200,
        body: { data: [{ vmid: 100, node: "pve", type: "lxc" }] },
      },
      {
        method: "GET",
        path: "/api2/json/nodes/pve/lxc/100/rrddata?timeframe=day",
        status: 200,
        body: { data: [{ time: 1, cpu: 0.5 }] },
      },
    ]);
    const tool = createProxmoxResourceUsageTool(
      () =>
        new ProxmoxClient({
          url: fake!.baseUrl,
          tokenId: "u@pam!t",
          tokenSecret: "s",
          tlsInsecure: false,
        }),
    );
    const r = await tool.execute("test", { vmid: 100, timeframe: "day" });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.timeframe).toBe("day");
    expect(payload.samples).toHaveLength(1);
  });
});
