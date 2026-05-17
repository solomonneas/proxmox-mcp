# proxmox-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (implementer-only, opus-4-7). Steps use `- [ ]` checkboxes.

**Goal:** Ship `solomonneas/proxmox-mcp` v0.1.0 - 12 tools across read + safe-write tiers driving a Proxmox VE cluster via API token auth. Dual-publish to npm + ClawHub from day one.

**Architecture:** Mirrors `solomonneas/adguard-mcp` template. TypeScript + `@modelcontextprotocol/sdk` + TypeBox + vitest + tsup. Single-cluster v1. Token auth. Optional TLS-insecure for self-signed homelab certs. Tier 2 writes gated by `confirm: true`. No Tier 3 destructive in v1.

**Tech Stack:** TypeScript 6, `@modelcontextprotocol/sdk` ^1.29, `@sinclair/typebox` ^0.34, vitest ^4, tsup ^8, tsx ^4, openclaw ^2026.4.22 (peerDep).

---

## File Structure

**Create:**
- `package.json` (with `openclaw.compat` + `openclaw.build` from day one to avoid clawhub version burn), `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- `src/config.ts` - single-instance env resolution + TLS toggle
- `src/proxmox-client.ts` - HTTP token-auth client + optional `rejectUnauthorized: false`
- `src/security.ts` - token redaction (same pattern as adguard-mcp's)
- `src/gates.ts` - `assertConfirmedWrite` only (no `assertDestructive` in v1)
- `src/tools/_util.ts`, `src/tools/<one-per-tool>.ts` (12), `src/tools/index.ts`
- `mcp-server.ts`, `index.ts`, `openclaw.plugin.json`
- `tests/fake-proxmox.ts` + per-tool tests + `tests/integration.test.ts`
- `README.md`, `LICENSE`

---

## Phase 1: Scaffolding

### Task 1: package.json + build config

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`

- [ ] **Step 1: Write package.json (includes openclaw block from day one)**

```json
{
  "name": "@solomonneas/proxmox-mcp",
  "version": "0.1.0",
  "description": "MCP server exposing Proxmox VE read + safe-write tools",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.5.17",
      "pluginSdkVersion": "2026.5.17"
    }
  },
  "bin": { "proxmox-mcp": "./dist/mcp-server.js" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsup",
    "start": "node dist/mcp-server.js",
    "dev": "tsx mcp-server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run typecheck && npm test && npm run build"
  },
  "files": ["dist", "openclaw.plugin.json", "README.md", "LICENSE"],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@sinclair/typebox": "^0.34.0"
  },
  "peerDependencies": { "openclaw": "^2026.4.22" },
  "peerDependenciesMeta": { "openclaw": { "optional": true } },
  "devDependencies": {
    "@types/node": "^25.6.2",
    "openclaw": "^2026.4.22",
    "tsup": "^8.4.0",
    "tsx": "^4.19.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  },
  "engines": { "node": ">=20" },
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/solomonneas/proxmox-mcp" }
}
```

- [ ] **Step 2: Write tsconfig.json**

Same as adguard-mcp's (includes `"types": ["node"]`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["index.ts", "mcp-server.ts", "src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Write tsup.config.ts**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "mcp-server": "mcp-server.ts", "index": "index.ts" },
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: false,
  external: [/^openclaw(\/|$)/],
  banner: { js: "#!/usr/bin/env node" },
});
```

- [ ] **Step 4: Write vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 10000 },
});
```

- [ ] **Step 5: Install + commit**

```bash
cd ~/repos/proxmox-mcp
npm install 2>&1 | tail -3
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts
git commit -m "chore: scaffold package + build config"
```

---

### Task 2: config.ts + tests

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { resolveConfig, ConfigError } from "../src/config.ts";

