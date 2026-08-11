import { describe, expect, it } from "vitest";
import {
  MAX_PATH_CHARS,
  MAX_SEGMENT_BYTES,
  checkPathLimits,
  proposeRename,
} from "../src/git/pathLimits";

/**
 * A note committed here and unreadable everywhere else. The fixture below is
 * the shape from the user's own screenshot: a Cyrillic-and-symbols name long
 * enough that another machine's checkout dies with "Filename too long" —
 * Cyrillic is two UTF-8 bytes per character, so the 255-byte segment limit
 * arrives at half the length a Latin name would need.
 */

const CYR = "кириличнаназвадужедовга"; // 23 chars, 46 bytes
const LONG_CYR_NAME = `${CYR}${CYR}${CYR}${CYR}${CYR} — ♡◇•¥ 39374288.md`; // >230 bytes

describe("checkPathLimits", () => {
  it("passes ordinary paths, including non-ASCII ones", () => {
    expect(
      checkPathLimits(["Notes/a.md", "Приватне/Проєкти/нотатка — довга, але в межах.md"])
    ).toEqual([]);
  });

  it("catches a file segment over the byte limit, counting BYTES, not characters", () => {
    const issues = checkPathLimits([`Private/Projects/${LONG_CYR_NAME}`]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("segment-bytes");
    expect(issues[0]!.needsFolderRename).toBe(false);
    // The same number of LATIN characters is inside the byte budget.
    expect(checkPathLimits([`Private/Projects/${"a".repeat(LONG_CYR_NAME.length)}.md`])).toEqual(
      []
    );
  });

  it("blames the folder when a directory segment is the problem", () => {
    const issues = checkPathLimits([`Private/${CYR.repeat(6)}/note.md`]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.needsFolderRename).toBe(true);
  });

  it("catches a path that is fine per segment and still too long for Windows", () => {
    const deep = `${"folder/".repeat(30)}note.md`; // 217 chars, every segment short
    const issues = checkPathLimits([deep]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("path-length");
    // Renaming a 7-character file inside 210 characters of folders fixes nothing.
    expect(issues[0]!.needsFolderRename).toBe(true);
  });
});

describe("proposeRename", () => {
  it("shortens the name, keeps the folder and the extension, fits both budgets", () => {
    const from = `Private/Projects/${LONG_CYR_NAME}`;
    const to = proposeRename(from, new Set([from]));
    expect(to).not.toBeNull();
    expect(to!).toMatch(/^Private\/Projects\//);
    expect(to!).toMatch(/\.md$/);
    expect(checkPathLimits([to!])).toEqual([]);
  });

  it("keeps the shortened name unique against what is already there", () => {
    const from = `Notes/${LONG_CYR_NAME}`;
    const first = proposeRename(from, new Set([from]))!;
    const second = proposeRename(from, new Set([from, first]))!;
    expect(second).not.toBe(first);
    expect(checkPathLimits([second])).toEqual([]);
  });

  it("refuses when only a folder rename can fix the path", () => {
    expect(proposeRename(`Private/${CYR.repeat(6)}/note.md`, new Set())).toBeNull();
  });

  it("does nothing for a path that is already fine", () => {
    expect(proposeRename("Notes/a.md", new Set())).toBeNull();
  });

  it("the thresholds keep real headroom under the hard limits", () => {
    // 255 bytes is where filesystems refuse; 260 characters is Windows' whole
    // absolute path. The margins are the feature, not a rounding choice.
    expect(MAX_SEGMENT_BYTES).toBeLessThanOrEqual(220);
    expect(MAX_PATH_CHARS).toBeLessThanOrEqual(200);
  });
});
