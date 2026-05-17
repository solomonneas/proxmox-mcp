# proxmox-mcp

MCP server exposing Proxmox VE read + safe-write tools via API token auth. Three-tier write gating: reads are open, writes require `confirm: true`, destructive ops would require `confirm: true` + `destructive: true` (v1 ships tier 1 + tier 2 only; tier 3 destroy ops are deferred).

## Tools

**Reads (7):** `proxmox_status`, `proxmox_list_containers`, `proxmox_list_vms`, `proxmox_get_resource`, `proxmox_recent_tasks`, `proxmox_list_backups`, `proxmox_resource_usage`.

**Safe writes (5, require `confirm: true`):** `proxmox_start_resource`, `proxmox_stop_resource`, `proxmox_reboot_resource`, `proxmox_snapshot_resource`, `proxmox_run_backup`.

**Destructive (tier 3):** not in v1. Operations like resource deletion, snapshot rollback, and storage destruction are intentionally absent until the gate pattern has more field time.

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

- **Tier 1 (reads):** open. No confirm flag needed. Status, listings, usage, recent tasks, backup inventory.
- **Tier 2 (safe writes):** require an explicit `confirm: true` arg. The JSON schema documents this on every write tool. Start, stop, reboot, snapshot create, run backup all live here. A hallucinated tool call without the confirm flag throws `WriteGateError` before any HTTP traffic.
- **Tier 3 (destructive):** not implemented in v1. When added, ops like snapshot rollback, resource deletion, and storage destruction will additionally require `destructive: true`. The model cannot bypass either gate from a hallucinated call.

**API token scope recommendation:** start with a read-only token (PVE Datastore.Audit + VM.Audit + Sys.Audit) and verify the read tools work end-to-end. Grade up to write privileges (VM.PowerMgmt, VM.Snapshot, VM.Backup) only after you've confirmed the redactor is masking your secret in your transcripts and that the model is honoring the confirm gate. Tokens are tied to a PVE user and can be revoked instantly from the Datacenter > Permissions > API Tokens UI.

The `PROXMOX_TLS_INSECURE=true` toggle exists for homelab self-signed certs. Leave it `false` in any environment with a real CA-signed cert.

## License

MIT