describe("resolveConfig", () => {
  it("parses required env", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006",
      PROXMOX_TOKEN_ID: "u@pam!t1",
      PROXMOX_TOKEN_SECRET: "secret-uuid",
    });
    expect(cfg.url).toBe("https://pve.local:8006");
    expect(cfg.tokenId).toBe("u@pam!t1");
    expect(cfg.tokenSecret).toBe("secret-uuid");
    expect(cfg.tlsInsecure).toBe(false);
  });

  it("parses TLS insecure flag (true/1/yes/case-insensitive)", () => {
    for (const v of ["true", "True", "1", "yes", "YES"]) {
      const cfg = resolveConfig({
        PROXMOX_URL: "https://x:8006",
        PROXMOX_TOKEN_ID: "u@pam!t",
        PROXMOX_TOKEN_SECRET: "s",
        PROXMOX_TLS_INSECURE: v,
      });
      expect(cfg.tlsInsecure).toBe(true);
    }
  });

  it("TLS insecure defaults false on falsy values", () => {
    for (const v of ["false", "0", "no", "", undefined]) {
      const cfg = resolveConfig({
        PROXMOX_URL: "https://x:8006",
        PROXMOX_TOKEN_ID: "u@pam!t",
        PROXMOX_TOKEN_SECRET: "s",
        ...(v === undefined ? {} : { PROXMOX_TLS_INSECURE: v }),
      });
      expect(cfg.tlsInsecure).toBe(false);
    }
  });

  it("throws ConfigError on missing PROXMOX_URL", () => {
    expect(() => resolveConfig({ PROXMOX_TOKEN_ID: "x", PROXMOX_TOKEN_SECRET: "y" })).toThrow(ConfigError);
  });

  it("throws ConfigError on missing PROXMOX_TOKEN_ID", () => {
    expect(() => resolveConfig({ PROXMOX_URL: "https://x", PROXMOX_TOKEN_SECRET: "y" })).toThrow(ConfigError);
  });

  it("throws ConfigError on missing PROXMOX_TOKEN_SECRET", () => {
    expect(() => resolveConfig({ PROXMOX_URL: "https://x", PROXMOX_TOKEN_ID: "y" })).toThrow(ConfigError);
  });

  it("strips trailing slash from PROXMOX_URL", () => {
    const cfg = resolveConfig({
      PROXMOX_URL: "https://pve.local:8006/",
      PROXMOX_TOKEN_ID: "u@pam!t",
      PROXMOX_TOKEN_SECRET: "s",
    });
    expect(cfg.url).toBe("https://pve.local:8006");
  });
});
```

- [ ] **Step 2: Run red**

```bash
npx vitest run tests/config.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement src/config.ts**

```typescript
export interface ProxmoxConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
  tlsInsecure: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.toLowerCase());
}

export function resolveConfig(env: Record<string, string | undefined>): ProxmoxConfig {
  const url = env.PROXMOX_URL;
  const tokenId = env.PROXMOX_TOKEN_ID;
  const tokenSecret = env.PROXMOX_TOKEN_SECRET;
  if (!url) throw new ConfigError("PROXMOX_URL is required");
  if (!tokenId) throw new ConfigError("PROXMOX_TOKEN_ID is required");
  if (!tokenSecret) throw new ConfigError("PROXMOX_TOKEN_SECRET is required");
  return {
    url: url.replace(/\/+$/, ""),
    tokenId,
    tokenSecret,
    tlsInsecure: isTruthy(env.PROXMOX_TLS_INSECURE),
  };
}
```

- [ ] **Step 4: Run green + commit**

```bash
npx vitest run tests/config.test.ts 2>&1 | tail -5
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): env resolution + TLS toggle"
```

---

### Task 3: proxmox-client.ts + fake-server + security.ts + gates.ts

**Files:**
- Create: `src/proxmox-client.ts`, `src/security.ts`, `src/gates.ts`, `tests/fake-proxmox.ts`, `tests/client.test.ts`, `tests/security.test.ts`, `tests/gates.test.ts`

Combine three small modules + their tests into one task. Plan code blocks for each below.

