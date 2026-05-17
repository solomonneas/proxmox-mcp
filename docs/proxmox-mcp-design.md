# proxmox-mcp Design

A Model Context Protocol server that lets AI agents drive a Proxmox VE cluster over the documented REST API. 12 tools across read + safe-write tiers (no destructive tier in v1 - destroy/delete operations stay in the web UI). Token-auth via API tokens.

Mirrors the proven pattern of `solomonneas/adguard-mcp` and `solomonneas/postiz-mcp`: TypeScript, tsup bundler, three-tier write gating (two tiers used in v1), dual publish to npm + ClawHub, five-client README.

## Problem

The home stack runs on Proxmox. One host (the Proxmox host), 9 containers + 1 VM as of 2026-05-17 (adguard, twingate, crafty, homarr, wazuh, social-automation, immich, openclaw-prbuild, secondary-host VM, etc.). Day-to-day touchpoints are repetitive but mostly read-only: check container status before a deploy, peek at recent task logs after an upgrade, confirm a backup ran, restart a container after a config change.

Today the operator either opens the web UI at `https://<host>:8006/` (slow, click-heavy) or SSHes in and runs `pct list`, `qm list`, `pct exec`, `pvesm status`. Neither composes with Claude conversation. "Restart wazuh" or "show me CT 109 status" should be one sentence, not a tab switch.

There is no agent-driven surface for Proxmox today. n8n-ops-mcp talks to n8n which RUNS on a Proxmox container; this MCP talks to Proxmox itself. Different layer.

## Goal

Ship an MCP server that:

- Exposes 12 tools across read / safe-write tiers
- Targets a single Proxmox cluster via `PROXMOX_URL` + `PROXMOX_TOKEN_ID` + `PROXMOX_TOKEN_SECRET` env vars
- Optional `PROXMOX_TLS_INSECURE` for self-signed homelab certs (default false)
- Gates every write behind explicit `confirm: true` arg
- Does NOT expose destroy/delete operations in v1 (defer to v2 with explicit destructive tier)
- Redacts the API token from all logs and error responses
- Ships as npx-runnable binary, dual-published to npm + ClawHub
- Documents setup for Claude Desktop, Claude Code, OpenClaw, Hermes Agent, Codex CLI

## Non-goals

- Multi-cluster support. v1 is single-cluster. Most homelabs and small SMB Proxmox deployments are single-cluster. Add later if needed.
- VM/CT destroy operations. Catastrophic risk, rarely needed via agent. The web UI is fine.
- VM/CT creation. Templates + cloning is a complex surface; defer.
- Storage operations (mount/unmount, ZFS pool ops). Out of scope.
- Network configuration (bridges, VLANs, firewall rules). Out of scope.
- Cluster operations (add/remove nodes, HA config). Single-node clusters don't need them.
- Live migration. Single-node clusters can't migrate anywhere.
- Console attach / VNC tunneling. Use the web UI.
- Hard kill / force-stop. `stop` is graceful; `force_stop` defers to v2.

## Architecture

```
~/repos/proxmox-mcp/
├── src/
│   ├── proxmox-client.ts     # HTTP token-auth client, optional TLS-insecure
│   ├── config.ts             # .env load, validate required fields
│   ├── security.ts           # token redaction in logs + errors
│   ├── gates.ts              # assertConfirmedWrite for tier 2
│   ├── tools/
│   │   ├── _util.ts          # ClientFactory, jsonToolResult
│   │   ├── proxmox_status.ts
│   │   ├── proxmox_list_containers.ts
│   │   ├── proxmox_list_vms.ts
│   │   ├── proxmox_get_resource.ts
│   │   ├── proxmox_recent_tasks.ts
│   │   ├── proxmox_list_backups.ts
│   │   ├── proxmox_resource_usage.ts
│   │   ├── proxmox_start_resource.ts
│   │   ├── proxmox_stop_resource.ts
│   │   ├── proxmox_reboot_resource.ts
│   │   ├── proxmox_snapshot_resource.ts
│   │   ├── proxmox_run_backup.ts
│   │   └── index.ts
├── mcp-server.ts             # stdio MCP server
├── index.ts                  # OpenClaw plugin entry
├── openclaw.plugin.json
├── tests/
│   ├── fake-proxmox.ts       # in-process fake PVE API server
│   └── tools/<one-per-tool>.test.ts
├── docs/
├── README.md
├── LICENSE
├── package.json
├── tsup.config.ts
├── tsconfig.json
└── .gitignore
```

