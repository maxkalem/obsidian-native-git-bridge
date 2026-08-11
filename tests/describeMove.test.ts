import { describe, expect, it } from "vitest";
import { describeMove } from "../src/ui/revealOnTap";
import { menuHeader } from "../src/ui/gitMenu";

/**
 * A move, told as a move.
 *
 * The rename hint used to reveal one string with an arrow inside it, which put
 * two nearly identical paths on one line and hid the part that actually
 * changed. Three lines — where it was, an arrow, where it is now — put the
 * difference where the eye lands. And when only the name changed, the directory
 * is stated once instead of twice: repeating an identical path is the same
 * failure in a different direction.
 */
describe("describeMove", () => {
  it("puts the arrow on a line of its own", () => {
    expect(describeMove("a/old.md", "b/new.md")).toEqual(["a/old.md", "↓", "b/new.md"]);
  });

  it("states the directory once when only the name changed", () => {
    expect(describeMove("Notes/Deep/old.md", "Notes/Deep/new.md")).toEqual([
      "Notes/Deep/",
      "old.md",
      "↓",
      "new.md",
    ]);
  });

  it("omits the directory line entirely at the repository root", () => {
    expect(describeMove("old.md", "new.md")).toEqual(["old.md", "↓", "new.md"]);
  });

  it("treats a move between directories as a move even when the name is kept", () => {
    expect(describeMove("a/note.md", "b/note.md")).toEqual(["a/note.md", "↓", "b/note.md"]);
  });

  /**
   * Git reports a delete-to-trash as a rename, because on disk that is what it
   * is. It is not what the user did, and reading it as a rename is how somebody
   * goes looking for a file they believe they moved.
   */
  it("calls a move into Obsidian's trash a deletion", () => {
    expect(describeMove("Private/Inbox/x.jpg", ".trash/x.jpg")).toEqual([
      "Private/Inbox/x.jpg",
      "↓ deleted, into Obsidian's trash",
      ".trash/x.jpg",
    ]);
  });

  it("does not mistake a folder that merely starts with the same letters", () => {
    const out = describeMove("a/x.md", ".trashcan/x.md");
    expect(out[1]).toBe("↓");
  });

  it("still names the trash when the file came from the vault root", () => {
    // The same-directory shortcut must not swallow this one: the directories
    // differ, and the destination is what matters.
    expect(describeMove("x.jpg", ".trash/x.jpg")[1]).toContain("trash");
  });
});

describe("menuHeader", () => {
  it("splits a path into the directory and the name", () => {
    expect(menuHeader({ kind: "file", path: "Notes/Deep/a.md", group: "unstaged" })).toEqual({
      dir: "Notes/Deep",
      name: "a.md",
    });
  });

  it("leaves the directory empty at the repository root", () => {
    expect(menuHeader({ kind: "file", path: "a.md", group: "unstaged" })).toEqual({
      dir: "",
      name: "a.md",
    });
  });

  it("keeps a folder's trailing slash, so a folder cannot read as a file", () => {
    expect(menuHeader({ kind: "folder", path: "Notes/Deep/", group: "staged", count: 3 })).toEqual({
      dir: "Notes",
      name: "Deep/",
    });
  });

  it("has nothing to say about a group, which has no path", () => {
    expect(menuHeader({ kind: "group", group: "untracked", count: 12 })).toBeNull();
  });
});