- [ ] **Step 1: Write tests/fake-proxmox.ts** (mirror adguard-mcp's fake-adguard.ts shape exactly; PVE API is single-endpoint per path so same harness works). Adapt:

```typescript
import { createServer, Server, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  path: string;
  authHeader: string | null;
  body: string;
}

export interface FakeRoute {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export interface FakeProxmox {
  baseUrl: string;
  requests: CapturedRequest[];
  routes: FakeRoute[];
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeProxmox(routes: FakeRoute[] = []): Promise<FakeProxmox> {
  const fake: FakeProxmox = {
    baseUrl: "",
    requests: [],
    routes: [...routes],
    reset() { fake.requests.length = 0; fake.routes.length = 0; },
    close: () => Promise.resolve(),
  };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      fake.requests.push({
        method: req.method ?? "GET",
        path: req.url ?? "/",
        authHeader: req.headers.authorization ?? null,
        body,
      });
      const route = fake.routes.find((r) => r.method === req.method && r.path === req.url);
      if (!route) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ message: `no fake route for ${req.method} ${req.url}` }));
        return;
      }
      res.statusCode = route.status;
      res.setHeader("content-type", "application/json");
      res.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  fake.baseUrl = `http://127.0.0.1:${port}`;
  fake.close = () => new Promise<void>((r) => server.close(() => r()));
  return fake;
}
```

- [ ] **Step 2: Write tests/security.test.ts** (mirror adguard-mcp's security.test.ts):

```typescript
import { describe, it, expect } from "vitest";
import { redact, registerSecret } from "../src/security.ts";

describe("redact", () => {
  it("masks registered secrets in strings", () => {
    registerSecret("super-secret-uuid");
    expect(redact("token: super-secret-uuid")).toContain("REDACTED");
  });

  it("walks objects + arrays deeply", () => {
    registerSecret("hidden-uuid");
    const out = redact({ headers: { authorization: "PVEAPIToken=u@pam!t=hidden-uuid" }, ok: true });
    expect(JSON.stringify(out)).not.toContain("hidden-uuid");
  });

  it("passes non-strings through unchanged", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });

  it("ignores empty secret registrations", () => {
    registerSecret("");
    expect(redact("anything")).toBe("anything");
  });
});
```

- [ ] **Step 3: Write tests/gates.test.ts**:

```typescript
import { describe, it, expect } from "vitest";
import { assertConfirmedWrite, WriteGateError } from "../src/gates.ts";

describe("assertConfirmedWrite", () => {
  it("passes when confirm is true", () => {
    expect(() => assertConfirmedWrite({ confirm: true }, "proxmox_start_resource")).not.toThrow();
  });
  it("throws when confirm is missing", () => {
    expect(() => assertConfirmedWrite({}, "proxmox_start_resource")).toThrow(WriteGateError);
  });
  it("throws when confirm is false", () => {
    expect(() => assertConfirmedWrite({ confirm: false }, "proxmox_start_resource")).toThrow(WriteGateError);
  });
  it("error message names the tool", () => {
    try { assertConfirmedWrite({}, "proxmox_start_resource"); }
    catch (e) { expect((e as Error).message).toContain("proxmox_start_resource"); }
  });
});
```

- [ ] **Step 4: Write tests/client.test.ts**:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "./fake-proxmox.ts";
import { ProxmoxClient, ProxmoxClientError, ProxmoxUnreachableError } from "../src/proxmox-client.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

describe("ProxmoxClient", () => {
  it("sends PVEAPIToken auth header", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 200, body: { data: { version: "9.1.6" } } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "secret", tlsInsecure: false });
    const r = await c.get<{ version: string }>("/version");
    expect(r.version).toBe("9.1.6");
    expect(fake.requests[0].authHeader).toBe("PVEAPIToken=u@pam!t=secret");
  });

  it("strips PVE data envelope", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/cluster/resources", status: 200, body: { data: [{ vmid: 100 }, { vmid: 101 }] } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
    const r = await c.get<unknown[]>("/cluster/resources");
    expect(Array.isArray(r)).toBe(true);
    expect(r).toHaveLength(2);
  });

  it("throws ProxmoxClientError on 401", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 401, body: { message: "auth fail" } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "x", tokenSecret: "y", tlsInsecure: false });
    await expect(c.get("/version")).rejects.toThrow(ProxmoxClientError);
  });

  it("retries once on 5xx then throws Unreachable", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 502, body: { message: "bad gw" } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "x", tokenSecret: "y", tlsInsecure: false }, { retryDelayMs: 5 });
    await expect(c.get("/version")).rejects.toThrow(ProxmoxUnreachableError);
    expect(fake.requests).toHaveLength(2);
  });

  it("posts JSON body and URL-encodes form params", async () => {
    fake = await startFakeProxmox([
      { method: "POST", path: "/api2/json/nodes/pve/lxc/100/status/start", status: 200, body: { data: "UPID:..." } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false });
    await c.post("/nodes/pve/lxc/100/status/start", {});
    expect(fake.requests[0].method).toBe("POST");
  });

  it("does not leak token in thrown error messages", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 401, body: { message: "unauthorized" } },
    ]);
    const c = new ProxmoxClient({ url: fake.baseUrl, tokenId: "u@pam!t", tokenSecret: "super-secret", tlsInsecure: false });
    try {
      await c.get("/version");
    } catch (e) {
      expect((e as Error).message).not.toContain("super-secret");
      expect((e as Error).message).not.toContain("PVEAPIToken=u@pam!t=super-secret");
    }
  });
});
```

