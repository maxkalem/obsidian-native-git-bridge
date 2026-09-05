import type { GitStatusSummary } from "../types";
import { toVault, type RootOffset } from "../git/repoRoot";

/**
 * Git state as a sign beside a name in Obsidian's own file explorer.
 *
 * This module is the pure half: from the status the panel already holds, one
 * lookup table keyed by VAULT path. The controller that paints the table onto
 * the explorer's DOM is `ExplorerSignsController`; it never computes anything,
 * it only looks things up. That split is deliberate for the same reason the
 * status panel is split: the explorer holds thousands of rows on a real vault,
 * and the mark for a row has to be a map lookup, never a scan of the status.
 *
 * The keys are vault paths because that is what the explorer's rows carry
 * (`data-path`), and git's paths are repository paths: the two differ once
 * the repository root is not the vault root (ADR-003), so every path goes
 * through `toVault` on the way in and a repository file the vault cannot name
 * gets no entry — there is no row to mark.
 */

/**
 * The signs, in the order that wins when one path is in several groups. A
 * conflicted file is also listed as changed; the conflict is what the user
 * has to act on, so it is what shows. A deletion outranks a modification (a
 * file that is both is gone, whatever its content did before), staged content
 * outranks unstaged, and anything tracked outranks "untracked".
 */
export type FileSign = "conflict" | "deleted" | "added" | "modified" | "untracked";

/** What a folder shows for what lies under it: the worst thing below. */
export type FolderSign = "conflict" | "changed";

export interface ExplorerSigns {
  files: Map<string, FileSign>;
  folders: Map<string, FolderSign>;
}

const EMPTY: ExplorerSigns = { files: new Map(), folders: new Map() };

const RANK: Record<FileSign, number> = { conflict: 5, deleted: 4, added: 3, modified: 2, untracked: 1 };

function strip(path: string): string {
  return path.replace(/\/+$/, "");
}

/**
 * The letter shown for a sign. One character, because the explorer row is
 * narrow on a phone and a word would push the name out of view.
 */
export function signLetter(sign: FileSign): string {
  switch (sign) {
    case "conflict":
      return "!";
    case "deleted":
      return "D";
    case "added":
      return "A";
    case "modified":
      return "M";
    case "untracked":
      return "U";
  }
}

/** The tooltip for a sign, for devices that have one. */
export function signTitle(sign: FileSign | FolderSign): string {
  switch (sign) {
    case "conflict":
      return "Conflict";
    case "deleted":
      return "Deleted";
    case "added":
      return "Added";
    case "modified":
      return "Modified";
    case "untracked":
      return "Untracked";
    case "changed":
      return "Changes inside";
  }
}

/**
 * Build the lookup table from one status.
 *
 * `untrackedChildren` (runner v5+) is what turns git's collapsed `dir/` line
 * back into files, so a new folder marks its files and not only itself; on an
 * older runner the folder line alone is marked and its files show nothing,
 * which is the honest limit of what that runner reports.
 */
export function computeExplorerSigns(status: GitStatusSummary | undefined, offset: RootOffset): ExplorerSigns {
  if (!status) return EMPTY;
  const files = new Map<string, FileSign>();
  const put = (repoPath: string, sign: FileSign) => {
    const v = toVault(offset, strip(repoPath));
    if (v === null || v === "") return;
    const have = files.get(v);
    if (have === undefined || RANK[sign] > RANK[have]) files.set(v, sign);
  };
  for (const e of status.conflicted) put(e.path, "conflict");
  for (const e of status.staged) {
    if (e.index === "D") put(e.path, "deleted");
    else if (e.index === "A") put(e.path, "added");
    else put(e.path, "modified");
    // A staged rename lists its old name too; that file is gone from disk.
    if (e.origPath) put(e.origPath, "deleted");
  }
  for (const e of status.unstaged) {
    if (e.worktree === "D") put(e.path, "deleted");
    else put(e.path, "modified");
  }
  for (const u of status.untracked) {
    if (u.endsWith("/")) {
      const children = status.untrackedChildren?.[u];
      if (children && children.length > 0) {
        for (const c of children) put(c, "untracked");
      } else {
        // An older runner, or an empty listing: mark the folder row itself.
        const v = toVault(offset, strip(u));
        if (v !== null && v !== "") files.set(v, "untracked");
      }
    } else {
      put(u, "untracked");
    }
  }
  // Every ancestor of a marked path carries the worst sign below it. Walked
  // once per file, so the cost is the number of changed files times their
  // depth — never the size of the vault.
  const folders = new Map<string, FolderSign>();
  for (const [path, sign] of files) {
    const parts = path.split("/");
    for (let i = parts.length - 1; i >= 1; i--) {
      const folder = parts.slice(0, i).join("/");
      const want: FolderSign = sign === "conflict" ? "conflict" : "changed";
      const have = folders.get(folder);
      if (have === "conflict") continue;
      if (have === undefined || want === "conflict") folders.set(folder, want);
    }
  }
  return { files, folders };
}
