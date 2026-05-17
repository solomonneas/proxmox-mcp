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
