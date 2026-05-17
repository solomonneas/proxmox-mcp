# proxmox-mcp

MCP server exposing Proxmox VE read + safe-write + destructive tools via API token auth. Three-tier write gating: reads are open, writes require `confirm: true`, destructive ops require `confirm: true` + `destructive: true` + a process-level `PROXMOX_ENABLE_DESTRUCTIVE=1` env flag.

## Tools

| Tool | Tier | Notes |
| --- | --- | --- |
| `proxmox_status` | 1 read | Cluster + node status. |
| `proxmox_list_containers` | 1 read | LXC inventory across all nodes. |
| `proxmox_list_vms` | 1 read | QEMU inventory across all nodes. |
| `proxmox_get_resource` | 1 read | Single container or VM config + status by vmid. |
| `proxmox_recent_tasks` | 1 read | Recent UPID task list per node. |
| `proxmox_list_backups` | 1 read | Backup inventory by storage. |
| `proxmox_resource_usage` | 1 read | CPU/mem/disk RRD metrics. |
| `proxmox_list_templates` | 1 read | LXC + VM templates available for cloning + container creation. |
| `proxmox_start_resource` | 2 safe-write | Boot container or VM. |
| `proxmox_stop_resource` | 2 safe-write | Graceful shutdown. |
| `proxmox_reboot_resource` | 2 safe-write | Reboot in place. |
| `proxmox_snapshot_resource` | 2 safe-write | Create named snapshot. |
| `proxmox_run_backup` | 2 safe-write | Trigger vzdump for a vmid. |
| `proxmox_create_container` | 2 safe-write | Provision new LXC from template (`POST /nodes/{node}/lxc`). |
| `proxmox_create_vm` | 2 safe-write | Provision new QEMU VM (`POST /nodes/{node}/qemu`). |
| `proxmox_clone_resource` | 2 safe-write | Clone existing container or VM into a fresh vmid. |
| `proxmox_destroy_resource` | 3 destructive | Permanently delete an LXC or VM (`DELETE /nodes/{node}/{type}/{vmid}`). |
| `proxmox_delete_snapshot` | 3 destructive | Delete a named snapshot. |
| `proxmox_force_stop_resource` | 3 destructive | Non-graceful hard stop of a running container or VM. |
| `proxmox_get_task_status` | 1 read | Single UPID status lookup. |
| `proxmox_get_task_log` | 1 read | Task log tail for a UPID. |

**Reads (8):** open; no flags required.
**Safe writes (8):** require `confirm: true`. Schema documents the gate on every tool. `WriteGateError` fires before any HTTP call.
**Destructive (3):** require `confirm: true` + `destructive: true` + env `PROXMOX_ENABLE_DESTRUCTIVE=1`. All three gates must be satisfied; any one missing throws `WriteGateError` before resolving the resource.

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

- **Tier 1 (reads):** open. No confirm flag needed. Status, listings, usage, recent tasks, backup inventory, template inventory.
- **Tier 2 (safe writes):** require an explicit `confirm: true` arg. The JSON schema documents this on every write tool. Start, stop, reboot, snapshot create, run backup, create container, create VM, clone live here. A hallucinated tool call without the confirm flag throws `WriteGateError` before any HTTP traffic.
- **Tier 3 (destructive):** require `confirm: true` + `destructive: true` + the env flag `PROXMOX_ENABLE_DESTRUCTIVE=1` on the MCP process. Permanent resource deletion, snapshot deletion, and non-graceful force-stop live here.

### Destructive operations env gate

Tier 3 destructive tools (`proxmox_destroy_resource`, `proxmox_delete_snapshot`, `proxmox_force_stop_resource`) require an additional safety gate beyond the per-tool `confirm: true` + `destructive: true` args: the env var `PROXMOX_ENABLE_DESTRUCTIVE=1` must be set on the MCP process. Without it, the tools throw `WriteGateError` before any HTTP call is made.

This is intentional: destructive ops are rare. The env flag is a coarse "I am actively doing smoke-test cycles" toggle. Leave it unset day-to-day; flip it only when actively destroying resources is part of the workflow.

**API token scope recommendation:** start with a read-only token (PVE Datastore.Audit + VM.Audit + Sys.Audit) and verify the read tools work end-to-end. Grade up to write privileges (VM.PowerMgmt, VM.Snapshot, VM.Backup) only after you've confirmed the redactor is masking your secret in your transcripts and that the model is honoring the confirm gate. Tokens are tied to a PVE user and can be revoked instantly from the Datacenter > Permissions > API Tokens UI.

The `PROXMOX_TLS_INSECURE=true` toggle exists for homelab self-signed certs. Leave it `false` in any environment with a real CA-signed cert.

## License

MIT
