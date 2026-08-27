import type { Group } from "./StatusView";

/**
 * One description of the Git context menu, used by every surface that opens
 * one: a file row, a folder row, a group header and the file explorer. The
 * entries, their order and their visibility live here so the four callers can
 * never drift apart; the caller only maps the returned descriptors onto
 * Obsidian's Menu and supplies the handlers.
 */

export type MenuScope =
  | { kind: "file"; path: string; group: Group }
  | { kind: "folder"; path: string; group: Group; count: number }
  | { kind: "group"; group: Group; count: number }
  /**
   * A file AT ONE COMMIT — the repository-history panel's rows (0.6.7, open
   * item 10). The same file in the file-history panel offered restore and
   * view-at-commit while the repository history offered neither: same file,
   * same commit, different list, different answers — the §9 drift. `path` is
   * the path AT the commit; `code` is git's change letter, which decides
   * whether the content even exists at this commit.
   */
  | {
      kind: "file-at-commit";
      path: string;
      hash: string;
      date: string;
      subject: string;
      code: string;
    };

export interface GitMenuFlags {
  /** Settings toggles for the three config-editing families. */
  menuGitignore: boolean;
  menuSparse: boolean;
  menuExclude: boolean;
  /** Current config state of THIS path (single targets only). */
  ignored: boolean;
  sparseExcluded: boolean;
  excluded: boolean;
  /**
   * Whether the runner can serve `untrack-file` (v14+). The entry is offered
   * only when acting on it can succeed; an older runner would refuse by name.
   */
  untrack: boolean;
  /**
   * Whether the remote maps to a known web host (remoteFileUrl answered for
   * this path and commit). The copy-remote-link entry appears only then: a
   * wrong link is worse than no link.
   */
  remoteMappable?: boolean;
  /**
   * Whether the device's absolute repository path is known (the repository
   * path hint in settings), so "Copy path (from system root)" can be honest.
   */
  absolutePathAvailable?: boolean;
}

/**
 * What the menu says it is about, before it says what it can do.
 *
 * A row in the panel truncates its name to one line and the file explorer shows
 * no path at all, so a long-pressed row could offer eight destructive-sounding
 * entries without ever naming the file they would touch. `null` for a group:
 * a group has no path, and every entry already carries its own scope and count.
 */
export interface MenuHeader {
  /** Directory part, without a trailing slash. Empty at the repository root. */
  dir: string;
  /** File or folder name; a folder keeps its trailing slash. */
  name: string;
}

export function menuHeader(scope: MenuScope): MenuHeader | null {
  if (scope.kind === "group") return null;
  const isDir = scope.kind === "folder";
  const trimmed = scope.path.endsWith("/") ? scope.path.slice(0, -1) : scope.path;
  const cut = trimmed.lastIndexOf("/");
  const base = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  // An at-commit menu is about the file AT that commit; the short hash in the
  // header is what keeps "Restore the file" from reading as "restore to HEAD".
  const name = scope.kind === "file-at-commit" ? `${base} @ ${scope.hash.slice(0, 8)}` : base;
  return {
    dir: cut >= 0 ? trimmed.slice(0, cut) : "",
    name: isDir ? `${name}/` : name,
  };
}

export type MenuAction =
  | "stage"
  | "unstage"
  | "discard"
  | "resolve-local"
  | "resolve-remote"
  | "open-diff"
  | "open-conflict"
  | "open-history"
  | "open-external"
  | "copy-path"
  | "abort-merge"
  | "gitignore-add"
  | "gitignore-remove"
  | "sparse-add"
  | "sparse-remove"
  | "exclude-add"
  | "exclude-remove"
  | "untrack"
  | "open-diff-at-commit"
  | "show-at-commit"
  | "restore-after-commit"
  | "restore-before-commit"
  | "copy-remote-link"
  | "copy-path-absolute";

export interface MenuEntry {
  action: MenuAction;
  title: string;
  icon: string;
  danger?: boolean;
}

/** "" for a single path, " (12)" for a folder or group, so bulk is never a surprise. */
function suffix(scope: MenuScope): string {
  return scope.kind === "folder" || scope.kind === "group" ? ` (${scope.count})` : "";
}

function noun(scope: MenuScope): string {
  if (scope.kind === "folder") return " in folder";
  return scope.kind === "group" ? " in group" : "";
}

