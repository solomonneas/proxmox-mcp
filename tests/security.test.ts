import { describe, it, expect } from "vitest";
import { redact, registerSecret } from "../src/security.ts";

describe("redact", () => {
  it("masks registered secrets in strings", () => {
    registerSecret("super-secret-uuid");
    expect(redact("token: super-secret-uuid")).toContain("REDACTED");
  });

  it("walks objects + arrays deeply", () => {
    registerSecret("hidden-uuid");
    const out = redact({ headers: { authorization: "PVEAPIToken=u@pam!t=hidden-uuid" }, ok: true });
    expect(JSON.stringify(out)).not.toContain("hidden-uuid");
  });

  it("passes non-strings through unchanged", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });

  it("ignores empty secret registrations", () => {
    registerSecret("");
    expect(redact("anything")).toBe("anything");
  });
});