## Tools (12 total, two tiers)

### Tier 1 reads (7, always allowed)

| Tool | Description | PVE endpoint |
|---|---|---|
| `proxmox_status` | Cluster-level + per-node host status (CPU, memory, uptime, version) | `GET /cluster/resources?type=node` + `GET /version` |
| `proxmox_list_containers` | All LXC containers with id, name, node, status | `GET /cluster/resources?type=lxc` |
| `proxmox_list_vms` | All QEMU VMs with id, name, node, status | `GET /cluster/resources?type=qemu` |
| `proxmox_get_resource` | Detail for one resource by `vmid` | `GET /nodes/{node}/{type}/{vmid}/status/current` |
| `proxmox_recent_tasks` | Recent task log (filterable by node, type, vmid, since-N) | `GET /cluster/tasks` or `GET /nodes/{node}/tasks` |
| `proxmox_list_backups` | Backup storage contents, recent backups by vmid | `GET /nodes/{node}/storage/{storage}/content?content=backup` |
| `proxmox_resource_usage` | Realtime CPU/RAM/disk for a resource (last 1h sampled) | `GET /nodes/{node}/{type}/{vmid}/rrddata?timeframe=hour` |

### Tier 2 safe-writes (5, require `confirm: true`)

| Tool | Description | PVE endpoint |
|---|---|---|
| `proxmox_start_resource` | Start a stopped CT or VM | `POST /nodes/{node}/{type}/{vmid}/status/start` |
| `proxmox_stop_resource` | Graceful shutdown | `POST /nodes/{node}/{type}/{vmid}/status/shutdown` |
| `proxmox_reboot_resource` | Graceful reboot | `POST /nodes/{node}/{type}/{vmid}/status/reboot` |
| `proxmox_snapshot_resource` | Create a named snapshot | `POST /nodes/{node}/{type}/{vmid}/snapshot` |
| `proxmox_run_backup` | Trigger a one-shot vzdump for a resource | `POST /nodes/{node}/vzdump` |

Resources are addressed by `vmid` only - the tool figures out which node + type (lxc vs qemu) from the cluster resources listing. Cleaner than asking the model to remember container IDs across hosts.

### Tier 3 destructive (deferred to v2)

`proxmox_force_stop`, `proxmox_destroy_resource`, `proxmox_delete_snapshot` are intentionally NOT shipped in v1. The reasoning: destroy operations on a homelab are catastrophic + rare. The web UI is the right surface for the few times they're needed. Adding them later is one tool per addition.

## Auth

Proxmox API tokens. The operator creates one in the web UI under Datacenter -> API Tokens, then sets:

```
PROXMOX_URL=https://pve.example.local:8006
PROXMOX_TOKEN_ID=claude@pam!api-token-1
PROXMOX_TOKEN_SECRET=<uuid>
PROXMOX_TLS_INSECURE=true                     # default false; toggle for self-signed
```

Auth header: `Authorization: PVEAPIToken=<TOKEN_ID>=<TOKEN_SECRET>`.

Token credentials NEVER appear in logs or error envelopes. `security.ts` redacts both the token id and the secret as registered secrets at startup.

Optional improvement: the token's permission scope is set in the Proxmox UI when the operator creates it. The README recommends a token with read-only scope for first install, then grading up to write scope as comfort grows. The MCP itself enforces write gates; PVE itself enforces token scope.

## Write gating contract

`gates.ts` re-uses the same pattern as adguard-mcp:

```typescript
assertConfirmedWrite(args, toolName);  // throws unless args.confirm === true
```

Every Tier 2 tool calls `assertConfirmedWrite` at the top of its handler. The JSON schema documents `confirm: true` as required on every write tool. No Tier 3 in v1; if added later, `assertDestructive` follows the same pattern as adguard-mcp.

## Multi-instance

v1 is single-cluster. Env vars are flat (`PROXMOX_*` not `PROXMOX_<NAME>_*`). If multi-cluster support lands later, follow adguard-mcp's `PROXMOX_<NAME>_URL` pattern with default-instance arg per tool. Out of scope for now.

## TLS handling

