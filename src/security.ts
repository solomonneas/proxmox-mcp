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