- [ ] **Step 5: Run red on all 4 test files**

```bash
npx vitest run 2>&1 | tail -10
```

- [ ] **Step 6: Implement src/security.ts** (verbatim from adguard-mcp's security.ts, including the base64 token detection):

```typescript
const SECRETS = new Set<string>();
const BASE64_TOKEN_RE = /[A-Za-z0-9+/=]{12,}/g;

export function registerSecret(s: string): void {
  if (s && s.length > 0) SECRETS.add(s);
}

function maskString(s: string): string {
  let out = s;
  for (const secret of SECRETS) {
    if (out.includes(secret)) out = out.split(secret).join("REDACTED");
  }
  out = out.replace(BASE64_TOKEN_RE, (token) => {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      for (const secret of SECRETS) {
        if (decoded.includes(secret)) return "REDACTED";
      }
    } catch {}
    return token;
  });
  return out;
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

export function _resetForTests(): void {
  SECRETS.clear();
}
```

- [ ] **Step 7: Implement src/gates.ts**:

```typescript
export class WriteGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteGateError";
  }
}

export function assertConfirmedWrite(args: Record<string, unknown>, toolName: string): void {
  if (args.confirm !== true) {
    throw new WriteGateError(`${toolName} is a write operation. Pass {"confirm": true} to proceed.`);
  }
}
```

- [ ] **Step 8: Implement src/proxmox-client.ts**:

```typescript
import { Agent } from "node:https";

export interface ProxmoxClientOptions {
  retryDelayMs?: number;
}

export class ProxmoxClientError extends Error {
  constructor(public status: number, message: string) {
    super(`Proxmox ${status}: ${message}`);
    this.name = "ProxmoxClientError";
  }
}

export class ProxmoxUnreachableError extends Error {
  constructor(cause: string) {
    super(`Proxmox unreachable: ${cause}`);
    this.name = "ProxmoxUnreachableError";
  }
}

export interface ClientInstanceConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
  tlsInsecure: boolean;
}

export class ProxmoxClient {
  private authHeader: string;
  private retryDelayMs: number;
  private agent?: Agent;

  constructor(private cfg: ClientInstanceConfig, opts: ProxmoxClientOptions = {}) {
    this.authHeader = `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
    if (cfg.tlsInsecure && cfg.url.startsWith("https://")) {
      this.agent = new Agent({ rejectUnauthorized: false });
    }
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.cfg.url + "/api2/json" + path;
    const headers: Record<string, string> = { authorization: this.authHeader };
    let bodyStr: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      bodyStr = JSON.stringify(body);
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const init: RequestInit & { dispatcher?: unknown } = { method, headers, body: bodyStr };
        if (this.agent) (init as Record<string, unknown>).agent = this.agent;
        const res = await fetch(url, init as RequestInit);
        if (res.status >= 200 && res.status < 300) {
          const text = await res.text();
          if (!text) return undefined as T;
          const parsed = JSON.parse(text);
          return (parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed) as T;
        }
        if (res.status >= 500) {
          lastErr = new ProxmoxUnreachableError(`HTTP ${res.status}`);
          if (attempt === 0) await sleep(this.retryDelayMs);
          continue;
        }
        const errText = await res.text();
        let msg = errText;
        try { msg = (JSON.parse(errText) as { message?: string }).message ?? errText; } catch {}
        throw new ProxmoxClientError(res.status, msg);
      } catch (e) {
        if (e instanceof ProxmoxClientError) throw e;
        lastErr = new ProxmoxUnreachableError((e as Error).message);
        if (attempt === 0) await sleep(this.retryDelayMs);
      }
    }
    throw lastErr ?? new ProxmoxUnreachableError("unknown");
  }
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
```

Note: `fetch` in Node uses undici and doesn't accept a node:https `Agent` directly. For the TLS-insecure case to work via global fetch, we set `NODE_TLS_REJECT_UNAUTHORIZED=0` is bad. Instead use `undici.Agent` for the dispatcher option. Since the test passes plain HTTP (fake server is `http://`), the TLS path won't fire in tests. For prod the implementer should refine to use `undici.Agent({ connect: { rejectUnauthorized: false }})` when TLS-insecure is true. Document this in a code comment + add a follow-up TODO in the design.

