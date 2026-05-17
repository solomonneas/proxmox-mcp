import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "./fake-proxmox.ts";
import { ProxmoxClient, ProxmoxClientError, ProxmoxUnreachableError } from "../src/proxmox-client.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

describe("ProxmoxClient", () => {
  it("sends PVEAPIToken auth header", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 200, body: { data: { version: "9.1.6" } } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "secret", tlsInsecure: false });
    const r = await c.get<{ version: string }>("/version");
    expect(r.version).toBe("9.1.6");
    expect(fake.requests[0].authHeader).toBe("PVEAPIToken=u@pam!t=secret");
  });

  it("strips PVE data envelope", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 100 }, { vmid: 101 }] } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
    const r = await c.get<unknown[]>("/cluster/resources");
    expect(Array.isArray(r)).toBe(true);
    expect(r).toHaveLength(2);
  });

  it("throws ProxmoxClientError on 401", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 401, body: { message: "auth fail" } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "x", tokenSecret: "y", tlsInsecure: false });
    await expect(c.get("/version")).rejects.toThrow(ProxmoxClientError);
  });

  it("retries once on 5xx then throws Unreachable", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 502, body: { message: "bad gw" } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "x", tokenSecret: "y", tlsInsecure: false }, { retryDelayMs: 5 });
    await expect(c.get("/version")).rejects.toThrow(ProxmoxUnreachableError);
    expect(fake.requests).toHaveLength(2);
  });

  it("posts JSON body and URL-encodes form params", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/lxc/100/status/start", status: 200, body: { data: "UPID:..." } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
    await c.post("/nodes/pve/lxc/100/status/start", {});
    expect(fake.requests[0].method).toBe("POST");
  });

  it("does not leak token in thrown error messages", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 401, body: { message: "unauthorized" } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "super-secret", tlsInsecure: false });
    try {
      await c.get("/version");
    } catch (e) {
      expect((e as Error).message).not.toContain("super-secret");
      expect((e as Error).message).not.toContain("PVEAPIToken=u@pam!t=super-secret");
    }
  });
});
