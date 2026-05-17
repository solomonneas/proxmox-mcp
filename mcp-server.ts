import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveConfig, type ProxmoxConfig } from "./src/config.ts";
import { ProxmoxClient } from "./src/proxmox-client.ts";
import { registerSecret, redact } from "./src/security.ts";
import * as toolFactories from "./src/tools/index.ts";

const cfg: ProxmoxConfig = resolveConfig(process.env);
registerSecret(cfg.tokenId);
registerSecret(cfg.tokenSecret);
registerSecret(`PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`);

const getClient = () => new ProxmoxClient(cfg);

const tools = [
  toolFactories.createProxmoxStatusTool(getClient),
  toolFactories.createProxmoxListContainersTool(getClient),
  toolFactories.createProxmoxListVmsTool(getClient),
  toolFactories.createProxmoxGetResourceTool(getClient),
  toolFactories.createProxmoxRecentTasksTool(getClient),
  toolFactories.createProxmoxListBackupsTool(getClient),
  toolFactories.createProxmoxResourceUsageTool(getClient),
  toolFactories.createProxmoxStartResourceTool(getClient),
  toolFactories.createProxmoxStopResourceTool(getClient),
  toolFactories.createProxmoxRebootResourceTool(getClient),
  toolFactories.createProxmoxSnapshotResourceTool(getClient),
  toolFactories.createProxmoxRunBackupTool(getClient),
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

const server = new Server({ name: "proxmox-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const t = toolMap.get(req.params.name);
  if (!t) {
    return { content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${req.params.name}` }) }], isError: true };
  }
  try {
    return await t.execute(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  } catch (e) {
    const msg = redact((e as Error).message) as string;
    return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
