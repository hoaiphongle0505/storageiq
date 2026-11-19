/** Thrown by `parseArgs` when the renderer sent malformed arguments; the handler never runs. */
export class InvalidIpcArgumentsError extends Error {
  constructor(reason: string) {
    super(`Invalid IPC arguments: ${reason}`)
    this.name = 'InvalidIpcArgumentsError'
  }
}

/** `parseArgs` for channels that take no arguments. */
export function noArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) {
    throw new InvalidIpcArgumentsError(`expected no arguments, got ${args.length}`)
  }
  return []
}

/** `parseArgs` for channels that take exactly one string. */
export function oneString(args: readonly unknown[]): [string] {
  if (args.length !== 1) {
    throw new InvalidIpcArgumentsError(`expected 1 argument, got ${args.length}`)
  }
  const [value] = args
  if (typeof value !== 'string') {
    throw new InvalidIpcArgumentsError(`expected a string, got ${typeof value}`)
  }
  return [value]
}