export function buildMenuEntries(scope: MenuScope, f: GitMenuFlags): MenuEntry[] {
  // A file at one commit answers a different question from a working-tree
  // row, so it gets its own entry set and none of the config family. The
  // entries mirror what the file-history panel's rows offer (view, restore —
  // same icons), so the two surfaces give the same answers; per-block restore
  // stays with the file-history panel, which already holds the commit's diff.
  if (scope.kind === "file-at-commit") {
    const out: MenuEntry[] = [
      { action: "open-diff-at-commit", title: "Open this commit's diff", icon: "file-diff" },
    ];
    // A file DELETED by this commit has no content at it: nothing to view,
    // nothing to restore from, and no history under the path it no longer has.
    if (scope.code !== "D") {
      out.push({ action: "show-at-commit", title: "Show the file as of this commit", icon: "eye" });
      // Two restores, because "restore from this commit" never said WHICH
      // state (the user's report): the file as this commit left it, and the
      // file as it was before the commit touched it. The BEFORE state exists
      // only when the commit modified an existing path — a file the commit
      // ADDED (or renamed into place) has nothing under this path at hash^.
      // Short titles (they truncated on the phone); the confirmation window
      // spells the exact state out before anything is written.
      out.push({
        action: "restore-after-commit",
        title: "Restore file to state after this commit",
        icon: "rotate-ccw",
        danger: true,
      });
      if (scope.code === "M" || scope.code === "T") {
        out.push({
          action: "restore-before-commit",
          title: "Restore file to state before this commit",
          icon: "rotate-ccw",
          danger: true,
        });
      }
      out.push({ action: "open-history", title: "Open file history", icon: "history" });
      if (f.remoteMappable === true) {
        // COPIED, never opened: opening needs a browser that happens to be
        // signed into the account that can see the blob, and Android's app
        // links hand github.com to whatever app claims it. A copied link
        // goes wherever the user's session already is.
        out.push({ action: "copy-remote-link", title: "Copy remote link", icon: "link" });
      }
    }
    out.push({ action: "copy-path", title: "Copy path (from Vault folder)", icon: "copy" });
    if (f.absolutePathAvailable === true) {
      out.push({ action: "copy-path-absolute", title: "Copy path (from system root)", icon: "copy" });
    }
    return out;
  }
  const out: MenuEntry[] = [];
  const single = scope.kind === "file";
  const bulk = !single;
  const n = suffix(scope);
  const where = noun(scope);
  const empty = scope.kind !== "file" && scope.count === 0;

  // 1. stage / unstage, decided by the state the panel is showing.
  if (!empty) {
    if (scope.group === "staged") {
      out.push({ action: "unstage", title: `Git: Unstage${where}${n}`, icon: "minus-circle" });
    } else if (scope.group === "unstaged" || scope.group === "untracked") {
      out.push({ action: "stage", title: `Git: Stage${where}${n}`, icon: "plus-circle" });
      // 2. discard: never offered for staged content, because "discard" there
      // would silently throw away work the user already prepared.
      out.push({
        action: "discard",
        title:
          scope.group === "untracked"
            ? `Git: Delete new file${single ? "" : "s"}${where}${n}`
            : `Git: Discard changes${where}${n}`,
        // `trash` for content git never had, `undo-2` for a revert to the
        // committed version. The same pairing the panel's buttons use.
        icon: scope.group === "untracked" ? "trash" : "undo-2",
        danger: true,
      });
    }
  }

  // 3. conflict resolution, both sides, on any scope.
  if (scope.group === "conflicted" && !empty) {
    out.push({ action: "resolve-local", title: `Git: Keep local version${where}${n}`, icon: "check", danger: true });
    out.push({ action: "resolve-remote", title: `Git: Keep remote version${where}${n}`, icon: "check-check", danger: true });
    if (scope.kind === "group") {
      out.push({ action: "abort-merge", title: "Git: Abort merge", icon: "x-circle", danger: true });
    }
  }

  // 4-6. Single files only: opening something needs one target.
  if (single) {
    if (scope.group === "conflicted") {
      out.push({ action: "open-conflict", title: "Open conflict view", icon: "alert-triangle" });
    } else {
      out.push({ action: "open-diff", title: "Open diff", icon: "file-diff" });
    }
    out.push({ action: "open-history", title: "Open file history", icon: "history" });
    out.push({ action: "open-external", title: "Open in default app", icon: "external-link" });
  }
  if (scope.kind !== "group") {
    // The two spellings Obsidian's own file manager offers (the user's ask):
    // repository-relative, and absolute on this device when the path is
    // known. The titles match the file-at-commit menu's pair verbatim — the
    // user picked that wording (2026-08-28).
    out.push({ action: "copy-path", title: "Copy path (from Vault folder)", icon: "copy" });
    if (f.absolutePathAvailable === true) {
      out.push({ action: "copy-path-absolute", title: "Copy path (from system root)", icon: "copy" });
    }
  }

  // 7-9. Config editing. On a single path the entry flips between add and
  // remove; a group can only ADD, because a mixed selection has no single
  // state to flip and silently removing rules from unrelated paths would be
  // worse than making the user do it per file.
  if (f.menuGitignore && !empty) {
    if (single && f.ignored) {
      out.push({ action: "gitignore-remove", title: "Git: Remove from .gitignore", icon: "eye" });
    } else {
      out.push({ action: "gitignore-add", title: `Git: Add to .gitignore${where}${n}`, icon: "eye-off" });
    }
  }
  if (f.menuSparse && !empty) {
    if (single && f.sparseExcluded) {
      out.push({ action: "sparse-remove", title: "Git: Show again (remove sparse exclusion)", icon: "eye" });
    } else {
      out.push({
        action: "sparse-add",
        title: `Git: Hide on this device (sparse)${where}${n}`,
        icon: "eye-off",
        danger: bulk,
      });
    }
  }
  if (f.menuExclude && !empty) {
    if (single && f.excluded) {
      out.push({ action: "exclude-remove", title: "Git: Remove from .git exclude", icon: "eye" });
    } else {
      out.push({ action: "exclude-add", title: `Git: Add to .git exclude${where}${n}`, icon: "eye-off" });
    }
  }
  // 10. Stop tracking, single tracked files only. It belongs beside the config
  // entries because it is their missing half: an ignore rule cannot hide a
  // tracked file, and this is what makes the rule able to. Same eye-off family
  // as the rules — all of them mean "make git stop seeing this".
  if (f.untrack && single && (scope.group === "staged" || scope.group === "unstaged")) {
    out.push({ action: "untrack", title: "Git: Stop tracking (keep the file)", icon: "eye-off", danger: true });
  }
  return out;
}
