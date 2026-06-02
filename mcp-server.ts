import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveConfig, type ProxmoxConfig } from "./src/config.ts";
import { ProxmoxClient } from "./src/proxmox-client.ts";
import { execInLxc, execViaDirectSsh } from "./src/ssh-executor.ts";
import { registerSecret, redact } from "./src/security.ts";
import type { SshExecutor } from "./src/tools/_util.ts";
import * as toolFactories from "./src/tools/index.ts";
import { classifyToolError } from "./src/errors.ts";

const cfg: ProxmoxConfig = resolveConfig(process.env);
registerSecret(cfg.tokenId);
registerSecret(cfg.tokenSecret);
registerSecret(`PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`);

const getClient = () => new ProxmoxClient(cfg);

const hostCfg = {
  host: cfg.ssh.host,
  port: cfg.ssh.port,
  user: cfg.ssh.user,
  keyPath: cfg.ssh.keyPath,
};
const getSsh = (): SshExecutor => ({
  execInLxc: (vmid, command, timeoutMs, stdin) => execInLxc(hostCfg, vmid, command, timeoutMs, stdin),
  execViaDirectSsh: (target, command, timeoutMs, stdin) => execViaDirectSsh(target, command, timeoutMs, stdin),
});
const vmDefaults = { vmUser: cfg.ssh.vmUser, vmKeyPath: cfg.ssh.vmKeyPath };

const tools = [
  toolFactories.createProxmoxStatusTool(getClient),
  toolFactories.createProxmoxListContainersTool(getClient),
  toolFactories.createProxmoxListVmsTool(getClient),
  toolFactories.createProxmoxGetResourceTool(getClient),
  toolFactories.createProxmoxGetVmConfigTool(getClient),
  toolFactories.createProxmoxGetContainerConfigTool(getClient),
  toolFactories.createProxmoxValidateQemuSmokeSourceTool(getClient),
  toolFactories.createProxmoxAuditPermissionsTool(getClient),
  toolFactories.createProxmoxRecentTasksTool(getClient),
  toolFactories.createProxmoxListBackupsTool(getClient),
  toolFactories.createProxmoxResourceUsageTool(getClient),
  toolFactories.createProxmoxStartResourceTool(getClient),
  toolFactories.createProxmoxStopResourceTool(getClient),
  toolFactories.createProxmoxRebootResourceTool(getClient),
  toolFactories.createProxmoxSnapshotResourceTool(getClient),
  toolFactories.createProxmoxRollbackSnapshotTool(getClient),
  toolFactories.createProxmoxRunBackupTool(getClient),
  toolFactories.createProxmoxGetTaskStatusTool(getClient),
  toolFactories.createProxmoxGetTaskLogTool(getClient),
  toolFactories.createProxmoxListTemplatesTool(getClient),
  toolFactories.createProxmoxListStorageTool(getClient),
  toolFactories.createProxmoxListSnapshotsTool(getClient),
  toolFactories.createProxmoxGuestNetworkTool(getClient),
  toolFactories.createProxmoxWaitTaskTool(getClient),
  toolFactories.createProxmoxNextVmidTool(getClient),
  toolFactories.createProxmoxListPoolResourcesTool(getClient),
  toolFactories.createProxmoxCreateContainerTool(getClient),
  toolFactories.createProxmoxCreateVmTool(getClient),
  toolFactories.createProxmoxCloneResourceTool(getClient),
  toolFactories.createProxmoxDestroyResourceTool(getClient),
  toolFactories.createProxmoxCleanupSmokeResourcesTool(getClient),
  toolFactories.createProxmoxDeleteSnapshotTool(getClient),
  toolFactories.createProxmoxForceStopResourceTool(getClient),
  toolFactories.createProxmoxExecTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxReadFileTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxWriteFileTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxStatPathTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxListDirectoryTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceStatusTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceStartTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceStopTool(getClient, getSsh, vmDefaults),
  toolFactories.createProxmoxServiceRestartTool(getClient, getSsh, vmDefaults),
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

const server = new Server({ name: "proxmox-mcp", version: "0.5.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const t = toolMap.get(req.params.name);
  if (!t) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: `unknown tool: ${req.params.name}`,
          code: "UNKNOWN_TOOL",
          name: "UnknownToolError",
        }),
      }],
      isError: true,
    };
  }
  try {
    return await t.execute(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  } catch (e) {
    const payload = redact(classifyToolError(e));
    return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
  }
});

const transport = new StdioServerTransport();
  // Strip the draft-07 `$schema` the MCP SDK stamps on tool schemas; Anthropic
  // rejects it ("must match JSON Schema draft 2020-12") when the full tool set
  // is sent, e.g. on subagent spawns. Intercept tools/list output here.
  const __send = transport.send.bind(transport);
  (transport as any).send = (message: any) => {
    const tools = message?.result?.tools;
    if (Array.isArray(tools)) {
      for (const t of tools) {
        if (t?.inputSchema) delete t.inputSchema.$schema;
        if (t?.outputSchema) delete t.outputSchema.$schema;
      }
    }
    return __send(message);
  };
await server.connect(transport);
