import { describe, expect, it } from "vitest";
import { ignoreEntryMatches, parseIgnoreEntries, trackedPathsAmong } from "../src/git/ignoreFile";
import type { GitStatusSummary } from "../src/types";

/**
 * `.gitignore` and `.git/info/exclude` are listed in the settings as things a
 * person can remove, one Remove button per line. Splitting on newlines and
 * dropping the blanks offered git's own preamble as two of those entries:
 *
 *     # File patterns to ignore; see `git help ignore` for more information.
 *     # Lines that start with '#' are comments.
 *
 * The panel reported twenty entries for a file with a handful of real rules,
 * and each comment came with an offer to delete it.
 */

const REAL_EXCLUDE = `# File patterns to ignore; see \`git help ignore\` for more information.
# Lines that start with '#' are comments.

.obsidian/plugins/native-git-bridge/runtime/
/.trash
/ngb-log-*.md
`;

describe("parseIgnoreEntries", () => {
  it("keeps the rules and drops git's own preamble", () => {
    expect(parseIgnoreEntries(REAL_EXCLUDE)).toEqual([
      ".obsidian/plugins/native-git-bridge/runtime/",
      "/.trash",
      "/ngb-log-*.md",
    ]);
  });

  it("drops blank lines, which are not rules either", () => {
    expect(parseIgnoreEntries("\n\n  \na.md\n\n")).toEqual(["a.md"]);
  });

  it("keeps a path that merely contains a hash", () => {
    // Only a LEADING # is a comment. `notes/c#1.md` is an ordinary file name.
    expect(parseIgnoreEntries("notes/c#1.md")).toEqual(["notes/c#1.md"]);
  });

  it("handles CRLF, since the file may have been written on another platform", () => {
    expect(parseIgnoreEntries("# c\r\na.md\r\n")).toEqual(["a.md"]);
  });

  it("says nothing about an empty file", () => {
    expect(parseIgnoreEntries("")).toEqual([]);
    expect(parseIgnoreEntries("# only a comment\n")).toEqual([]);
  });
});

describe("ignoreEntryMatches", () => {
  it("recognises the four ways git accepts the same path", () => {
    for (const written of ["Notes/x", "/Notes/x", "Notes/x/", "/Notes/x/"]) {
      expect(ignoreEntryMatches([written], "Notes/x")).toBe(true);
    }
  });

  it("does not match a different path that starts the same way", () => {
    expect(ignoreEntryMatches(["/Notes/xy"], "Notes/x")).toBe(false);
    expect(ignoreEntryMatches([], "Notes/x")).toBe(false);
  });
});

/**
 * Ignore rules affect untracked files only. `trackedPathsAmong` is what lets
 * the plugin say so at the moment a rule is added for a tracked path, instead
 * of leaving the user to conclude that the refresh "did not work" — the real
 * case was `.obsidian/workspace-mobile.json`, modified in every commit.
 */
describe("trackedPathsAmong", () => {
  const entry = (path: string, origPath?: string) => ({ path, origPath, index: "M", worktree: "." });
  const status = (partial: Partial<GitStatusSummary>): GitStatusSummary => ({
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ...partial,
  });

  it("reports a path from any tracked group: staged, unstaged, conflicted", () => {
    const st = status({
      staged: [entry("a.md")],
      unstaged: [entry(".obsidian/workspace-mobile.json")],
      conflicted: [entry("c.md")],
    });
    expect(trackedPathsAmong(st, [".obsidian/workspace-mobile.json"])).toEqual([
      ".obsidian/workspace-mobile.json",
    ]);
    expect(trackedPathsAmong(st, ["a.md", "c.md", "new.md"])).toEqual(["a.md", "c.md"]);
  });

  it("does not report an untracked path: the rule WILL hide that one", () => {
    const st = status({ untracked: ["new.md"] });
    expect(trackedPathsAmong(st, ["new.md"])).toEqual([]);
  });

  it("recognises both sides of a rename", () => {
    const st = status({ staged: [entry("new-name.md", "old-name.md")] });
    expect(trackedPathsAmong(st, ["old-name.md"])).toEqual(["old-name.md"]);
    expect(trackedPathsAmong(st, ["new-name.md"])).toEqual(["new-name.md"]);
  });

  it("answers nothing for a path git has not mentioned at all", () => {
    expect(trackedPathsAmong(status({}), ["quiet.md"])).toEqual([]);
  });
});
