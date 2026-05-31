import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, validateToolArgs } from "./_util.ts";

const Schema = Type.Object(
  {
    userid: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Optional user or full API token ID to audit. Defaults to current API identity.",
      }),
    ),
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description: "Permission paths to inspect. Defaults to common smoke-test paths.",
      }),
    ),
    pool: Type.Optional(Type.String({ minLength: 1, description: "Pool path shortcut (default mcp-smoke)." })),
    template_storage: Type.Optional(Type.String({ minLength: 1, description: "Template storage shortcut (default local)." })),
    root_storage: Type.Optional(Type.String({ minLength: 1, description: "Root disk storage shortcut (default local-lvm)." })),
    source_vmid: Type.Optional(Type.Integer({ minimum: 1, description: "Optional source VMID path to inspect." })),
    target_vmid: Type.Optional(Type.Integer({ minimum: 1, description: "Optional target VMID path to inspect." })),
    required_privileges: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description: "Privileges to summarize on every returned path.",
      }),
    ),
  },
  { additionalProperties: false },
);

type PermissionMap = Record<string, Record<string, number>>;

const NAME = "proxmox_audit_permissions";
const DEFAULT_REQUIRED = [
  "Datastore.AllocateSpace",
  "Datastore.Audit",
  "Pool.Allocate",
  "Pool.Audit",
  "SDN.Use",
  "Sys.Audit",
  "VM.Allocate",
  "VM.Audit",
  "VM.Backup",
  "VM.Clone",
  "VM.Config.Disk",
  "VM.Config.Memory",
  "VM.Config.Network",
  "VM.Config.Options",
  "VM.GuestAgent.Audit",
  "VM.PowerMgmt",
  "VM.Snapshot",
  "VM.Snapshot.Rollback",
];

function defaultPaths(args: {
  pool?: string;
  template_storage?: string;
  root_storage?: string;
  source_vmid?: number;
  target_vmid?: number;
}) {
  const paths = [
    "/",
    `/pool/${args.pool ?? "mcp-smoke"}`,
    `/storage/${args.template_storage ?? "local"}`,
    `/storage/${args.root_storage ?? "local-lvm"}`,
    "/sdn",
  ];
  if (args.source_vmid !== undefined) paths.push(`/vms/${args.source_vmid}`);
  if (args.target_vmid !== undefined) paths.push(`/vms/${args.target_vmid}`);
  return [...new Set(paths)];
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.append(key, value);
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function createProxmoxAuditPermissionsTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: audit permissions",
    description:
      "Read effective Proxmox permissions for the current token or a specified user/token across smoke-relevant paths (GET /access/permissions).",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const args = validateToolArgs<{
        userid?: string;
        paths?: string[];
        pool?: string;
        template_storage?: string;
        root_storage?: string;
        source_vmid?: number;
        target_vmid?: number;
        required_privileges?: string[];
      }>(Schema, raw, NAME);
      const paths = args.paths ?? defaultPaths(args);
      const required = args.required_privileges ?? DEFAULT_REQUIRED;
      const client = getClient();
      const results = [];
      for (const path of paths) {
        const permissions = await client.get<PermissionMap>(
          withQuery("/access/permissions", { path, userid: args.userid }),
        );
        const privileges = permissions[path] ?? permissions[Object.keys(permissions)[0] ?? ""] ?? {};
        const missing = required.filter((priv) => privileges[priv] !== 1);
        results.push({
          path,
          privilege_count: Object.keys(privileges).length,
          missing_required: missing,
          has_all_required: missing.length === 0,
          privileges,
        });
      }
      return jsonToolResult({
        userid: args.userid ?? "current",
        required_privileges: required,
        paths: results,
      });
    },
  };
}
