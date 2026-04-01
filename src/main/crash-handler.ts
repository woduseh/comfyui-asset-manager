interface ProcessLike {
  on(event: 'uncaughtException' | 'unhandledRejection', listener: (value: unknown) => void): unknown
}

interface LoggerLike {
  error(message: string, value: unknown): void
}

export function installCrashHandlers(
  processLike: ProcessLike,
  log: LoggerLike,
  exit: (code: number) => void
): void {
  processLike.on('uncaughtException', (error) => {
    log.error('[CRASH] Uncaught exception:', error)
    exit(1)
  })

  processLike.on('unhandledRejection', (reason) => {
    log.error('[CRASH] Unhandled promise rejection:', reason)
  })
}
