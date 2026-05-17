import { describe, it, expect } from "vitest";
import { assertConfirmedWrite, assertDestructive, assertEnvFlag, WriteGateError } from "../src/gates.ts";

describe("assertConfirmedWrite", () => {
  it("passes when confirm is true", () => {
    expect(() => assertConfirmedWrite({ confirm: true }, "proxmox_start_resource")).not.toThrow();
  });
  it("throws when confirm is missing", () => {
    expect(() => assertConfirmedWrite({}, "proxmox_start_resource")).toThrow(WriteGateError);
  });
  it("throws when confirm is false", () => {
    expect(() => assertConfirmedWrite({ confirm: false }, "proxmox_start_resource")).toThrow(WriteGateError);
  });
  it("error message names the tool", () => {
    try { assertConfirmedWrite({}, "proxmox_start_resource"); }
    catch (e) { expect((e as Error).message).toContain("proxmox_start_resource"); }
  });
});

describe("assertDestructive", () => {
  it("passes when confirm + destructive are both true", () => {
    expect(() => assertDestructive({ confirm: true, destructive: true }, "proxmox_destroy_resource")).not.toThrow();
  });
  it("throws when only confirm is true", () => {
    expect(() => assertDestructive({ confirm: true }, "proxmox_destroy_resource")).toThrow(WriteGateError);
  });
  it("throws when only destructive is true", () => {
    expect(() => assertDestructive({ destructive: true }, "proxmox_destroy_resource")).toThrow(WriteGateError);
  });
  it("throws when both missing", () => {
    expect(() => assertDestructive({}, "proxmox_destroy_resource")).toThrow(WriteGateError);
  });
  it("error message names the tool", () => {
    try { assertDestructive({}, "proxmox_destroy_resource"); }
    catch (e) { expect((e as Error).message).toContain("proxmox_destroy_resource"); }
  });
});

describe("assertEnvFlag", () => {
  it("passes when env flag is 'true' (case-insensitive)", () => {
    for (const v of ["true", "True", "TRUE", "1", "yes", "YES"]) {
      expect(() => assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", "proxmox_destroy_resource", { PROXMOX_ENABLE_DESTRUCTIVE: v })).not.toThrow();
    }
  });
  it("throws when env flag is unset", () => {
    expect(() => assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", "proxmox_destroy_resource", {})).toThrow(WriteGateError);
  });
  it("throws when env flag is empty/false-y", () => {
    for (const v of ["false", "0", "no", ""]) {
      expect(() => assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", "proxmox_destroy_resource", { PROXMOX_ENABLE_DESTRUCTIVE: v })).toThrow(WriteGateError);
    }
  });
  it("error message names the tool + the env key", () => {
    try { assertEnvFlag("PROXMOX_ENABLE_DESTRUCTIVE", "proxmox_destroy_resource", {}); }
    catch (e) {
      expect((e as Error).message).toContain("proxmox_destroy_resource");
      expect((e as Error).message).toContain("PROXMOX_ENABLE_DESTRUCTIVE");
    }
  });
});
