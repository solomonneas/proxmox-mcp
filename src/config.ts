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
