// NOTE: openclaw/plugin-sdk/plugin-entry's AnyAgentTool expects
// AgentToolResult<unknown> (with a `details` field), but our tool factories
// return MCP-shaped { content: [{ type: "text", text }] } results so the same
// tool objects can be served over the MCP stdio transport in mcp-server.ts.
// The runtime registration is duck-typed and works fine; we cast through
// `unknown` to bridge the intentional structural mismatch.
import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { resolveConfig, type ProxmoxConfig } from "./src/config.ts";
import { ProxmoxClient } from "./src/proxmox-client.ts";
import { registerSecret, redact } from "./src/security.ts";
import * as tools from "./src/tools/index.ts";

interface ToolLike {
  name: string;
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>;
  [key: string]: unknown;
}

export function withRedactedErrors<T extends ToolLike>(tool: T): T {
  const orig = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (id: string, args: Record<string, unknown>) => {
      try {
        return await orig(id, args);
      } catch (e) {
        const msg = redact((e as Error).message) as string;
        return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
      }
    },
  };
}

function makeFactory(cfg: ProxmoxConfig) {
  registerSecret(cfg.tokenId);
  registerSecret(cfg.tokenSecret);
  registerSecret(`PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`);
  return () => new ProxmoxClient(cfg);
}

export default definePluginEntry({
  id: "proxmox",
  name: "Proxmox",
  description: "Proxmox VE control: status, container + VM lifecycle, snapshots, backups, recent tasks. Single-cluster, token auth, optional TLS-insecure. Tier-2 writes gated by confirm:true.",
  register(api) {
    if (api.registrationMode !== "full") return;
    const cfg = resolveConfig(process.env);
    const getClient = makeFactory(cfg);
    const register = (t: ToolLike) => api.registerTool(withRedactedErrors(t) as unknown as AnyAgentTool);
    register(tools.createProxmoxStatusTool(getClient));
    register(tools.createProxmoxListContainersTool(getClient));
    register(tools.createProxmoxListVmsTool(getClient));
    register(tools.createProxmoxGetResourceTool(getClient));
    register(tools.createProxmoxRecentTasksTool(getClient));
    register(tools.createProxmoxListBackupsTool(getClient));
    register(tools.createProxmoxResourceUsageTool(getClient));
    register(tools.createProxmoxStartResourceTool(getClient));
    register(tools.createProxmoxStopResourceTool(getClient));
    register(tools.createProxmoxRebootResourceTool(getClient));
    register(tools.createProxmoxSnapshotResourceTool(getClient));
    register(tools.createProxmoxRunBackupTool(getClient));
  },
});
