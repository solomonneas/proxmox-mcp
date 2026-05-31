import { describe, it, expect } from "vitest";
import { classifyToolError } from "../src/errors.ts";
import { WriteGateError } from "../src/gates.ts";
import { ProxmoxClientError, ProxmoxUnreachableError } from "../src/proxmox-client.ts";
import { SshExecError } from "../src/ssh-executor.ts";
import { ToolInputError } from "../src/tools/_util.ts";

describe("classifyToolError", () => {
  it("classifies common tool failure modes with stable codes", () => {
    expect(classifyToolError(new ToolInputError("bad input")).code).toBe("TOOL_INPUT_INVALID");
    expect(classifyToolError(new WriteGateError("tool is a write operation. Pass confirm")).code).toBe(
      "WRITE_CONFIRMATION_REQUIRED",
    );
    expect(classifyToolError(new WriteGateError("tool requires env flag PROXMOX_ENABLE_DESTRUCTIVE=1")).code).toBe(
      "DESTRUCTIVE_ENV_REQUIRED",
    );
    expect(classifyToolError(new ProxmoxClientError(403, "permission denied")).code).toBe("PROXMOX_HTTP_403");
    expect(classifyToolError(new ProxmoxUnreachableError("HTTP 503")).code).toBe("PROXMOX_UNREACHABLE");
    expect(classifyToolError(new SshExecError("connect", "refused")).code).toBe("SSH_CONNECT_FAILED");
    expect(classifyToolError(new Error("vmid 999 not found in cluster resources (not an LXC or VM)")).code).toBe(
      "VMID_NOT_FOUND",
    );
  });
});
