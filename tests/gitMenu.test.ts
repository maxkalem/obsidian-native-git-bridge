import { describe, expect, it } from "vitest";
import { buildMenuEntries, type GitMenuFlags, type MenuScope } from "../src/ui/gitMenu";

const allOn: GitMenuFlags = {
  menuGitignore: true,
  menuSparse: true,
  menuExclude: true,
  ignored: false,
  sparseExcluded: false,
  excluded: false,
  untrack: true,
};
const actions = (s: MenuScope, f: Partial<GitMenuFlags> = {}) =>
  buildMenuEntries(s, { ...allOn, ...f }).map((e) => e.action);

describe("git context menu, one description for every surface", () => {
  it("a staged file offers unstage, never stage or discard", () => {
    const a = actions({ kind: "file", path: "a.md", group: "staged" });
    expect(a).toContain("unstage");
    expect(a).not.toContain("stage");
    expect(a).not.toContain("discard");
  });

  it("an unstaged file offers stage and discard", () => {
    const a = actions({ kind: "file", path: "a.md", group: "unstaged" });
    expect(a.slice(0, 2)).toEqual(["stage", "discard"]);
  });

  it("an untracked file offers deletion rather than a discard of tracked content", () => {
    const e = buildMenuEntries({ kind: "file", path: "a.md", group: "untracked" }, allOn);
    expect(e.find((x) => x.action === "discard")!.title).toMatch(/Delete new file/);
  });

  it("conflicts offer both sides, and the group also offers abort", () => {
    const file = actions({ kind: "file", path: "a.md", group: "conflicted" });
    expect(file).toContain("resolve-local");
    expect(file).toContain("resolve-remote");
    expect(file).toContain("open-conflict");
    expect(file).not.toContain("open-diff");
    expect(file).not.toContain("abort-merge");
    const group = actions({ kind: "group", group: "conflicted", count: 3 });
    expect(group).toContain("abort-merge");
  });

  it("a file at a commit answers the file-history panel's questions, and no working-tree ones", () => {
    // Open item 10: a repo-history row offered two things while the same file
    // in the file-history panel offered restore and view-at-commit — same
    // file, same commit, different answers.
    const at = (code: string): MenuScope => ({
      kind: "file-at-commit",
      path: "Notes/a.md",
      hash: "0123abcd4567",
      date: "2026-08-26T10:00:00Z",
      subject: "a subject",
      code,
    });
    const a = actions(at("M"));
    expect(a).toEqual([
      "open-diff-at-commit",
      "show-at-commit",
      "restore-from-commit",
      "open-history",
      "copy-path",
    ]);
    // None of the working-tree families leak in: staging, discard, config
    // rules — a commit is not a working-tree state.
    for (const x of ["stage", "discard", "gitignore-add", "sparse-add", "exclude-add", "untrack"]) {
      expect(a).not.toContain(x);
    }
    // The restore route is marked destructive, like every discard.
    const entries = buildMenuEntries(at("M"), allOn);
    expect(entries.find((e) => e.action === "restore-from-commit")!.danger).toBe(true);
  });

  it("open-on-remote appears only when the remote actually maps to a web host", () => {
    const at: MenuScope = {
      kind: "file-at-commit",
      path: "Notes/a.md",
      hash: "0123abcd4567",
      date: "2026-08-26T10:00:00Z",
      subject: "a subject",
      code: "M",
    };
    expect(actions(at)).not.toContain("open-remote"); // flag absent = unmappable
    expect(actions(at, { remoteMappable: true })).toContain("open-remote");
  });

  it("a file DELETED by the commit has no content there: only the diff and the path", () => {
    const a = actions({
      kind: "file-at-commit",
      path: "Notes/gone.md",
      hash: "0123abcd4567",
      date: "2026-08-26T10:00:00Z",
      subject: "delete it",
      code: "D",
    });
    expect(a).toEqual(["open-diff-at-commit", "copy-path"]);
  });

  it("opening things is offered for single files only", () => {
    for (const a of [
      actions({ kind: "folder", path: "d", group: "unstaged", count: 4 }),
      actions({ kind: "group", group: "unstaged", count: 4 }),
    ]) {
      expect(a).not.toContain("open-diff");
      expect(a).not.toContain("open-history");
      expect(a).not.toContain("open-external");
    }
    const file = actions({ kind: "file", path: "a.md", group: "unstaged" });
    expect(file).toContain("open-diff");
    expect(file).toContain("open-history");
    expect(file).toContain("open-external");
  });

  it("config entries follow the settings toggles", () => {
    const off = actions({ kind: "file", path: "a.md", group: "unstaged" }, {
      menuGitignore: false,
      menuSparse: false,
      menuExclude: false,
    });
    expect(off.some((a) => a.startsWith("gitignore"))).toBe(false);
    expect(off.some((a) => a.startsWith("sparse"))).toBe(false);
    expect(off.some((a) => a.startsWith("exclude"))).toBe(false);
  });

  it("config entries flip with the current state of a single path", () => {
    const a = actions({ kind: "file", path: "a.md", group: "unstaged" }, {
      ignored: true,
      sparseExcluded: true,
      excluded: true,
    });
    expect(a).toContain("gitignore-remove");
    expect(a).toContain("sparse-remove");
    expect(a).toContain("exclude-remove");
    expect(a).not.toContain("gitignore-add");
  });

  it("a group can only ADD config rules, never remove them in bulk", () => {
    const a = actions({ kind: "group", group: "unstaged", count: 7 }, {
      ignored: true,
      sparseExcluded: true,
      excluded: true,
    });
    expect(a).toContain("gitignore-add");
    expect(a).toContain("sparse-add");
    expect(a).toContain("exclude-add");
    expect(a).not.toContain("gitignore-remove");
  });

  it("bulk titles carry the count so nothing happens by surprise", () => {
    const e = buildMenuEntries({ kind: "group", group: "unstaged", count: 12 }, allOn);
    expect(e.find((x) => x.action === "stage")!.title).toBe("Git: Stage in group (12)");
    const folder = buildMenuEntries({ kind: "folder", path: "d", group: "staged", count: 3 }, allOn);
    expect(folder.find((x) => x.action === "unstage")!.title).toBe("Git: Unstage in folder (3)");
  });

  it("an empty group offers nothing that would act on files", () => {
    const a = actions({ kind: "group", group: "unstaged", count: 0 });
    expect(a).toEqual([]);
  });

  it("keeps the documented order", () => {
    const a = actions({ kind: "file", path: "a.md", group: "unstaged" });
    expect(a).toEqual([
      "stage",
      "discard",
      "open-diff",
      "open-history",
      "open-external",
      "copy-path",
      "gitignore-add",
      "sparse-add",
      "exclude-add",
      "untrack",
    ]);
  });

  it("untrack is offered for single TRACKED files only, and only when the runner can serve it", () => {
    // Tracked groups: offered.
    expect(actions({ kind: "file", path: "a.md", group: "unstaged" })).toContain("untrack");
    expect(actions({ kind: "file", path: "a.md", group: "staged" })).toContain("untrack");
    // Untracked: there is nothing to untrack, an ignore rule already works.
    expect(actions({ kind: "file", path: "a.md", group: "untracked" })).not.toContain("untrack");
    // Bulk: never — the modify/delete consequence on other devices is per file.
    expect(actions({ kind: "folder", path: "d", group: "unstaged", count: 3 })).not.toContain("untrack");
    expect(actions({ kind: "group", group: "unstaged", count: 3 })).not.toContain("untrack");
    // Runner older than v14: the entry would only ever produce a refusal.
    expect(actions({ kind: "file", path: "a.md", group: "unstaged" }, { untrack: false })).not.toContain("untrack");
  });
});
