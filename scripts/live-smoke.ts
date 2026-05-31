import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolveConfig } from "../src/config.ts";
import { ProxmoxClient } from "../src/proxmox-client.ts";
import { execInLxc, execViaDirectSsh } from "../src/ssh-executor.ts";
import {
  createProxmoxCloneResourceTool,
  createProxmoxCreateContainerTool,
  createProxmoxDestroyResourceTool,
  createProxmoxExecTool,
  createProxmoxGetResourceTool,
  createProxmoxGuestNetworkTool,
  createProxmoxListStorageTool,
  createProxmoxListTemplatesTool,
  createProxmoxNextVmidTool,
  createProxmoxServiceRestartTool,
  createProxmoxServiceStartTool,
  createProxmoxServiceStatusTool,
  createProxmoxServiceStopTool,
  createProxmoxStartResourceTool,
  createProxmoxStopResourceTool,
  createProxmoxWaitTaskTool,
} from "../src/tools/index.ts";
import type { SshExecutor } from "../src/tools/_util.ts";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function log(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload));
}

function parseTool<T>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(result.content[0].text) as T;
}

function optionalIntegerEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
}

async function waitOk(getClient: () => ProxmoxClient, upid: string, step: string): Promise<boolean> {
  const waited = parseTool<{ done: boolean; status?: { exitstatus?: string } }>(
    await createProxmoxWaitTaskTool(getClient).execute("smoke", {
      upid,
      timeoutSeconds: 180,
      intervalMs: 1000,
    }),
  );
  log({ step, done: waited.done, exitstatus: waited.status?.exitstatus });
  return waited.done && waited.status?.exitstatus === "OK";
}

async function grantSmokeVmid(vmid: number) {
  if (process.env.PROXMOX_SMOKE_SKIP_AUTO_GRANT === "1") return;
  if (!process.env.PROXMOX_SSH_HOST || !process.env.PROXMOX_SSH_USER || !process.env.PROXMOX_SSH_KEY) {
    log({ step: "vmid_grant_skipped", vmid, reason: "missing PROXMOX_SSH_HOST/USER/KEY" });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "bash",
      ["scripts/create-smoke-token.sh"],
      {
        env: {
          ...process.env,
          PROXMOX_CREATE_SMOKE_TOKEN: "1",
          PROXMOX_SMOKE_GRANT_ONLY: "1",
          PROXMOX_SMOKE_VMID_GRANT: String(vmid),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        log({ step: "vmid_grant", vmid, ok: true });
        resolve();
      } else {
        reject(new Error(stderr.trim() || `VMID grant failed with exit code ${code}`));
      }
    });
  });
}

async function runSystemdServiceSmoke(
  getClient: () => ProxmoxClient,
  getSsh: () => SshExecutor,
  vmDefaults: { vmUser: string; vmKeyPath: string },
) {
  const vmid = optionalIntegerEnv("PROXMOX_SMOKE_SYSTEMD_VMID");
  if (!vmid) return false;
  const serviceName = process.env.PROXMOX_SMOKE_SERVICE ?? "basic.target";
  const service = parseTool<{ status: Record<string, string> }>(
    await createProxmoxServiceStatusTool(getClient, getSsh, vmDefaults).execute("smoke", {
      vmid,
      service: serviceName,
      confirm: true,
    }),
  );
  log({
    step: "systemd_service_status",
    vmid,
    service: serviceName,
    active: service.status.ActiveState,
    load: service.status.LoadState,
  });

  const action = process.env.PROXMOX_SMOKE_SERVICE_ACTION;
  if (!action) {
    log({ step: "systemd_service_action_skipped", vmid, reason: "set PROXMOX_SMOKE_SERVICE_ACTION=start|stop|restart" });
    return true;
  }
  if (!["start", "stop", "restart"].includes(action)) {
    throw new Error("PROXMOX_SMOKE_SERVICE_ACTION must be start, stop, or restart");
  }
  if (process.env.PROXMOX_SMOKE_SERVICE_ACTION_CONFIRM !== "1") {
    throw new Error("Set PROXMOX_SMOKE_SERVICE_ACTION_CONFIRM=1 to run a live guest service action.");
  }
  const tool =
    action === "start"
      ? createProxmoxServiceStartTool(getClient, getSsh, vmDefaults)
      : action === "stop"
        ? createProxmoxServiceStopTool(getClient, getSsh, vmDefaults)
        : createProxmoxServiceRestartTool(getClient, getSsh, vmDefaults);
  const result = parseTool<{ status: Record<string, string> }>(
    await tool.execute("smoke", { vmid, service: serviceName, confirm: true }),
  );
  log({
    step: "systemd_service_action",
    vmid,
    service: serviceName,
    action,
    active: result.status.ActiveState,
    load: result.status.LoadState,
  });
  return true;
}