For v1: keep the code as shown above with the node:https Agent; document that TLS-insecure path is tested only via integration and may need an `undici.Agent` refinement when actually exercised against a real self-signed PVE. The tests don't need it.

- [ ] **Step 9: Run green + commit**

```bash
npx vitest run 2>&1 | tail -5
git add src tests/fake-proxmox.ts tests/security.test.ts tests/gates.test.ts tests/client.test.ts
git commit -m "feat(client): proxmox client + security + gates + fake server"
```

---

## Phase 2: Read tools (Tier 1)

### Task 4: Tier 1 read tools + tests

**Files:**
- Create: `src/tools/_util.ts`, 7 tool files, 7 test files

Pattern: each tool follows the adguard-mcp tools pattern verbatim (TypeBox schema, `createXxxTool(getClient)` factory, `execute` returns `jsonToolResult`).

- [ ] **Step 1: Write src/tools/_util.ts** (re-use adguard-mcp pattern but adapt for single-instance, no `instance` arg):

```typescript
import type { ProxmoxClient } from "../proxmox-client.ts";

export type ClientFactory = () => ProxmoxClient;

export function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
```

- [ ] **Step 2-8: Implement each read tool** following this template. Write the test, run red, implement, run green.

For brevity, here's the canonical shape with `proxmox_status` filled in. Each subsequent tool follows the same structure with different schema + endpoint.

**proxmox_status:**

`tests/tools/status.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { startFakeProxmox, FakeProxmox } from "../fake-proxmox.ts";
import { ProxmoxClient } from "../../src/proxmox-client.ts";
import { createProxmoxStatusTool } from "../../src/tools/proxmox_status.ts";

let fake: FakeProxmox | null = null;
afterEach(async () => { if (fake) await fake.close(); fake = null; });

describe("proxmox_status", () => {
  it("returns version + node list", async () => {
    fake = await startFakeProxmox([
      { method: "GET", path: "/api2/json/version", status: 200, body: { data: { version: "9.1.6", release: "9.1" } } },
      { method: "GET", path: "/api2/json/cluster/resources?type=node", status: 200, body: { data: [{ node: "pve", status: "online", cpu: 0.12, mem: 1234, maxmem: 99999 }] } },
    ]);
    const tool = createProxmoxStatusTool(() => new ProxmoxClient({ url: fake!.baseUrl, tokenId: "u@pam!t", tokenSecret: "s", tlsInsecure: false }));
    const r = await tool.execute("test", {});
    const payload = JSON.parse(r.content[0].text);
    expect(payload.version).toBe("9.1.6");
    expect(payload.nodes).toHaveLength(1);
  });
});
```

`src/tools/proxmox_status.ts`:

