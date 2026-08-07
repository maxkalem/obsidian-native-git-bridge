import { describe, expect, it } from "vitest";
import { hunkActionsFor, supportsLineSelection } from "../src/git/hunkActions";

/**
 * The rule is short but easy to get backwards, and getting it backwards means
 * offering "discard" on a staged diff, where the reversed patch would come out
 * of the working tree instead.
 */
describe("hunkActionsFor", () => {
  it("the staged side offers unstage only", () => {
    const a = hunkActionsFor("HEAD", "INDEX");
    expect(a.map((x) => x.action)).toEqual(["unstage"]);
    expect(a[0]).toMatchObject({ target: "index", reverse: true, destructive: false });
  });

  it("the unstaged side offers stage and discard, in that order", () => {
    const a = hunkActionsFor("INDEX", "WORKTREE");
    expect(a.map((x) => x.action)).toEqual(["stage", "discard"]);
  });

  it("stage puts the patch into the index, forward", () => {
    const [stage] = hunkActionsFor("INDEX", "WORKTREE");
    expect(stage).toMatchObject({ target: "index", reverse: false, destructive: false });
  });

  // The one action that removes work. Everything else moves a change between
  // the index and the file, and can be undone by the opposite action.
  it("discard is the only destructive one, and it targets the working tree", () => {
    const [, discard] = hunkActionsFor("INDEX", "WORKTREE");
    expect(discard).toMatchObject({ target: "worktree", reverse: true, destructive: true });
    const all = [...hunkActionsFor("HEAD", "INDEX"), ...hunkActionsFor("INDEX", "WORKTREE")];
    expect(all.filter((a) => a.destructive).map((a) => a.action)).toEqual(["discard"]);
  });

  it("a history diff offers nothing", () => {
    expect(hunkActionsFor("a1b2c3d4^", "a1b2c3d4")).toEqual([]);
    expect(hunkActionsFor("a1b2c3d4", "WORKTREE")).toEqual([]);
    expect(hunkActionsFor("HEAD", "WORKTREE")).toEqual([]);
  });

  it("every action carries both a whole-hunk and a selected-lines label", () => {
    for (const a of [...hunkActionsFor("HEAD", "INDEX"), ...hunkActionsFor("INDEX", "WORKTREE")]) {
      expect(a.label).toMatch(/hunk$/);
      expect(a.selectedLabel).toMatch(/selected$/);
    }
  });
});

describe("supportsLineSelection", () => {
  it("follows whatever the actions say", () => {
    expect(supportsLineSelection("INDEX", "WORKTREE")).toBe(true);
    expect(supportsLineSelection("HEAD", "INDEX")).toBe(true);
    expect(supportsLineSelection("a1b2c3d4^", "a1b2c3d4")).toBe(false);
  });
});