Homelab Proxmox installs almost always use self-signed certs. Default `PROXMOX_TLS_INSECURE=false`. Setting it to `true` (string `"true"`, `"1"`, or `"yes"`) tells the client to set `rejectUnauthorized: false` on the underlying https agent. The README documents this is acceptable on a private network but emphasizes a real cert (Let's Encrypt with internal DNS) is better.

## Error handling

- PVE 4xx (auth fail, not found, bad params) -> typed `ProxmoxClientError` with sanitized message
- PVE 5xx / network -> `ProxmoxUnreachableError`, retry-once after 1s, then fail
- TLS verification failure when `PROXMOX_TLS_INSECURE` is false -> typed `ProxmoxTLSError` with a hint about the env flag
- Schema validation failure on tool input -> MCP-standard validation error
- Write gate failure -> `WriteGateError`

All error paths run through `redact()` before being emitted, so the token never leaks.

## Testing

- `tests/fake-proxmox.ts`: in-process Node http server fakes PVE responses. Same harness shape as `adguard-mcp/tests/fake-adguard.ts`.
- Per-tool tests: each tool gets a `tests/tools/<tool>.test.ts` that builds fake responses, invokes the handler, asserts request + response.
- Gates tests, config tests, security/redaction tests.
- TLS-insecure flag test (confirm the http agent option is set when flag is truthy).
- Integration smoke that boots the server, asserts 12 tool registrations, exercises one read + one write.

Target ~35-40 tests. All hermetic.

## Publish + deploy

- `npm publish --access public` under `@solomonneas/proxmox-mcp` v0.1.0
- ClawHub publish via `npx clawhub package publish` per `[[clawhub-cli-publish-flow]]` - package.json includes the `openclaw.compat` + `openclaw.build` blocks from day one (avoid the version-burn issue we hit with adguard-mcp)
- Auto-redeploy cron entry per `[[repo-redeploy-system]]`
- README documents all 5 clients per `[[feedback-mcp-readme-five-clients]]`

## Operator follow-up (build-but-don't-flip)

PR ships code + docs + tests. Operator owns:

1. Create a PVE API token in the web UI (Datacenter -> API Tokens). For first install, give it read-only scope. Grade up to read+write after a few clean read-only sessions.
2. Set `PROXMOX_URL` + `PROXMOX_TOKEN_ID` + `PROXMOX_TOKEN_SECRET` in `~/.openclaw/workspace/.env`. Set `PROXMOX_TLS_INSECURE=true` for self-signed.
3. Wire the MCP into whichever client(s) - README has setup for all five.
4. Smoke: `proxmox_status` to confirm auth. Then `proxmox_list_containers` to confirm cluster reads. Then a controlled `proxmox_start_resource` against a low-stakes test container.

## Acceptance criteria

1. `npm test` runs ~35-40 hermetic tests green.
2. `npm run build` produces `dist/mcp-server.js` + `dist/index.js`.
3. `mcp-server.ts` advertises all 12 tools via `tools/list`.
4. Each Tier 2 tool rejects calls missing `confirm: true` with a `WriteGateError`.
5. `proxmox-client.ts` redacts both `TOKEN_ID` and `TOKEN_SECRET` from any error path; a synthetic 401 does NOT leak the `Authorization` header.
6. README contains setup blocks for all 5 clients.
7. `openclaw.plugin.json` validates and loads cleanly.
8. `npm pack` produces a tarball under 50 KB with `dist/`, manifest, README, LICENSE only.
9. `package.json.openclaw.compat` + `openclaw.build` present from v0.1.0 (no version burn on ClawHub).

## Out of scope, captured

- Destroy / delete operations (v2)
- Force-stop / hard-kill (v2)
- VM / CT creation from templates (v3)
- Storage management (v3+)
- Network / firewall management (v3+)
- Cluster operations (multi-node)
- Console / VNC attach
- Live migration

## Related context

- Pattern reference: `[[postiz-mcp-shipped]]` + the adguard-mcp shipped today.
- Test pattern: `[[mcp-tool-handler-test-pattern]]`.
- Publish flow: `[[clawhub-cli-publish-flow]]` (and the lesson: include openclaw block on day one).
- Build-but-don't-flip: `[[feedback-build-but-dont-flip-preference]]`.
- README requirements: `[[feedback-mcp-readme-five-clients]]`.
- Home stack inventory: workspace memory cards covering the Proxmox host (CT inventory) and the per-container roles.
