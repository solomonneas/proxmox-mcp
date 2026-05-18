export interface ProxmoxSshConfig {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  vmUser: string;
  vmKeyPath: string;
}

export interface ProxmoxConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
  tlsInsecure: boolean;
  ssh: ProxmoxSshConfig;
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

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function resolveConfig(env: Record<string, string | undefined>): ProxmoxConfig {
  const url = env.PROXMOX_URL;
  const tokenId = env.PROXMOX_TOKEN_ID;
  const tokenSecret = env.PROXMOX_TOKEN_SECRET;
  if (!url) throw new ConfigError("PROXMOX_URL is required");
  if (!tokenId) throw new ConfigError("PROXMOX_TOKEN_ID is required");
  if (!tokenSecret) throw new ConfigError("PROXMOX_TOKEN_SECRET is required");
  const trimmedUrl = url.replace(/\/+$/, "");
  const sshHost = env.PROXMOX_SSH_HOST ?? hostnameFromUrl(trimmedUrl);
  const sshPort = env.PROXMOX_SSH_PORT ? parseInt(env.PROXMOX_SSH_PORT, 10) : 22;
  const sshUser = env.PROXMOX_SSH_USER ?? "root";
  const sshKey = env.PROXMOX_SSH_KEY ?? "~/.ssh/id_ed25519";
  return {
    url: trimmedUrl,
    tokenId,
    tokenSecret,
    tlsInsecure: isTruthy(env.PROXMOX_TLS_INSECURE),
    ssh: {
      host: sshHost,
      port: sshPort,
      user: sshUser,
      keyPath: sshKey,
      vmUser: env.PROXMOX_VM_SSH_USER ?? sshUser,
      vmKeyPath: env.PROXMOX_VM_SSH_KEY ?? sshKey,
    },
  };
}
