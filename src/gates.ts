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

export function assertDestructive(args: Record<string, unknown>, toolName: string): void {
  if (args.confirm !== true || args.destructive !== true) {
    throw new WriteGateError(
      `${toolName} is a destructive operation. Pass {"confirm": true, "destructive": true} to proceed.`,
    );
  }
}

export function assertEnvFlag(envKey: string, toolName: string, env: Record<string, string | undefined> = process.env): void {
  const value = env[envKey];
  if (!value || !["true", "1", "yes"].includes(value.toLowerCase())) {
    throw new WriteGateError(
      `${toolName} requires env flag ${envKey}=1 to be set. This is a destructive operation gate independent of the confirm/destructive args.`,
    );
  }
}
