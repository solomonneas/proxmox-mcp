# proxmox-mcp v0.3 Design - Creation + Destructive Tools

Extends v0.2 with 7 new tools that close the smoke-test loop (template -> create -> destroy) for repos like `soc-stack` that exercise infrastructure from automation-host against proxmox-host.

## What's added

### Tier 1 read (1)

| Tool | Description | PVE endpoint |
|---|---|---|
| `proxmox_list_templates` | List available CT templates AND VM ISOs, grouped by storage | `GET /nodes/{node}/storage/{storage}/content?content=vztmpl` + `?content=iso` |

### Tier 2 safe-writes (3)

| Tool | Description | PVE endpoint |
|---|---|---|
| `proxmox_create_container` | Create a new LXC from a template | `POST /nodes/{node}/lxc` |
| `proxmox_create_vm` | Create a new QEMU VM (empty or from ISO) | `POST /nodes/{node}/qemu` |
| `proxmox_clone_resource` | Clone an existing CT/VM to a new vmid | `POST /nodes/{node}/{type}/{vmid}/clone` |

### Tier 3 destructive (3)

| Tool | Description | PVE endpoint |
|---|---|---|
| `proxmox_destroy_resource` | Permanently delete a CT or VM | `DELETE /nodes/{node}/{type}/{vmid}` |
| `proxmox_delete_snapshot` | Delete a named snapshot | `DELETE /nodes/{node}/{type}/{vmid}/snapshot/{snapname}` |
| `proxmox_force_stop_resource` | Hard kill (no graceful shutdown) | `POST /nodes/{node}/{type}/{vmid}/status/stop` |

## Triple-gate safety on destructive tools

Mirroring the established pattern from `bin/run-workday-submit.sh`:

1. **Per-tool arg `confirm: true`** - same as tier 2
2. **Per-tool arg `destructive: true`** - same as adguard-mcp's tier 3 pattern
3. **Env flag `PROXMOX_ENABLE_DESTRUCTIVE=1`** - off by default; the MCP refuses to load tier-3 tools unless set

Without all three gates passed, tier-3 tools throw `WriteGateError` (with no HTTP call made) AND the env flag check is performed at tool-execute time so the operator can flip the env without restarting the MCP.

## Client additions

- Add `delete(path)` method to `ProxmoxClient` (currently has get/post only)
- The destructive tools are the first DELETE callers

## Gates additions

- Add `assertDestructive(args, toolName)` to `gates.ts` (mirror adguard-mcp's exact signature)
- Add `assertEnvFlag(envKey, toolName)` helper that throws `WriteGateError` if `process.env[envKey]` is not truthy
- Tier-3 tools call BOTH `assertDestructive(raw, NAME)` AND `assertEnvFlag('PROXMOX_ENABLE_DESTRUCTIVE', NAME)`

## Tool args - sensible defaults

### create_container

Required: `vmid: number`, `hostname: string`, `ostemplate: string` (e.g. `local:vztmpl/ubuntu-24.04-standard_*.tar.zst`)

Optional with defaults:
- `node?: string` - default first node in cluster
- `storage?: string` - default `local-lvm`
- `memory?: number` MiB - default 512
- `cores?: number` - default 1
- `rootfs_size?: string` - e.g. `"8"` (GB) - default 8
- `net?: string` - default `name=eth0,bridge=vmbr0,ip=dhcp`
- `start?: boolean` - default false (create stopped; operator starts explicitly)
- `password?: string` - root password; default unset (uses ssh keys from template)
- `ssh_public_keys?: string` - optional

### create_vm

Required: `vmid: number`, `name: string`

Optional with defaults:
- `node?: string` - default first node
- `memory?: number` - default 2048
- `cores?: number` - default 2
- `iso?: string` - ISO path for first install (e.g. `local:iso/ubuntu-24.04.2-live-server-amd64.iso`); default none (creates blank)
- `disk_size?: string` - default `"32"` GB on `local-lvm`
- `net?: string` - default `model=virtio,bridge=vmbr0`
- `start?: boolean` - default false

### clone_resource

Required: `source_vmid: number`, `new_vmid: number`, `name: string`

Optional:
- `full?: boolean` - default true (full clone, not linked)
- `storage?: string` - default same as source
- `snapname?: string` - if cloning from a snapshot

### destroy_resource

Required: `vmid: number`, `confirm: true`, `destructive: true`

Optional:
- `purge?: boolean` - default true (removes from PVE backup config too)
- `force?: boolean` - default false (will fail if VM is running)

### delete_snapshot

Required: `vmid: number`, `snapname: string`, `confirm: true`, `destructive: true`

### force_stop_resource

Required: `vmid: number`, `confirm: true`, `destructive: true`

## Tests

- Per-tool tests (12+ new): happy path + write-gate refusal + env-flag refusal for tier 3
- Integration smoke updated to assert 21 tools register

Target: ~70 tests total (56 from v0.2 + ~14 new).

## Operator follow-up (build-but-don't-flip)

PR ships code + docs + tests + bumped version. Operator owns:

1. **For v0.3 safe-writes (create/clone):** upgrade PVE token role from `PVEAuditor` to `PVEVMAdmin` at path `/`. This unlocks create + clone + snapshot + backup. PVE itself blocks anything outside that role even if the MCP tried.
2. **For v0.3 destructive (destroy/delete-snapshot/force-stop):** in addition to the role grant, set `PROXMOX_ENABLE_DESTRUCTIVE=1` in `~/.openclaw/workspace/.env`. Without it, the MCP refuses these tools at execute time with a clear error.
3. **Default ordering:** start with `PVEAuditor` (v0.2 reads only). Smoke. Bump to `PVEVMAdmin` after a clean week. Set `PROXMOX_ENABLE_DESTRUCTIVE=1` only when actively running smoke-test cycles, leave it unset day-to-day.

## Acceptance criteria

1. `npm test` ~70 tests green
2. All 21 tools register at startup
3. Tier 3 tools rejected without env flag even when confirm+destructive args set
4. Tier 3 tools rejected with env flag set but missing confirm or destructive args
5. `proxmox_create_container` POSTs to `/nodes/{node}/lxc` with form-encoded body (PVE quirk we already fixed in v0.1)
6. `proxmox_destroy_resource` uses DELETE method (new client method)
7. README + plan doc updated with v0.3 tool list + env-flag instructions

## Out of scope (deferred to v0.4+)

- Storage management (mount/unmount, ZFS pool ops)
- Network configuration (bridge create, VLAN edit)
- Cluster operations (HA, multi-node)
- User/group/permission management
- Custom OID / SNMP queries
- Backup retention policy management