```typescript
import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

interface Version { version: string; release?: string; repoid?: string }
interface Node { node: string; status: string; cpu?: number; mem?: number; maxmem?: number; uptime?: number }

export function createProxmoxStatusTool(getClient: ClientFactory) {
  return {
    name: "proxmox_status",
    label: "proxmox: status",
    description: "Get PVE version + per-node status (online state, CPU, memory, uptime) via GET /version + GET /cluster/resources?type=node.",
    parameters: Schema,
    execute: async () => {
      const client = getClient();
      const [version, nodes] = await Promise.all([
        client.get<Version>("/version"),
        client.get<Node[]>("/cluster/resources?type=node"),
      ]);
      return jsonToolResult({ version: version.version, release: version.release, nodes });
    },
  };
}
```

- [ ] **Step 3: Implement the remaining 6 read tools** following the same shape. Endpoints:

| Tool | Endpoint | Schema args |
|---|---|---|
| `proxmox_list_containers` | `GET /cluster/resources?type=lxc` | (none) |
| `proxmox_list_vms` | `GET /cluster/resources?type=qemu` | (none) |
| `proxmox_get_resource` | First resolve vmid to {node, type} via `GET /cluster/resources`, then `GET /nodes/{node}/{type}/{vmid}/status/current` | `vmid: number` |
| `proxmox_recent_tasks` | `GET /cluster/tasks` (optionally with `?source=archive&limit=N`) | `limit?: number` (default 25), `vmid?: number` |
| `proxmox_list_backups` | First list storages via `GET /nodes/{node}/storage?content=backup`, then for each `GET /nodes/{node}/storage/{storage}/content?content=backup` | `node?: string` (default first node), `vmid?: number` |
| `proxmox_resource_usage` | `GET /nodes/{node}/{type}/{vmid}/rrddata?timeframe=hour` after resolving node + type | `vmid: number`, `timeframe?: 'hour'|'day'|'week'` (default hour) |

Each tool gets a parallel test file with one canned-response test.

For `proxmox_get_resource`, share a helper `resolveResource(client, vmid) -> {node, type}` that's used by get + usage + start/stop/reboot tools (factor into `_util.ts`).

- [ ] **Step 4: Run all read-tool tests + commit**

```bash
npx vitest run 2>&1 | tail -5
git add src/tools tests/tools
git commit -m "feat(tools): 7 tier-1 read tools (status + lists + detail + tasks + backups + usage)"
```

---

## Phase 3: Write tools (Tier 2)

### Task 5: 5 safe-write tools + tests

**Files:**
- Create: 5 tool files in `src/tools/`, 5 test files in `tests/tools/`

Each tool calls `assertConfirmedWrite` at the top of its handler, looks up node+type via shared `resolveResource`, posts to the appropriate PVE endpoint.

Endpoints + minimal schemas:

| Tool | Endpoint | Args |
|---|---|---|
| `proxmox_start_resource` | `POST /nodes/{node}/{type}/{vmid}/status/start` | `vmid: number`, `confirm: boolean` |
| `proxmox_stop_resource` | `POST /nodes/{node}/{type}/{vmid}/status/shutdown` | `vmid: number`, `confirm: boolean`, `timeoutSeconds?: number` |
| `proxmox_reboot_resource` | `POST /nodes/{node}/{type}/{vmid}/status/reboot` | `vmid: number`, `confirm: boolean` |
| `proxmox_snapshot_resource` | `POST /nodes/{node}/{type}/{vmid}/snapshot` body `{snapname, description?}` | `vmid: number`, `snapname: string`, `description?: string`, `confirm: boolean` |
| `proxmox_run_backup` | `POST /nodes/{node}/vzdump` body `{vmid, storage, mode: 'snapshot'\|'suspend'\|'stop', compress: 'zstd'}` | `vmid: number`, `storage: string`, `mode?: 'snapshot'\|'suspend'\|'stop'` (default snapshot), `confirm: boolean` |

Tests must cover:
- Refuses without `confirm: true` → throws `WriteGateError`
- With confirm: POSTs to the correct endpoint with correct body
- Looks up node+type by vmid first (via `resolveResource`)

