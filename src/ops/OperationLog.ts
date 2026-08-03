import { LOG_MAX_ENTRIES } from "../constants";
import type { DeviceLocalSettingsStore } from "../settings/DeviceLocalSettingsStore";

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  action: string;
  message: string;
  detail?: string;
}

/**
 * Ring-buffer operation log, persisted device-locally (never through the vault).
 * Secrets must be stripped by callers before logging; this class additionally
 * redacts obvious credential-bearing URLs as a second line of defense.
 */
export class OperationLog {
  private entries: LogEntry[] = [];
  private static KEY = "oplog";

  constructor(private store: DeviceLocalSettingsStore) {
    const raw = store.getValue(OperationLog.KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this.entries = parsed.slice(-LOG_MAX_ENTRIES);
      } catch {
        /* start fresh */
      }
    }
  }

  add(level: LogEntry["level"], action: string, message: string, detail?: string): void {
    this.entries.push({
      ts: new Date().toISOString(),
      level,
      action,
      message: redact(message),
      detail: detail !== undefined ? redact(truncate(detail, 8 * 1024)) : undefined,
    });
    if (this.entries.length > LOG_MAX_ENTRIES) {
      this.entries = this.entries.slice(-LOG_MAX_ENTRIES);
    }
    this.persist();
  }

  list(): readonly LogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }

  private persist(): void {
    this.store.setValue(OperationLog.KEY, JSON.stringify(this.entries));
  }
}

/** Redact credentials embedded in URLs (https://user:pass@host -> https://***@host). */
export function redact(s: string): string {
  return s.replace(/(\w+:\/\/)[^/\s@]+:[^/\s@]+@/g, "$1***@");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more bytes truncated)` : s;
}
