export type WorkerLogger = {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
};

const SECRET_KEY_PATTERN = /(token|secret|authorization|headers|responseBody)/i;

export function redactLogContext(context: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      redacted[key] = "[REDACTED]";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactLogContext(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export const consoleLogger: WorkerLogger = {
  info(event, context) {
    console.log(
      JSON.stringify({
        level: "info",
        event,
        at: new Date().toISOString(),
        ...redactLogContext(context ?? {})
      })
    );
  },
  warn(event, context) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event,
        at: new Date().toISOString(),
        ...redactLogContext(context ?? {})
      })
    );
  },
  error(event, context) {
    console.error(
      JSON.stringify({
        level: "error",
        event,
        at: new Date().toISOString(),
        ...redactLogContext(context ?? {})
      })
    );
  }
};
