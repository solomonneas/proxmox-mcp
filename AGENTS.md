# Repository Guidance

## Definition of Done
A change is complete only when ALL of these pass, run after your final edit:
```
npm run typecheck
npm test
npm run build
```
- Any edit after a passing run invalidates that run. Re-run all three.
- Report actual results. If anything fails, report the failure verbatim and stop; do not claim success, do not soften the error.
- `prepublishOnly` runs the same chain; the publish payload is only `dist`, `openclaw.plugin.json`, `README.md`, `LICENSE`.

## Project Shape
- TypeScript MCP server for Proxmox VE (`@solomonneas/proxmox-mcp`): 42 tools across read, gated guest-read, safe-write, and destructive tiers, plus in-guest exec over SSH.
- Entry points: `mcp-server.ts` (stdio MCP), `index.ts` (OpenClaw plugin). Both register tools through the explicit export list in `src/tools/index.ts`; that list is canonical.
- One tool implementation per file under `src/tools/`. Shared plumbing: `src/proxmox-client.ts` (API token HTTP client), `src/ssh-executor.ts` (host `pct exec` for LXC, direct SSH for QEMU), `src/gates.ts` (write gates), `src/security.ts` (secret redaction), `src/config.ts` (env resolution).
- Tests use the in-memory fake in `tests/fake-proxmox.ts`; per-tool tests live in `tests/tools/`.

## Hard Prohibitions
- The configured Proxmox host is a live home-lab hypervisor running production CTs and VMs. Never run write, exec, service-action, or destructive tools against live VMIDs during development or review unless the user explicitly asks for that live operation in this session. Default to the fake (`tests/fake-proxmox.ts`) and read-only tools.
- The five destructive tools are `proxmox_destroy_resource`, `proxmox_cleanup_smoke_resources`, `proxmox_rollback_snapshot`, `proxmox_delete_snapshot`, `proxmox_force_stop_resource`. Each requires the full gate chain: `assertConfirmedWrite(raw, NAME)`, then `assertDestructive(raw, NAME)`, then `assertEnvFlag` on `PROXMOX_ENABLE_DESTRUCTIVE`, all before any network request. Never weaken, reorder, bypass, or conditionally skip any gate, in code or in tests.
- Smoke tests stay confined to the smoke pool: only `mcp-smoke-*` resources in the `mcp-smoke` pool. Never point smoke at any other VMID.
- A test fails: fix the code or fix a genuinely wrong test. Never delete, skip, loosen assertions on, or mark-flaky a failing test to get green.
- This repo has a `pre-push` hook (content-guard scan, `hooks/pre-push` via `core.hooksPath`). Never push with `--no-verify`. If the hook blocks, report its output verbatim.
- Blocked on credentials, env flags, network, or permissions: report the exact blocker and stop. Do not invent workarounds that route around a gate or a hook.

## Rules by Trigger
- Adding or renaming a tool: add it to the export list in `src/tools/index.ts`, add a per-tool test under `tests/tools/`, and update README tool counts and tier lists to match `src/tools/index.ts`.
- Touching a tier-2 tool (writes, in-guest exec/read/write, service actions): keep `assertConfirmedWrite(raw, NAME)` as the first action before any network request.
- Touching `proxmox_cleanup_smoke_resources`: keep `dry_run: true` as the default. Actual deletion stays opt-in.
- Handling a new secret or derived secret form (token id, token secret, `PVEAPIToken=...` header): call `registerSecret()` before serving tools. Never log or commit token secrets.
- Building API URLs from user input (node, vmid, snapshot names): validate and encode each path segment first; follow the existing pattern in commit history.
- Running live smoke: `npm run smoke:live` requires `PROXMOX_ENABLE_LIVE_SMOKE=1`; lifecycle smoke additionally requires `PROXMOX_SMOKE_CREATE=1` and `PROXMOX_ENABLE_DESTRUCTIVE=1`. Do not set these flags yourself to make a check pass; ask the user.
- Targeted iteration: run `npm test -- tests/tools/<specific>.test.ts` while developing, but the full Definition of Done chain still gates completion.
- Docs drift: design docs in `docs/` describe past versions. When docs and code disagree, code and tests win; fix the docs, not the code, unless tests prove otherwise.

## Gotchas
- Source imports use explicit `.ts` extensions and run via `tsx` in dev (`npm run dev`); the published binary is `dist/mcp-server.js`.
- QEMU in-guest tools resolve the VM IP via guest agent unless a `PROXMOX_VM_<vmid>_SSH_HOST` override exists; the source VM needs `qemu-guest-agent` and `agent: enabled=1`.
- Proxmox checks `/vms/<vmid>` ACLs before create/clone. The smoke script auto-grants the exact next VMID over SSH when host credentials are available; `scripts/create-smoke-token.sh` provisions the scoped role, pool, user, and token.

## Memory Handoff
At the end of any substantial task, write a handoff note to `.claude/memory-handoffs/` using that directory's `TEMPLATE.md`. Record durable discoveries, gotchas, and decisions. Do not wait to be reminded.