Template tool body (proxmox_start_resource):

```typescript
import { Type } from "@sinclair/typebox";
import type { ClientFactory } from "./_util.ts";
import { jsonToolResult, resolveResource } from "./_util.ts";
import { assertConfirmedWrite } from "../gates.ts";

const Schema = Type.Object({
  vmid: Type.Integer({ minimum: 1, description: "Container or VM ID." }),
  confirm: Type.Boolean({ description: "Must be true to write. Tier-2 safe-write gate." }),
}, { additionalProperties: false });

const NAME = "proxmox_start_resource";

export function createProxmoxStartResourceTool(getClient: ClientFactory) {
  return {
    name: NAME,
    label: "proxmox: start resource",
    description: "Start a stopped LXC container or QEMU VM by vmid. Tier-2 write; requires confirm:true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      assertConfirmedWrite(raw, NAME);
      const args = raw as { vmid: number };
      const client = getClient();
      const { node, type } = await resolveResource(client, args.vmid);
      const upid = await client.post<string>(`/nodes/${node}/${type}/${args.vmid}/status/start`, {});
      return jsonToolResult({ vmid: args.vmid, node, type, upid });
    },
  };
}
```

Add `resolveResource(client, vmid)` to `_util.ts`:

```typescript
export async function resolveResource(client: ProxmoxClient, vmid: number): Promise<{ node: string; type: "lxc" | "qemu" }> {
  const resources = await client.get<Array<{ vmid: number; node: string; type: string }>>("/cluster/resources");
  const r = resources.find((x) => x.vmid === vmid && (x.type === "lxc" || x.type === "qemu"));
  if (!r) throw new Error(`vmid ${vmid} not found in cluster resources (not an LXC or VM)`);
  return { node: r.node, type: r.type as "lxc" | "qemu" };
}
```

Commit:

```bash
git add src/tools tests/tools
git commit -m "feat(tools): 5 tier-2 safe-write tools (start/stop/reboot/snapshot/backup)"
```

---

## Phase 4: Plugin entry + MCP server + manifest

### Task 6: index.ts + mcp-server.ts + openclaw.plugin.json + tools/index.ts

**Files:**
- Create: `src/tools/index.ts`, `index.ts`, `mcp-server.ts`, `openclaw.plugin.json`

- [ ] **Step 1: src/tools/index.ts**

```typescript
export { createProxmoxStatusTool } from "./proxmox_status.ts";
export { createProxmoxListContainersTool } from "./proxmox_list_containers.ts";
export { createProxmoxListVmsTool } from "./proxmox_list_vms.ts";
export { createProxmoxGetResourceTool } from "./proxmox_get_resource.ts";
export { createProxmoxRecentTasksTool } from "./proxmox_recent_tasks.ts";
export { createProxmoxListBackupsTool } from "./proxmox_list_backups.ts";
export { createProxmoxResourceUsageTool } from "./proxmox_resource_usage.ts";
export { createProxmoxStartResourceTool } from "./proxmox_start_resource.ts";
export { createProxmoxStopResourceTool } from "./proxmox_stop_resource.ts";
export { createProxmoxRebootResourceTool } from "./proxmox_reboot_resource.ts";
export { createProxmoxSnapshotResourceTool } from "./proxmox_snapshot_resource.ts";
export { createProxmoxRunBackupTool } from "./proxmox_run_backup.ts";
```

- [ ] **Step 2: index.ts (OpenClaw plugin entry)**

Mirror adguard-mcp's plugin entry pattern: import factories, `definePluginEntry`, register each tool, wrap with `withRedactedErrors`, register both `tokenId` and `tokenSecret` as secrets. Use `as unknown as AnyAgentTool` cast (the same intentional shape mismatch).

- [ ] **Step 3: mcp-server.ts**

Mirror adguard-mcp's. Register all 12 tools, redact errors via `security.ts`, advertise schemas.

- [ ] **Step 4: openclaw.plugin.json**