async function runQemuCloneSmoke(
  getClient: () => ProxmoxClient,
  sourceVmid: number,
  defaultNewVmid: number,
  pool: string,
) {
  if (process.env.PROXMOX_ENABLE_DESTRUCTIVE !== "1") {
    throw new Error("Set PROXMOX_ENABLE_DESTRUCTIVE=1 so cleanup can destroy the scratch QEMU clone.");
  }
  const newVmid = optionalIntegerEnv("PROXMOX_SMOKE_QEMU_TARGET_VMID") ?? defaultNewVmid;
  const name = process.env.PROXMOX_SMOKE_QEMU_NAME ?? `mcp-smoke-qemu-${newVmid}`;
  let created = false;

  try {
    await grantSmokeVmid(sourceVmid);
    await grantSmokeVmid(newVmid);
    const clone = parseTool<{ upid: string }>(
      await createProxmoxCloneResourceTool(getClient).execute("smoke", {
        source_vmid: sourceVmid,
        new_vmid: newVmid,
        name,
        full: true,
        pool,
        description: "proxmox-mcp live smoke scratch QEMU clone",
        confirm: true,
      }),
    );
    created = true;
    log({ step: "qemu_clone", source_vmid: sourceVmid, vmid: newVmid, upid: clone.upid });
    if (!(await waitOk(getClient, clone.upid, "qemu_clone_wait"))) throw new Error("QEMU clone task did not finish OK.");

    const start = parseTool<{ upid: string }>(
      await createProxmoxStartResourceTool(getClient).execute("smoke", { vmid: newVmid, confirm: true }),
    );
    log({ step: "qemu_start", vmid: newVmid, upid: start.upid });
    if (!(await waitOk(getClient, start.upid, "qemu_start_wait"))) throw new Error("QEMU start task did not finish OK.");

    const network = parseTool<{ ipv4: unknown[] }>(
      await createProxmoxGuestNetworkTool(getClient).execute("smoke", { vmid: newVmid }),
    );
    log({ step: "qemu_network", vmid: newVmid, ipv4_count: network.ipv4.length });

    const stop = parseTool<{ upid: string }>(
      await createProxmoxStopResourceTool(getClient).execute("smoke", {
        vmid: newVmid,
        timeoutSeconds: 60,
        confirm: true,
      }),
    );
    log({ step: "qemu_stop", vmid: newVmid, upid: stop.upid });
    await waitOk(getClient, stop.upid, "qemu_stop_wait");
  } finally {
    if (created) {
      const destroy = parseTool<{ upid: string }>(
        await createProxmoxDestroyResourceTool(getClient).execute("smoke", {
          vmid: newVmid,
          purge: true,
          confirm: true,
          destructive: true,
        }),
      );
      log({ step: "qemu_destroy", vmid: newVmid, upid: destroy.upid });
      await waitOk(getClient, destroy.upid, "qemu_destroy_wait");
    }
  }
}

