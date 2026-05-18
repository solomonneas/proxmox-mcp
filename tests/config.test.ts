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

  it("resolves ssh defaults from PROXMOX_URL hostname when PROXMOX_SSH_HOST not set", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://192.0.2.10:8006",
      PROXMOX_TOKEN_ID: "u@pam!t",
      PROXMOX_TOKEN_SECRET: "s",
    });
    expect(cfg.ssh.host).toBe("192.0.2.10");
    expect(cfg.ssh.port).toBe(22);
    expect(cfg.ssh.user).toBe("root");
    expect(cfg.ssh.keyPath).toBe("~/.ssh/id_ed25519");
    expect(cfg.ssh.vmUser).toBe("root");
    expect(cfg.ssh.vmKeyPath).toBe("~/.ssh/id_ed25519");
  });

  it("honors explicit PROXMOX_SSH_* env vars", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006",
      PROXMOX_TOKEN_ID: "u@pam!t",
      PROXMOX_TOKEN_SECRET: "s",
      PROXMOX_SSH_HOST: "192.0.2.10",
      PROXMOX_SSH_PORT: "2222",
      PROXMOX_SSH_USER: "claude",
      PROXMOX_SSH_KEY: "~/.ssh/id_ed25519_proxmox",
    });
    expect(cfg.ssh.host).toBe("192.0.2.10");
    expect(cfg.ssh.port).toBe(2222);
    expect(cfg.ssh.user).toBe("claude");
    expect(cfg.ssh.keyPath).toBe("~/.ssh/id_ed25519_proxmox");
  });

  it("falls VM SSH user/key through to host SSH user/key when VM-specific not set", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006",
      PROXMOX_TOKEN_ID: "u@pam!t",
      PROXMOX_TOKEN_SECRET: "s",
      PROXMOX_SSH_USER: "claude",
      PROXMOX_SSH_KEY: "/keys/host",
    });
    expect(cfg.ssh.vmUser).toBe("claude");
    expect(cfg.ssh.vmKeyPath).toBe("/keys/host");
  });

  it("honors PROXMOX_VM_SSH_USER and PROXMOX_VM_SSH_KEY when set", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006",
      PROXMOX_TOKEN_ID: "u@pam!t",
      PROXMOX_TOKEN_SECRET: "s",
      PROXMOX_SSH_USER: "claude",
      PROXMOX_SSH_KEY: "/keys/host",
      PROXMOX_VM_SSH_USER: "ubuntu",
      PROXMOX_VM_SSH_KEY: "/keys/vm",
    });
    expect(cfg.ssh.vmUser).toBe("ubuntu");
    expect(cfg.ssh.vmKeyPath).toBe("/keys/vm");
  });
});
