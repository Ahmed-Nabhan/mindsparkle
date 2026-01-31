type LogLevel = "debug" | "info" | "warn" | "error";

type LogBase = {
  level: LogLevel;
  msg: string;
  time: string;
  jobId?: string;
  jobType?: string;
  documentId?: string;
  owner?: string;
};

export function log(base: Omit<LogBase, "time"> & Record<string, unknown>) {
  const entry = {
    time: new Date().toISOString(),
    ...base,
  };
  // Cloud Run picks up stdout JSON well.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

export function logError(base: Omit<LogBase, "level" | "time"> & Record<string, unknown>) {
  log({ level: "error", ...base });
}

export function logInfo(base: Omit<LogBase, "level" | "time"> & Record<string, unknown>) {
  log({ level: "info", ...base });
}

export function logWarn(base: Omit<LogBase, "level" | "time"> & Record<string, unknown>) {
  log({ level: "warn", ...base });
}
