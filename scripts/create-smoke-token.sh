#!/usr/bin/env bash
set -euo pipefail

if [[ "${PROXMOX_CREATE_SMOKE_TOKEN:-}" != "1" ]]; then
  cat >&2 <<'EOF'
Refusing to create a Proxmox smoke-test token.

Set PROXMOX_CREATE_SMOKE_TOKEN=1 to proceed. This script creates/updates:
- role McpSmokeRole
- pool mcp-smoke
- user mcp-smoke@pve
- token mcp-smoke@pve!live-smoke
- scoped ACLs for the smoke pool and local/local-lvm storage

The token secret is printed once by Proxmox. Store it securely.
EOF
  exit 2
fi

ROLE="${PROXMOX_SMOKE_ROLE:-McpSmokeRole}"
POOL="${PROXMOX_SMOKE_POOL:-mcp-smoke}"
USERID="${PROXMOX_SMOKE_USERID:-mcp-smoke@pve}"
TOKEN_NAME="${PROXMOX_SMOKE_TOKEN_NAME:-live-smoke}"
STORAGE_TEMPLATE="${PROXMOX_SMOKE_TEMPLATE_STORAGE:-local}"
STORAGE_ROOT="${PROXMOX_SMOKE_ROOT_STORAGE:-local-lvm}"
VMID_GRANT="${PROXMOX_SMOKE_VMID_GRANT:-}"

PRIVS=(
  Datastore.AllocateSpace
  Datastore.AllocateTemplate
  Datastore.Audit
  Pool.Allocate
  Pool.Audit
  SDN.Use
  Sys.Audit
  VM.Allocate
  VM.Audit
  VM.Clone
  VM.Config.CDROM
  VM.Config.CPU
  VM.Config.Cloudinit
  VM.Config.Disk
  VM.Config.HWType
  VM.Config.Memory
  VM.Config.Network
  VM.Config.Options
  VM.Console
  VM.GuestAgent.Audit
  VM.PowerMgmt
  VM.Snapshot
)
PRIVS_CSV="$(IFS=,; echo "${PRIVS[*]}")"

ssh -o BatchMode=yes -o ConnectTimeout=5 -i "${PROXMOX_SSH_KEY:?PROXMOX_SSH_KEY is required}" \
  "${PROXMOX_SSH_USER:?PROXMOX_SSH_USER is required}@${PROXMOX_SSH_HOST:?PROXMOX_SSH_HOST is required}" \
  sudo -n bash -s -- "$ROLE" "$POOL" "$USERID" "$TOKEN_NAME" "$STORAGE_TEMPLATE" "$STORAGE_ROOT" "$VMID_GRANT" "$PRIVS_CSV" <<'REMOTE'
set -euo pipefail

ROLE="$1"
POOL="$2"
USERID="$3"
TOKEN_NAME="$4"
STORAGE_TEMPLATE="$5"
STORAGE_ROOT="$6"
VMID_GRANT="$7"
PRIVS="$8"

pveum role add "$ROLE" -privs "$PRIVS" 2>/dev/null || pveum role modify "$ROLE" -privs "$PRIVS"
pvesh create /pools -poolid "$POOL" -comment "proxmox-mcp live smoke resources" 2>/dev/null || true
pveum user add "$USERID" -comment "proxmox-mcp live smoke user" 2>/dev/null || true
pveum acl modify "/pool/$POOL" -user "$USERID" -role "$ROLE"
pveum acl modify "/storage/$STORAGE_TEMPLATE" -user "$USERID" -role "$ROLE"
pveum acl modify "/storage/$STORAGE_ROOT" -user "$USERID" -role "$ROLE"
pveum acl modify "/sdn" -user "$USERID" -role "$ROLE"
if [[ -n "$VMID_GRANT" ]]; then
  pveum acl modify "/vms/$VMID_GRANT" -user "$USERID" -role "$ROLE"
fi

if pveum user token list "$USERID" --output-format json | grep -q "\"tokenid\":\"$TOKEN_NAME\""; then
  echo "Token $USERID!$TOKEN_NAME already exists; role and ACLs updated. Delete and recreate it manually to rotate the secret."
else
  echo "Creating token $USERID!$TOKEN_NAME"
  pveum user token add "$USERID" "$TOKEN_NAME" -privsep 0 -comment "proxmox-mcp live smoke token"
fi
REMOTE
