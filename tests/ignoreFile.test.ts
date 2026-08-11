import { describe, expect, it } from "vitest";
import { ignoreEntryMatches, parseIgnoreEntries } from "../src/git/ignoreFile";

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
