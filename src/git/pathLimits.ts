/**
 * Filename limits that another machine will enforce even though this one does
 * not.
 *
 * A note created on Android can carry a name of any length Obsidian accepts,
 * commit cleanly, push cleanly — and then break every other clone: checkout on
 * the other machine fails with "Filename too long" (Windows' 260-character
 * path limit, counted from the drive letter through the clone location this
 * side cannot know) or "File name too long" (the 255-BYTE per-segment limit of
 * most filesystems, which Cyrillic reaches at ~127 characters and emoji at
 * ~63). The commit is the last moment this side can still fix it, so the
 * check runs before sync and commit, and the fix is a rename Obsidian itself
 * performs so links keep working.
 *
 * The thresholds are deliberately under the hard limits: the hard limits are
 * someone else's, measured from a clone location this vault cannot see, so
 * headroom is the whole point.
 */

/** Per-segment budget in UTF-8 bytes; filesystems refuse at 255. */
export const MAX_SEGMENT_BYTES = 200;
/**
 * Whole repo-relative path budget in characters. Windows refuses at 260 for
 * the ABSOLUTE path; 180 leaves ~80 for `C:\Users\<name>\…\<vault>\`.
 */
export const MAX_PATH_CHARS = 180;

export interface PathLimitIssue {
  path: string;
  /**
   * `segment-bytes`: one path component alone is over the filesystem limit.
   * `path-length`: the components are fine but the whole path is too long for
   * a Windows checkout.
   */
  reason: "segment-bytes" | "path-length";
  /** True when renaming the FILE cannot fix it (a directory is the problem). */
  needsFolderRename: boolean;
}

const utf8 = new TextEncoder();

function segmentBytes(segment: string): number {
  return utf8.encode(segment).length;
}

/** The paths another clone would refuse, out of the ones about to be committed. */
export function checkPathLimits(paths: readonly string[]): PathLimitIssue[] {
  const out: PathLimitIssue[] = [];
  for (const path of paths) {
    const segments = path.split("/");
    const name = segments[segments.length - 1] ?? "";
    const dirTooLong = segments.slice(0, -1).some((s) => segmentBytes(s) > MAX_SEGMENT_BYTES);
    if (dirTooLong || segmentBytes(name) > MAX_SEGMENT_BYTES) {
      out.push({ path, reason: "segment-bytes", needsFolderRename: dirTooLong });
      continue;
    }
    if (path.length > MAX_PATH_CHARS) {
      // Renaming the file only helps while the directories leave it room.
      const dirLen = path.length - name.length;
      out.push({ path, reason: "path-length", needsFolderRename: dirLen > MAX_PATH_CHARS - 12 });
    }
  }
  return out;
}

/** Longest prefix of `s` whose UTF-8 form fits `maxBytes`, cut between code points. */
function truncateToBytes(s: string, maxBytes: number): string {
  let bytes = 0;
  let out = "";
  for (const ch of s) {
    const b = utf8.encode(ch).length;
    if (bytes + b > maxBytes) break;
    bytes += b;
    out += ch;
  }
  return out;
}

/**
 * A shorter name for the same file: the extension survives, the name is cut to
 * fit both budgets, and `taken` (plus a numeric suffix) keeps it unique. Null
 * when renaming the file cannot fix the path — the caller then names the
 * folder instead of pretending.
 */
export function proposeRename(path: string, taken: ReadonlySet<string>): string | null {
  const issue = checkPathLimits([path])[0];
  if (issue === undefined) return null;
  if (issue.needsFolderRename) return null;
  const cut = path.lastIndexOf("/");
  const dir = cut >= 0 ? path.slice(0, cut + 1) : "";
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;

  // Room for a collision suffix (" 99") inside both budgets, so a suffixed
  // candidate cannot itself be over the limit it exists to satisfy.
  const byteBudget = MAX_SEGMENT_BYTES - segmentBytes(ext) - 3;
  const charBudget = Math.max(8, MAX_PATH_CHARS - dir.length - ext.length - 3);
  let base = truncateToBytes(stem, byteBudget).slice(0, charBudget).trimEnd();
  if (base === "") base = "untitled";

  let candidate = `${dir}${base}${ext}`;
  for (let n = 2; taken.has(candidate) || candidate === path; n++) {
    candidate = `${dir}${base} ${n}${ext}`;
    if (n > 99) return null;
  }
  return candidate;
}
