type LogLevel = "debug" | "info" | "warn" | "error"

type LogMeta = Record<string, unknown>

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const consoleWriters: Record<LogLevel, (entry: string) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

function getEnvLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  if (raw && ["debug", "info", "warn", "error"].includes(raw)) {
    return raw as LogLevel
  }
  return "info"
}

const threshold = LEVEL_PRIORITY[getEnvLevel()]

function shouldLog(level: LogLevel) {
  return LEVEL_PRIORITY[level] >= threshold
}

function serializeEntry(level: LogLevel, message: string, baseContext?: LogMeta, meta?: LogMeta) {
  const entry: LogMeta = {
    source: "guidebuoy",
    level,
    timestamp: new Date().toISOString(),
    message,
  }

  if (baseContext && Object.keys(baseContext).length > 0) {
    entry.context = baseContext
  }

  if (meta && Object.keys(meta).length > 0) {
    entry.meta = meta
  }

  return entry
}

export type Logger = {
  debug: (message: string, meta?: LogMeta) => void
  info: (message: string, meta?: LogMeta) => void
  warn: (message: string, meta?: LogMeta) => void
  error: (message: string, meta?: LogMeta) => void
  withContext: (context: LogMeta) => Logger
}

export function createLogger(baseContext: LogMeta = {}): Logger {
  const log = (level: LogLevel, message: string, meta?: LogMeta) => {
    if (!shouldLog(level)) return
    const entry = serializeEntry(level, message, baseContext, meta)
    consoleWriters[level](JSON.stringify(entry))
  }

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
    withContext: (context) => createLogger({ ...baseContext, ...context }),
  }
}

export const logger = createLogger()
