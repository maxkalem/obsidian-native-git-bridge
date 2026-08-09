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
  | { kind: "group"; group: Group; count: number };

export interface GitMenuFlags {
  /** Settings toggles for the three config-editing families. */
  menuGitignore: boolean;
  menuSparse: boolean;
  menuExclude: boolean;
  /** Current config state of THIS path (single targets only). */
  ignored: boolean;
  sparseExcluded: boolean;
  excluded: boolean;
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
  | "exclude-remove";

export interface MenuEntry {
  action: MenuAction;
  title: string;
  icon: string;
  danger?: boolean;
}

/** "" for a single path, " (12)" for a folder or group, so bulk is never a surprise. */
function suffix(scope: MenuScope): string {
  return scope.kind === "file" ? "" : ` (${scope.count})`;
}

function noun(scope: MenuScope): string {
  if (scope.kind === "file") return "";
  return scope.kind === "folder" ? " in folder" : " in group";
}

export function buildMenuEntries(scope: MenuScope, f: GitMenuFlags): MenuEntry[] {
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
    out.push({ action: "copy-path", title: "Copy path", icon: "copy" });
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
  return out;
}
