# proxmox-mcp

MCP server exposing Proxmox VE read + gated guest-read + safe-write + destructive tools via API token auth. Reads are open, guest file reads and writes require `confirm: true`, destructive ops require `confirm: true` + `destructive: true` + a process-level `PROXMOX_ENABLE_DESTRUCTIVE=1` env flag.

## Tools

| Tool | Tier | Notes |
| --- | --- | --- |
| `proxmox_status` | 1 read | Cluster + node status. |
| `proxmox_list_containers` | 1 read | LXC inventory across all nodes. |
| `proxmox_list_vms` | 1 read | QEMU inventory across all nodes. |
| `proxmox_get_resource` | 1 read | Single container or VM config + status by vmid. |
| `proxmox_get_vm_config` | 1 read | QEMU VM config by vmid. |
| `proxmox_get_container_config` | 1 read | LXC container config by vmid. |
| `proxmox_validate_qemu_smoke_source` | 1 read | Preflight a QEMU VM before live smoke cloning. |
| `proxmox_audit_permissions` | 1 read | Inspect effective permissions across smoke-relevant paths. |
| `proxmox_recent_tasks` | 1 read | Recent UPID task list per node. |
| `proxmox_list_backups` | 1 read | Backup inventory by storage. |
| `proxmox_resource_usage` | 1 read | CPU/mem/disk RRD metrics. |
| `proxmox_list_templates` | 1 read | LXC + VM templates available for cloning + container creation. |
| `proxmox_list_storage` | 1 read | Storage status on one node or all nodes. |
| `proxmox_list_snapshots` | 1 read | Snapshot inventory for one LXC or VM. |
| `proxmox_guest_network` | 1 read | Guest network interfaces and usable IPv4 addresses. |
| `proxmox_wait_task` | 1 read | Poll a UPID until stopped or timeout. |
| `proxmox_next_vmid` | 1 read | Get the next available VMID for provisioning. |
| `proxmox_list_pool_resources` | 1 read | Inspect resources assigned to a Proxmox pool, defaulting to `mcp-smoke`. |
| `proxmox_start_resource` | 2 safe-write | Boot container or VM. |
| `proxmox_stop_resource` | 2 safe-write | Graceful shutdown. |
| `proxmox_reboot_resource` | 2 safe-write | Reboot in place. |
| `proxmox_snapshot_resource` | 2 safe-write | Create named snapshot. |
| `proxmox_rollback_snapshot` | 3 destructive | Roll back a resource to a named snapshot. |
| `proxmox_run_backup` | 2 safe-write | Trigger vzdump for a vmid. |
| `proxmox_create_container` | 2 safe-write | Provision new LXC from template (`POST /nodes/{node}/lxc`). |
| `proxmox_create_vm` | 2 safe-write | Provision new QEMU VM (`POST /nodes/{node}/qemu`). |
| `proxmox_clone_resource` | 2 safe-write | Clone existing container or VM into a fresh vmid. |
| `proxmox_destroy_resource` | 3 destructive | Permanently delete an LXC or VM (`DELETE /nodes/{node}/{type}/{vmid}`). |
| `proxmox_cleanup_smoke_resources` | 3 destructive | Dry-run or destroy smoke-prefixed LXC/QEMU guests from a smoke pool. |
| `proxmox_delete_snapshot` | 3 destructive | Delete a named snapshot. |
| `proxmox_force_stop_resource` | 3 destructive | Non-graceful hard stop of a running container or VM. |
| `proxmox_get_task_status` | 1 read | Single UPID status lookup. |
| `proxmox_get_task_log` | 1 read | Task log tail for a UPID. |
| `proxmox_read_file` | 2 gated guest read | Read a file from inside an LXC or QEMU VM (SSH + `cat`). Requires `confirm: true`. |
| `proxmox_exec` | 2 safe-write | Run a shell command inside an LXC or QEMU VM. Returns stdout/stderr/exit_code. |
| `proxmox_write_file` | 2 safe-write | Write a text file (with parent dirs) inside an LXC or QEMU VM. |
| `proxmox_stat_path` | 2 gated guest read | Inspect guest path metadata. Requires `confirm: true`. |
| `proxmox_list_directory` | 2 gated guest read | List one guest directory. Requires `confirm: true`. |
| `proxmox_service_status` | 2 gated guest read | Read systemd service state inside a guest. Requires `confirm: true`. |
| `proxmox_service_start` | 2 safe-write | Start a systemd service inside a guest. Requires `confirm: true`. |
| `proxmox_service_stop` | 2 safe-write | Stop a systemd service inside a guest. Requires `confirm: true`. |
| `proxmox_service_restart` | 2 safe-write | Restart a systemd service inside a guest. Requires `confirm: true`. |

