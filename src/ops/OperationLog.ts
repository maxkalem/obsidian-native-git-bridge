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
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = (parsed as LogEntry[]).slice(-LOG_MAX_ENTRIES);
        }
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
  return (
    s
      // Any userinfo in a URL, not only the `user:password` form. A personal
      // access token is normally carried as the USERNAME with no password at
      // all (`https://ghp_…@github.com/…`), and the pattern that only looked
      // for a colon walked straight past it.
      //
      // `git@` is the one exception kept: it is the universal SSH user, it is
      // not a secret, and blanking it turns every ssh remote in a log into the
      // same unreadable string.
      .replace(/(\w+:\/\/)([^/\s@]+)@/g, (m, scheme: string, userinfo: string) =>
        userinfo === "git" ? m : `${scheme}***@`
      )
      // And tokens that appear with no URL around them — an `Authorization`
      // header echoed by a failing helper, a token pasted into a command. The
      // prefixes are the ones the hosts actually issue.
      .replace(/\b(gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{8,}/g, "$1***")
      .replace(/\b(Bearer|token)\s+[A-Za-z0-9._-]{8,}/gi, "$1 ***")
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more bytes truncated)` : s;
}
