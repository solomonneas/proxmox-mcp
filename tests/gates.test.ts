import { describe, it, expect } from "vitest";
import { assertConfirmedWrite, WriteGateError } from "../src/gates.ts";

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
