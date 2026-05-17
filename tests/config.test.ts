import { describe, it, expect } from "vitest";
import { resolveConfig, ConfigError } from "../src/config.ts";

describe("resolveConfig", () => {
  it("parses required env", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006",
      PROXMOX_TOKEN_ID: "u@pam!t1",
      PROXMOX_TOKEN_SECRET: "secret-uuid",
    });
    expect(cfg.url).toBe("https://pve.local:8006");
    expect(cfg.tokenId).toBe("u@pam!t1");
    expect(cfg.tokenSecret).toBe("secret-uuid");
    expect(cfg.tlsInsecure).toBe(false);
  });

  it("parses TLS insecure flag (true/1/yes/case-insensitive)", () => {
    for (const v of ["true", "True", "1", "yes", "YES"]) {
      const cfg = resolveConfig({
        PROXMOX_URL: "https://x:8006",
        PROXMOX_TOKEN_ID: "u@pam!t",
        PROXMOX_TOKEN_SECRET: "s",
        PROXMOX_TLS_INSECURE: v,
      });
      expect(cfg.tlsInsecure).toBe(true);
    }
  });

  it("TLS insecure defaults false on falsy values", () => {
    for (const v of ["false", "0", "no", "", undefined]) {
      const cfg = resolveConfig({
        PROXMOX_URL: "https://x:8006",
        PROXMOX_TOKEN_ID: "u@pam!t",
        PROXMOX_TOKEN_SECRET: "s",
        ...(v === undefined ? {} : { PROXMOX_TLS_INSECURE: v }),
      });
      expect(cfg.tlsInsecure).toBe(false);
    }
  });

  it("throws ConfigError on missing PROXMOX_URL", () => {
    expect(() => resolveConfig({ PROXMOX_TOKEN_ID: "x", PROXMOX_TOKEN_SECRET: "y" })).toThrow(ConfigError);
  });

  it("throws ConfigError on missing PROXMOX_TOKEN_ID", () => {
    expect(() => resolveConfig({ PROXMOX_URL: "https://x", PROXMOX_TOKEN_SECRET: "y" })).toThrow(ConfigError);
  });

  it("throws ConfigError on missing PROXMOX_TOKEN_SECRET", () => {
    expect(() => resolveConfig({ PROXMOX_URL: "https://x", PROXMOX_TOKEN_ID: "y" })).toThrow(ConfigError);
  });

  it("strips trailing slash from PROXMOX_URL", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006/",
      PROXMOX_TOKEN_ID: "u@pam!t",
      PROXMOX_TOKEN_SECRET: "s",
    });
    expect(cfg.url).toBe("https://pve.local:8006");
  });
});
