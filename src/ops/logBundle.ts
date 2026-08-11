import { redact, type LogEntry } from "./OperationLog";

/**
 * One file carrying everything that describes a failure, for handing to
 * somebody else.
 *
 * Three things are needed to explain a failure here and they live in three
 * places: the plugin's own ring buffer (what was asked and what came back), the
 * `detail` on each entry (git's stderr, which is where the real reason usually
 * is), and `runtime/runner.log` (what the Termux side did, including the parts
 * that never reach a result file). Copying the visible list alone leaves out
 * two of the three, which is what made a report from a device hard to act on.
 *
 * Building it is pure and lives here rather than in the modal: what goes in,
 * what is redacted and how much is kept are decisions worth testing, and the
 * modal only has to hand over the pieces.
 */

export interface LogBundleParts {
  /** Plugin version, runner version, platform, profile — the diagnostics header. */
  facts: Record<string, string>;
  entries: readonly LogEntry[];
  /** `runtime/runner.log` as read from the vault, or null when it is not there. */
  runnerLog: string | null;
  /**
   * The recent per-request progress streams, newest first, already collapsed and
   * redacted by the caller.
   *
   * These are the fourth place a reason can hide, and the only one that says
   * anything about an operation that never produced a result at all: a fetch
   * killed by the timeout leaves no entry detail and no runner verdict, but its
   * stream stops at the percentage it reached.
   */
  progress?: readonly { id: string; action?: string; text: string }[];
  /** ISO timestamp the bundle was built at. */
  now: string;
}

/**
 * Ceiling for the Termux log inside the bundle. The runner trims its own file
 * at 256 KB, and the tail is the part that describes the failure being
 * reported; a bundle nobody can open or send is not a bundle.
 */
export const RUNNER_LOG_TAIL_BYTES = 64 * 1024;

function tail(s: string, bytes: number): { text: string; trimmed: boolean } {
  if (s.length <= bytes) return { text: s, trimmed: false };
  // Cut at a line boundary, so the file never opens mid-line.
  const cut = s.slice(s.length - bytes);
  const nl = cut.indexOf("\n");
  return { text: nl >= 0 ? cut.slice(nl + 1) : cut, trimmed: true };
}

export function buildLogBundle(parts: LogBundleParts): string {
  const out: string[] = [];
  out.push("Native Git Bridge — operation log bundle");
  out.push(`Collected: ${parts.now}`);
  out.push("");
  out.push("## Environment");
  for (const [k, v] of Object.entries(parts.facts)) out.push(`${k}: ${redact(v)}`);
  out.push("");
  out.push(`## Plugin operation log (${parts.entries.length} entries, oldest first)`);
  if (parts.entries.length === 0) {
    out.push("(empty)");
  } else {
    for (const e of parts.entries) {
      out.push(`${e.ts} [${e.level}] ${e.action}: ${e.message}`);
      // The detail is git's own stdout/stderr. Indented so a multi-line stack
      // cannot be mistaken for further log entries.
      if (e.detail !== undefined && e.detail !== "") {
        out.push(...e.detail.split("\n").map((l) => `    ${l}`));
      }
    }
  }
  out.push("");
  out.push("## Termux runner log (runtime/runner.log)");
  if (parts.runnerLog === null) {
    out.push("(not present — the runner has not written one to this vault yet)");
  } else {
    const t = tail(parts.runnerLog, RUNNER_LOG_TAIL_BYTES);
    if (t.trimmed) out.push(`(trimmed to the last ${RUNNER_LOG_TAIL_BYTES} bytes)`);
    // Redacted here and not only at write time: this file comes from Termux,
    // where a remote URL carrying a token can end up in git's own output. The
    // plugin's own entries are redacted on the way in; this one never was.
    out.push(redact(t.text).trimEnd());
  }
  out.push("");
  const streams = parts.progress ?? [];
  out.push(`## Progress streams (${streams.length}, newest first)`);
  if (streams.length === 0) {
    out.push("(none — no recent operation streamed one, or the runner predates them)");
  } else {
    for (const s of streams) {
      out.push("");
      out.push(`### ${s.id}${s.action !== undefined && s.action !== "" ? ` — ${s.action}` : ""}`);
      out.push(s.text === "" ? "(empty)" : s.text);
    }
  }
  out.push("");
  return out.join("\n");
}

/**
 * The pattern added to `.git/info/exclude` for the shareable copy.
 *
 * One entry, not one per bundle: the exclude file is append-only and a line per
 * report would grow without limit. Anchored at the repository root by the
 * runner, which prefixes what it writes with `/`.
 */
export const LOG_NOTE_GLOB = "ngb-log-*.md";

/** File name for the bundle: sortable, unique per minute, no path separators. */
export function logBundleName(now: string): string {
  return `ngb-log-${now.replace(/[:.]/g, "-").slice(0, 19)}.txt`;
}
