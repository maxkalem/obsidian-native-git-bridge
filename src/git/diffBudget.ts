/**
 * What the diff pane says when a diff did not fit, and what the escape offers.
 *
 * The runner keeps whole hunks within a byte budget and reports how many it
 * left out. Turning those numbers into a sentence is a decision with enough
 * edge cases to be worth testing on its own: a diff that fits, one where a
 * single hunk is already too big, one that is entirely binary.
 */

import { DIFF_LIMIT_ABSOLUTE_MAX_KB } from "../settings/DeviceLocalSettingsStore";

export interface DiffBudgetFacts {
  /** Hunks the runner sent. */
  hunksShown: number;
  /** Hunks the diff has in total. */
  hunksTotal: number;
  /** Size of the whole diff in bytes, before trimming. */
  totalBytes: number;
  /** Budget the request carried, in bytes. */
  limitBytes: number;
  /** Lines actually rendered, for the cost estimate in the warning. */
  linesShown: number;
}

export interface DiffBudgetNotice {
  /** One line for the pane, above the diff. */
  text: string;
  /** Label for the button that fetches the whole diff, or null when it fits. */
  overrideLabel: string | null;
  /** Budget to ask for, in KB, when the user takes the override. */
  overrideKb: number;
  /** Lines the whole diff would render, for the confirmation. */
  estimatedLines: number;
  /**
   * True when the whole diff is larger than any single request can carry. The
   * override then shows as much as it can rather than promising everything.
   */
  cappedByTransport: boolean;
}

/** Roughly 12 DOM nodes per diff line, measured on the renderer. */
export const DOM_NODES_PER_LINE = 12;

const KB = 1024;

/** `null` when the diff arrived whole and there is nothing to say. */
export function describeDiffBudget(f: DiffBudgetFacts): DiffBudgetNotice | null {
  if (f.hunksTotal === 0 || f.hunksShown >= f.hunksTotal) return null;

  // Lines are estimated from the part that DID arrive, which is the only sample
  // available. A diff whose first hunk did not fit has no sample, so the
  // estimate falls back to bytes over a conservative line length.
  const bytesPerLine = f.linesShown > 0 ? Math.max(1, f.limitBytes / f.linesShown) : 40;
  const estimatedLines = Math.round(f.totalBytes / bytesPerLine);

  const wantKb = Math.ceil(f.totalBytes / KB);
  const cappedByTransport = wantKb > DIFF_LIMIT_ABSOLUTE_MAX_KB;
  const overrideKb = Math.min(wantKb, DIFF_LIMIT_ABSOLUTE_MAX_KB);

  const shown =
    f.hunksShown === 0
      ? `None of the ${f.hunksTotal} hunks fit in ${fmtKb(f.limitBytes)}`
      : `Showing ${f.hunksShown} of ${f.hunksTotal} hunks (${fmtKb(f.limitBytes)} limit)`;

  return {
    text: `${shown}. The whole diff is ${fmtKb(f.totalBytes)}.`,
    overrideLabel: cappedByTransport
      ? `Show as much as possible (${DIFF_LIMIT_ABSOLUTE_MAX_KB / KB} MB)`
      : "Show the whole diff",
    overrideKb,
    estimatedLines,
    cappedByTransport,
  };
}

/**
 * The warning the override asks the user to accept.
 *
 * It names the line count rather than the byte count, because lines are what
 * the pane pays for: every one costs about a dozen DOM nodes, and a phone
 * notices that long before it notices the megabytes.
 */
export function overrideWarning(n: DiffBudgetNotice): string[] {
  const nodes = n.estimatedLines * DOM_NODES_PER_LINE;
  const lines = [
    `This diff is about ${n.estimatedLines.toLocaleString()} lines, which the panel renders as roughly ${approx(nodes)} elements.`,
    "Building it can take a few seconds and the pane may scroll roughly afterwards. The limit in settings is unchanged; this applies to this diff only.",
  ];
  if (n.cappedByTransport) {
    lines.push(
      `The diff is larger than one request can carry, so even this shows only the first ${DIFF_LIMIT_ABSOLUTE_MAX_KB / KB} MB of it.`
    );
  }
  return lines;
}

function fmtKb(bytes: number): string {
  if (bytes >= KB * KB) return `${(bytes / (KB * KB)).toFixed(1)} MB`;
  return `${Math.round(bytes / KB)} KB`;
}

/** "26 000" rather than "262 176": the number is an estimate, so do not dress it up. */
function approx(n: number): string {
  if (n < 1000) return String(n);
  const rounded = n < 10_000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000;
  return rounded.toLocaleString();
}
