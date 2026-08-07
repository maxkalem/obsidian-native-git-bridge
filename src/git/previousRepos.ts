/**
 * Repositories that were put aside when a vault was re-cloned.
 *
 * Re-cloning never deletes the repository it replaces: it may hold commits
 * that exist nowhere else, and a lost commit is the kind of loss nobody
 * notices for weeks. The old `.git` is renamed into the runtime folder and the
 * runner writes a small manifest next to it, so the plugin can describe it —
 * size, commits, branch, last commit — without walking a large directory.
 *
 * The cost of that safety is disk: a vault with thousands of files can leave
 * hundreds of megabytes sitting there, invisible, for as long as the user
 * forgets about it. Hence the reminder, and hence this module: parsing and
 * deciding are pure, so both are testable without a vault.
 */

export interface PreviousRepo {
  /** Directory name inside the runtime folder, e.g. `previous-git-20260807T101500Z`. */
  dir: string;
  createdAt: string;
  sizeKb: number;
  commits: number;
  branch: string;
  /** `<short hash> <date> <subject>`, as the runner recorded it. */
  lastCommit: string;
}

export const PREVIOUS_GIT_PREFIX = "previous-git-";
/** `previous-git-20260807T101500Z` and nothing else: it becomes a delete target. */
const DIR_RE = /^previous-git-\d{8}T\d{6}Z$/;

export function isPreviousRepoDir(name: string): boolean {
  return DIR_RE.test(name);
}

/** Parse a manifest written by the runner; null when it is not one. */
export function parsePreviousRepo(text: string): PreviousRepo | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.dir !== "string" || !isPreviousRepoDir(r.dir)) return null;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    dir: r.dir,
    createdAt: str(r.createdAt),
    sizeKb: num(r.sizeKb),
    commits: num(r.commits),
    branch: str(r.branch),
    lastCommit: str(r.lastCommit),
  };
}

/** Human size, because "188416 KB" means nothing on a phone screen. */
export function formatSize(sizeKb: number): string {
  if (sizeKb <= 0) return "unknown size";
  if (sizeKb < 1024) return `${sizeKb} KB`;
  const mb = sizeKb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** One line describing a stashed repository, for the reminder and the settings. */
export function describePreviousRepo(r: PreviousRepo, now: Date = new Date()): string {
  const parts = [formatSize(r.sizeKb)];
  if (r.commits > 0) parts.push(`${r.commits} commit${r.commits === 1 ? "" : "s"}`);
  if (r.branch) parts.push(r.branch);
  const days = daysSince(r.createdAt, now);
  if (days !== null) parts.push(days === 0 ? "set aside today" : `set aside ${days} day${days === 1 ? "" : "s"} ago`);
  return parts.join(" · ");
}

export function daysSince(iso: string, now: Date = new Date()): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export interface ReminderState {
  /** Epoch ms of the last reminder shown on this device. */
  lastRemindedAt: number;
  /** Directories the user asked not to be reminded about again. */
  dismissed: readonly string[];
}

export const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Which stashed repositories to mention now. At most once a day, never about
 * one the user has already waved away, and never at all when there is nothing
 * to say — a reminder that fires on every start is one that gets ignored.
 */
export function reposToRemindAbout(
  repos: readonly PreviousRepo[],
  state: ReminderState,
  now: number = Date.now()
): PreviousRepo[] {
  if (now - state.lastRemindedAt < REMIND_INTERVAL_MS) return [];
  return repos.filter((r) => !state.dismissed.includes(r.dir));
}