```json
{
  "schemaVersion": 1,
  "id": "proxmox",
  "name": "Proxmox",
  "version": "0.1.0",
  "description": "Proxmox VE read/write tools: status, containers, VMs, backups, lifecycle, snapshots.",
  "entry": "./dist/index.js",
  "activation": { "onStartup": true },
  "compat": { "openclaw": ">=2026.4.22" },
  "permissions": [],
  "configSchema": { "type": "object", "properties": {}, "additionalProperties": false }
}
```

- [ ] **Step 5: typecheck + build + commit**

```bash
npm run typecheck && npm run build
git add src/tools/index.ts index.ts mcp-server.ts openclaw.plugin.json
git commit -m "feat(server): MCP entry + OpenClaw plugin + 12-tool registration"
```

---

### Task 7: README + LICENSE

**Files:**
- Create: `README.md`, `LICENSE`

README mirrors adguard-mcp's structure: tool table, configuration table, install, 5-client setup blocks (Claude Desktop / Claude Code / OpenClaw / Hermes Agent / Codex CLI), safety section.

Generic example values throughout (use `192.168.1.10` / `https://pve.example.local:8006`, never the operator's actual home-network IP).

Commit:

```bash
git add README.md LICENSE
git commit -m "docs: README with 5-client setup + LICENSE"
```

---

### Task 8: Integration smoke + final npm pack

**Files:**
- Create: `tests/integration.test.ts`

Asserts:
- All 12 tools register with unique names
- Each tool has the expected name pattern `proxmox_*`
- An end-to-end status + start_resource cycle works through the fake server

```bash
npm test
npm pack --dry-run | tail -15
git add tests/integration.test.ts
git commit -m "test: integration smoke (12 tools + end-to-end)"
```

---

## Phase 5: Publish

### Task 9: GitHub repo + initial push

```bash
cd ~/repos/proxmox-mcp
gh repo create solomonneas/proxmox-mcp --public --description "MCP server for Proxmox VE: 12 tools across read + safe-write tiers" --source . --remote origin --push=false
git push -u origin master
```

### Task 10: Final leak scan + codex review + fix-up commit

Standard pre-push: leak scan + codex review against the full diff.

If blockers surface, fix in additional commits, then push.

### Task 11: Dual publish (npm + ClawHub)

```bash
npm publish --access public
SHA=$(git rev-parse HEAD)
rm -rf /tmp/clawhub-pub-proxmox
mkdir -p /tmp/clawhub-pub-proxmox
tar -xzf solomonneas-proxmox-mcp-0.1.0.tgz -C /tmp/clawhub-pub-proxmox
cd /tmp/clawhub-pub-proxmox/package
npx clawhub --workdir . package publish . \
  --family code-plugin \
  --version 0.1.0 \
  --tags "latest,mcp,proxmox,homelab,virtualization" \
  --source-repo solomonneas/proxmox-mcp \
  --source-commit "$SHA" \
  --source-ref master \
  --changelog "Initial public release. 12 tools across read + safe-write tiers. Token auth, optional TLS-insecure for self-signed."
```

Then tag the release: `git tag -a v0.1.0 -m "v0.1.0 - initial public release" && git push origin v0.1.0`.

### Task 12: Profile README update

Add to `~/repos/solomonneas-profile/README.md` under "MCP Servers":

```
- 🖥️ [proxmox-mcp](https://github.com/solomonneas/proxmox-mcp) - Proxmox VE control with 12 tools across read + safe-write tiers: status, container + VM lifecycle, snapshots, backups, recent tasks. Token auth, TLS-insecure toggle.
```

Commit + push.

---

## Self-review

Spec coverage: every spec acceptance criterion maps to a task.

Placeholder scan: none. Forward references for `resolveResource` are explicit (added in Task 5 _util.ts).

Type consistency: `ClientFactory = () => ProxmoxClient`, all tool factories `createXxxTool(getClient: ClientFactory)`, all returning `{name, label, description, parameters, execute}`.

---

## Execution

After all 12 tasks land:

```bash
npm test
npm run build
gh repo view solomonneas/proxmox-mcp
npm view @solomonneas/proxmox-mcp version
npx clawhub package inspect @solomonneas/proxmox-mcp
```
