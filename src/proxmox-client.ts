import { request as httpsRequest } from "node:https";

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
  usesInsecureTls: boolean;

  constructor(private cfg: ClientInstanceConfig, opts: ProxmoxClientOptions = {}) {
    this.authHeader = `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
    this.usesInsecureTls = cfg.tlsInsecure && cfg.url.startsWith("https://");
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
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
        const res = await this.fetchUrl(url, method, headers, bodyStr);
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

  private async fetchUrl(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; text(): Promise<string> }> {
    if (!this.usesInsecureTls) {
      return fetch(url, { method, headers, body });
    }
    return nodeRequest(url, method, headers, body, false);
  }
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function nodeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  rejectUnauthorized: boolean,
): Promise<{ status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      parsed,
      { method, headers, rejectUnauthorized },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            text: async () => text,
          });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
