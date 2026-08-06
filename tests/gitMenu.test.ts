import { describe, expect, it } from "vitest";
import { buildMenuEntries, type GitMenuFlags, type MenuScope } from "../src/ui/gitMenu";

const allOn: GitMenuFlags = {
  menuGitignore: true,
  menuSparse: true,
  menuExclude: true,
  ignored: false,
  sparseExcluded: false,
  excluded: false,
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
    ]);
  });
});