**Reads (20):** open; no flags required.
**Gated guest reads (4):** guest file/path/directory/service inspection tools require `confirm: true` because they expose in-guest state through host-backed SSH.
**Safe writes (13):** require `confirm: true`. Schema documents the gate on every tool. `WriteGateError` fires before any HTTP call.
**Destructive (5):** require `confirm: true` + `destructive: true` + env `PROXMOX_ENABLE_DESTRUCTIVE=1`. All three gates must be satisfied; any one missing throws `WriteGateError` before resolving the resource.

## Changelog

### 0.5.0

- Add effective permission audit tooling for smoke-token ACL checks.
- Add structured MCP error payloads with stable `code` fields.
- Add snapshot rollback tooling and optional live rollback smoke.
- Add optional live backup smoke that waits for vzdump and verifies the backup artifact is listed.
- Harden live QEMU smoke with source validation, guest-network waiting, and cleanup stop-before-destroy behavior.
- Harden smoke cleanup with `dry_run:true` by default, delete task waiting, and running-guest skips unless `force:true`.

## Configuration

Set the following env vars. All three credential vars are required.

```
PROXMOX_URL=https://pve.example.local:8006
PROXMOX_TOKEN_ID=pve-admin@pam!api-token-1
PROXMOX_TOKEN_SECRET=00000000-0000-0000-0000-000000000000

# Optional: skip TLS cert validation (homelab self-signed certs).
# Accepts true/1/yes (case-insensitive). Defaults to false.
PROXMOX_TLS_INSECURE=false
```

Trailing slashes on `PROXMOX_URL` are stripped. The token secret is registered with the redactor on startup and masked from all log + error output.

### In-container exec env vars (v0.4)

The `proxmox_exec`, `proxmox_read_file`, and `proxmox_write_file` tools SSH to the Proxmox host (for LXC, via `pct exec`) or directly to the VM (for QEMU). All are optional; defaults derive from `PROXMOX_URL`.

| Env var | Default | Purpose |
| --- | --- | --- |
| `PROXMOX_SSH_HOST` | hostname from `PROXMOX_URL` | Proxmox host for `pct exec` |
| `PROXMOX_SSH_PORT` | `22` | SSH port |
| `PROXMOX_SSH_USER` | `root` | SSH user on Proxmox host |
| `PROXMOX_SSH_KEY` | `~/.ssh/id_ed25519` | Key path for Proxmox host SSH |
| `PROXMOX_VM_SSH_USER` | falls through to `PROXMOX_SSH_USER` | Default user for direct VM SSH |
| `PROXMOX_VM_SSH_KEY` | falls through to `PROXMOX_SSH_KEY` | Default key for direct VM SSH |
| `PROXMOX_SSH_MAX_OUTPUT_BYTES` | `1048576` | Max stdout bytes and max stderr bytes captured per SSH command |

Per-VM overrides (read at execute time, no MCP restart needed):

- `PROXMOX_VM_<vmid>_SSH_HOST` - pin a VM's IP (bypasses guest agent)
- `PROXMOX_VM_<vmid>_SSH_USER` - per-VM user override
- `PROXMOX_VM_<vmid>_SSH_KEY` - per-VM key override

For QEMU VMs without a per-VM env override, install `qemu-guest-agent` in the VM and enable it with `qm set <vmid> --agent 1` so the IP can be discovered automatically.

## Live smoke testing

Read-only live smoke:

```bash
PROXMOX_ENABLE_LIVE_SMOKE=1 npm run smoke:live
```

Full scratch CT lifecycle smoke requires a token that can create, start, stop, inspect, and destroy resources in the `mcp-smoke` pool:

```bash
PROXMOX_ENABLE_LIVE_SMOKE=1 \
PROXMOX_SMOKE_CREATE=1 \
PROXMOX_ENABLE_DESTRUCTIVE=1 \
npm run smoke:live
```

