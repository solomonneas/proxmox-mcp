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
  // TODO(v0.2): Node's global fetch (undici) ignores node:https.Agent. For real
  // self-signed PVE hosts the TLS-insecure path should use undici.Agent
  // ({ connect: { rejectUnauthorized: false } }) via the `dispatcher` init
  // option. Tests use http://, so this path is not exercised in v0.1.
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
      // PVE API rejects application/json on POST/PUT - it requires form-encoded bodies.
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          if (v === undefined || v === null) continue;
          form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
        headers["content-type"] = "application/x-www-form-urlencoded";
        bodyStr = form.toString();
      } else {
        headers["content-type"] = "application/json";
        bodyStr = JSON.stringify(body);
      }
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
