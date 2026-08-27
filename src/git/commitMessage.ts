/**
 * Commit message templates (0.6.7, open item 6). `{{date}}` is the one
 * placeholder, rendered in DEVICE-LOCAL time with a moment-style format —
 * the user's decision (2026-08-26): match obsidian-git, whose default
 * template and "YYYY-MM-DD HH:mm:ss" format their vault's history already
 * carries. Local time means two devices in different zones write different
 * strings for the same moment; that is the accepted cost of matching what
 * the history already looks like.
 *
 * The formatter supports the moment tokens the format needs (YYYY, YY, MM,
 * DD, HH, mm, ss) rather than pulling in a date library: package.json
 * declares no runtime dependencies (§ hard constraints), and Obsidian's
 * bundled moment exists only at runtime, where a unit test cannot follow.
 */

export const DEFAULT_COMMIT_TEMPLATE = "Update {{date}}";
export const DEFAULT_COMMIT_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Device-local time, moment-style tokens (the subset named above). */
export function formatCommitDate(fmt: string, d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  // YYYY before YY, so the two-digit token never eats half of the four.
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/YY/g, p2(d.getFullYear() % 100))
    .replace(/MM/g, p2(d.getMonth() + 1))
    .replace(/DD/g, p2(d.getDate()))
    .replace(/HH/g, p2(d.getHours()))
    .replace(/mm/g, p2(d.getMinutes()))
    .replace(/ss/g, p2(d.getSeconds()));
}

export function renderCommitTemplate(template: string, fmt: string, now = new Date()): string {
  return template.split("{{date}}").join(formatCommitDate(fmt, now));
}

/**
 * A typed message joins the recents: newest first, duplicates lifted rather
 * than repeated, capped at `max`. Pure, so the list's shape is testable; the
 * list itself is this device's typing history and lives in localStorage,
 * never in data.json.
 */
export function pushRecentMessage(recents: string[], msg: string, max: number): string[] {
  const m = msg.trim();
  const capped = Math.max(0, max);
  if (m === "") return recents.slice(0, capped);
  return [m, ...recents.filter((r) => r !== m)].slice(0, capped);
}