Optional scratch CT backup and snapshot rollback smoke:

```bash
PROXMOX_ENABLE_LIVE_SMOKE=1 \
PROXMOX_SMOKE_CREATE=1 \
PROXMOX_SMOKE_BACKUP=1 \
PROXMOX_SMOKE_BACKUP_STORAGE=local \
PROXMOX_SMOKE_SNAPSHOT_ROLLBACK=1 \
PROXMOX_ENABLE_DESTRUCTIVE=1 \
npm run smoke:live
```

Create a scoped smoke-test role/user/token on the Proxmox host:

```bash
PROXMOX_CREATE_SMOKE_TOKEN=1 bash scripts/create-smoke-token.sh
```

The script creates or updates role `McpSmokeRole`, pool `mcp-smoke`, user `mcp-smoke@pve`, token `mcp-smoke@pve!live-smoke`, and ACLs for the smoke pool plus `local` and `local-lvm` storage. Proxmox prints the token secret once; store it in your private environment and do not commit it.

Proxmox also checks `/vms/<vmid>` before creating a new CT/VM. For one-off smoke tests, grant the exact next VMID before running the lifecycle smoke:

```bash
PROXMOX_CREATE_SMOKE_TOKEN=1 PROXMOX_SMOKE_VMID_GRANT=102 bash scripts/create-smoke-token.sh
```

`npm run smoke:live` now attempts that exact VMID grant automatically before creating a scratch CT or QEMU clone when `PROXMOX_SSH_HOST`, `PROXMOX_SSH_USER`, and `PROXMOX_SSH_KEY` are available. Set `PROXMOX_SMOKE_SKIP_AUTO_GRANT=1` to disable it.

Optional QEMU clone smoke:

```bash
PROXMOX_ENABLE_LIVE_SMOKE=1 \
PROXMOX_ENABLE_DESTRUCTIVE=1 \
PROXMOX_SMOKE_QEMU_SOURCE_VMID=9000 \
npm run smoke:live
```

This validates the source, full-clones it to a scratch VMID, starts it, waits for guest-agent network data, stops it, and destroys it. Use `PROXMOX_SMOKE_QEMU_TARGET_VMID` or `PROXMOX_SMOKE_QEMU_NAME` to override the generated target.

The QEMU source should be a small stopped VM or template with `agent: enabled=1`, DHCP networking, no PCI/USB passthrough, no raw `args`, and a modest disk size. Check it first:

```bash
# tool: proxmox_validate_qemu_smoke_source { "vmid": 9000 }
```

Audit smoke-token permissions:

```bash
# tool: proxmox_audit_permissions {
#   "userid": "mcp-smoke@pve!live-smoke",
#   "source_vmid": 103,
#   "target_vmid": 102
# }
```

Optional systemd service smoke:

```bash
PROXMOX_ENABLE_LIVE_SMOKE=1 \
PROXMOX_SMOKE_SYSTEMD_VMID=100 \
PROXMOX_SMOKE_SERVICE=basic.target \
npm run smoke:live
```

To run a live service action as well as status, add `PROXMOX_SMOKE_SERVICE_ACTION=start|stop|restart` and `PROXMOX_SMOKE_SERVICE_ACTION_CONFIRM=1`.

Audit or clean leftover smoke resources:

```bash
# Read-only pool audit
# tool: proxmox_list_pool_resources { "pool": "mcp-smoke" }

# Dry-run cleanup, only resources named mcp-smoke-* in the pool are targeted
# tool: proxmox_cleanup_smoke_resources {}

# Actual cleanup waits for delete tasks and skips running guests unless force:true
# tool: proxmox_cleanup_smoke_resources { "dry_run": false, "confirm": true, "destructive": true }
```

## Install

```
npm install -g @solomonneas/proxmox-mcp
```

Or run via npx:

```
npx -y @solomonneas/proxmox-mcp
```