async function main() {
  if (process.env.PROXMOX_ENABLE_LIVE_SMOKE !== "1") {
    throw new Error("Set PROXMOX_ENABLE_LIVE_SMOKE=1 to run live smoke tests.");
  }

  const cfg = resolveConfig(process.env);
  const getClient = () => new ProxmoxClient(cfg, { retryDelayMs: 100 });
  const hostCfg = { host: cfg.ssh.host, port: cfg.ssh.port, user: cfg.ssh.user, keyPath: cfg.ssh.keyPath };
  const getSsh = (): SshExecutor => ({
    execInLxc: (vmid, command, timeoutMs, stdin) => execInLxc(hostCfg, vmid, command, timeoutMs, stdin),
    execViaDirectSsh: (target, command, timeoutMs, stdin) => execViaDirectSsh(target, command, timeoutMs, stdin),
  });
  const vmDefaults = { vmUser: cfg.ssh.vmUser, vmKeyPath: cfg.ssh.vmKeyPath };

  const storage = parseTool<{ count: number; nodes: unknown[] }>(
    await createProxmoxListStorageTool(getClient).execute("smoke", {}),
  );
  const templates = parseTool<{ container_templates?: Array<{ volid: string }> }>(
    await createProxmoxListTemplatesTool(getClient).execute("smoke", { kind: "vztmpl" }),
  );
  const next = parseTool<{ vmid: number }>(await createProxmoxNextVmidTool(getClient).execute("smoke", {}));
  log({
    step: "readiness",
    storage_count: storage.count,
    template_count: templates.container_templates?.length ?? 0,
    next_vmid: next.vmid,
  });

  const pool = process.env.PROXMOX_SMOKE_POOL ?? "mcp-smoke";

  const ranServiceSmoke = await runSystemdServiceSmoke(getClient, getSsh, vmDefaults);

  if (process.env.PROXMOX_SMOKE_CREATE === "1") {
    if (process.env.PROXMOX_ENABLE_DESTRUCTIVE !== "1") {
      throw new Error("Set PROXMOX_ENABLE_DESTRUCTIVE=1 so cleanup can destroy the scratch CT.");
    }

    const template = templates.container_templates?.[0]?.volid;
    if (!template) throw new Error("No LXC template found for live smoke.");

    const storageRoot = process.env.PROXMOX_SMOKE_ROOT_STORAGE ?? "local-lvm";
    const vmid = optionalIntegerEnv("PROXMOX_SMOKE_VMID") ?? next.vmid;
    const hostname = `mcp-smoke-${vmid}`;
    const sshPublicKeyPath = process.env.PROXMOX_SMOKE_SSH_PUBLIC_KEY ?? `${requireEnv("HOME")}/.ssh/id_ed25519.pub`;
    const sshPublicKey = await readFile(sshPublicKeyPath, "utf8");
    let created = false;

    try {
      await grantSmokeVmid(vmid);
      const create = parseTool<{ upid: string }>(
        await createProxmoxCreateContainerTool(getClient).execute("smoke", {
          vmid,
          hostname,
          ostemplate: template,
          storage: storageRoot,
          memory: 128,
          cores: 1,
          rootfs_size: "1",
          net: "name=eth0,bridge=vmbr0,ip=dhcp",
          start: false,
          pool,
          ssh_public_keys: sshPublicKey,
          description: "proxmox-mcp live smoke scratch CT",
          tags: "mcp;smoke",
          confirm: true,
        }),
      );
      created = true;
      log({ step: "create", vmid, upid: create.upid });
      if (!(await waitOk(getClient, create.upid, "create_wait"))) throw new Error("Create task did not finish OK.");

      const resource = parseTool<{ type: string; status?: { status?: string } }>(
        await createProxmoxGetResourceTool(getClient).execute("smoke", { vmid }),
      );
      log({ step: "created_resource", vmid, type: resource.type, status: resource.status?.status });

      const start = parseTool<{ upid: string }>(
        await createProxmoxStartResourceTool(getClient).execute("smoke", { vmid, confirm: true }),
      );
      log({ step: "start", vmid, upid: start.upid });
      if (!(await waitOk(getClient, start.upid, "start_wait"))) throw new Error("Start task did not finish OK.");

      const network = parseTool<{ ipv4: unknown[] }>(
        await createProxmoxGuestNetworkTool(getClient).execute("smoke", { vmid }),
      );
      log({ step: "network", vmid, ipv4_count: network.ipv4.length });

      const exec = parseTool<{ exit_code: number; stdout: string }>(
        await createProxmoxExecTool(getClient, getSsh, vmDefaults).execute("smoke", {
          vmid,
          command: "printf smoke-ok",
          confirm: true,
        }),
      );
      log({ step: "exec", vmid, exit_code: exec.exit_code, stdout: exec.stdout });
      if (exec.exit_code !== 0) throw new Error(`Guest exec failed with exit code ${exec.exit_code}`);

      const hasSystemctl = parseTool<{ exit_code: number }>(
        await createProxmoxExecTool(getClient, getSsh, vmDefaults).execute("smoke", {
          vmid,
          command: "command -v systemctl >/dev/null 2>&1",
          confirm: true,
        }),
      );
      if (hasSystemctl.exit_code === 0) {
        const service = parseTool<{ status: Record<string, string> }>(
          await createProxmoxServiceStatusTool(getClient, getSsh, vmDefaults).execute("smoke", {
            vmid,
            service: "basic.target",
            confirm: true,
          }),
        );
        log({ step: "service", vmid, active: service.status.ActiveState, load: service.status.LoadState });
      } else {
        log({ step: "service_skipped", vmid, reason: "systemctl not found in scratch CT" });
      }

      const stop = parseTool<{ upid: string }>(
        await createProxmoxStopResourceTool(getClient).execute("smoke", { vmid, timeoutSeconds: 30, confirm: true }),
      );
      log({ step: "stop", vmid, upid: stop.upid });
      await waitOk(getClient, stop.upid, "stop_wait");
    } finally {
      if (created) {
        const destroy = parseTool<{ upid: string }>(
          await createProxmoxDestroyResourceTool(getClient).execute("smoke", {
            vmid,
            purge: true,
            force: true,
            confirm: true,
            destructive: true,
          }),
        );
        log({ step: "destroy", vmid, upid: destroy.upid });
        await waitOk(getClient, destroy.upid, "destroy_wait");
      }
    }
  } else {
    log({ step: "create_skipped", reason: "set PROXMOX_SMOKE_CREATE=1 to run scratch CT lifecycle" });
  }

  const qemuSourceVmid = optionalIntegerEnv("PROXMOX_SMOKE_QEMU_SOURCE_VMID");
  if (qemuSourceVmid) {
    const nextAfterCt = parseTool<{ vmid: number }>(await createProxmoxNextVmidTool(getClient).execute("smoke", {}));
    await runQemuCloneSmoke(getClient, qemuSourceVmid, nextAfterCt.vmid, pool);
  } else {
    log({ step: "qemu_clone_skipped", reason: "set PROXMOX_SMOKE_QEMU_SOURCE_VMID to run scratch QEMU clone lifecycle" });
  }

  if (!ranServiceSmoke) {
    log({ step: "systemd_service_skipped", reason: "set PROXMOX_SMOKE_SYSTEMD_VMID to test service status/action on a systemd guest" });
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