## Setup

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "proxmox": {
      "command": "npx",
      "args": ["-y", "@solomonneas/proxmox-mcp"],
      "env": {
        "PROXMOX_URL": "https://pve.example.local:8006",
        "PROXMOX_TOKEN_ID": "pve-admin@pam!api-token-1",
        "PROXMOX_TOKEN_SECRET": "00000000-0000-0000-0000-000000000000",
        "PROXMOX_TLS_INSECURE": "false"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add proxmox -s user -- npx -y @solomonneas/proxmox-mcp
```

Then export env vars in your shell (`~/.bashrc`, `~/.zshrc`) or pass `--env` flags.

### OpenClaw

Plugin loads automatically once installed. Config goes in your `~/.openclaw/openclaw.json` `plugins.entries.proxmox` (or use the bundled `openclaw.plugin.json`):

```json
{
  "plugins": {
    "entries": {
      "proxmox": {
        "package": "@solomonneas/proxmox-mcp",
        "activation": { "onStartup": true }
      }
    }
  }
}
```

Env vars from `~/.openclaw/workspace/.env` are inherited by the plugin.

### Hermes Agent

Add to `~/.config/hermes/agents.yaml`:

```yaml
mcp_servers:
  proxmox:
    command: npx
    args: ["-y", "@solomonneas/proxmox-mcp"]
    env:
      PROXMOX_URL: https://pve.example.local:8006
      PROXMOX_TOKEN_ID: pve-admin@pam!api-token-1
      PROXMOX_TOKEN_SECRET: 00000000-0000-0000-0000-000000000000
      PROXMOX_TLS_INSECURE: "false"
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.proxmox]
command = "npx"
args = ["-y", "@solomonneas/proxmox-mcp"]

[mcp_servers.proxmox.env]
PROXMOX_URL = "https://pve.example.local:8006"
PROXMOX_TOKEN_ID = "pve-admin@pam!api-token-1"
PROXMOX_TOKEN_SECRET = "00000000-0000-0000-0000-000000000000"
PROXMOX_TLS_INSECURE = "false"
```

## Safety

This MCP uses the same three-tier write-gating pattern as the rest of the `solomonneas/*-mcp` family:

- **Tier 1 (reads):** open. No confirm flag needed. Status, listings, config inspection, QEMU smoke-source validation, permission audit, usage, recent tasks, backup inventory, template inventory, storage inventory, snapshot inventory, guest network lookup, task wait, next-VMID lookup, and pool resource audit live here.
- **Tier 2 (gated guest reads + safe writes):** require an explicit `confirm: true` arg. Guest file/path/directory/service inspection, start, stop, reboot, snapshot create, run backup, create container, create VM, clone, in-container `exec`, in-container `write_file`, and guest service actions live here. A hallucinated tool call without the confirm flag throws `WriteGateError` before any HTTP traffic.
- **Tier 3 (destructive):** require `confirm: true` + `destructive: true` + the env flag `PROXMOX_ENABLE_DESTRUCTIVE=1` on the MCP process. Permanent resource deletion, smoke pool cleanup, snapshot rollback/deletion, and non-graceful force-stop live here.

### Destructive operations env gate

Tier 3 destructive tools (`proxmox_destroy_resource`, `proxmox_cleanup_smoke_resources`, `proxmox_rollback_snapshot`, `proxmox_delete_snapshot`, `proxmox_force_stop_resource`) require an additional safety gate beyond the per-tool `confirm: true` + `destructive: true` args: the env var `PROXMOX_ENABLE_DESTRUCTIVE=1` must be set on the MCP process. Without it, the tools throw `WriteGateError` before any HTTP call is made. `proxmox_cleanup_smoke_resources` defaults to `dry_run:true`, which previews targets without the destructive env gate.

This is intentional: destructive ops are rare. The env flag is a coarse "I am actively doing smoke-test cycles" toggle. Leave it unset day-to-day; flip it only when actively destroying resources is part of the workflow.

**API token scope recommendation:** start with a read-only token (PVE Datastore.Audit + VM.Audit + Sys.Audit) and verify the read tools work end-to-end. Grade up to write privileges (VM.PowerMgmt, VM.Snapshot, VM.Backup) only after you've confirmed the redactor is masking your secret in your transcripts and that the model is honoring the confirm gate. Tokens are tied to a PVE user and can be revoked instantly from the Datacenter > Permissions > API Tokens UI.

The `PROXMOX_TLS_INSECURE=true` toggle exists for homelab self-signed certs. Leave it `false` in any environment with a real CA-signed cert.

## License

MIT
