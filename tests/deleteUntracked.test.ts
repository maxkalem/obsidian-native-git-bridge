import { describe, expect, it } from "vitest";
import { untrackedTargets } from "../src/git/untrackedTargets";

/**
 * Which untracked entries a delete at a given scope will touch.
 *
 * The list matters twice: it is what the confirmation shows the user, and it is
 * what the deletion then iterates. Git reports a fully untracked directory as
 * one `dir/` entry rather than as its contents, and that shape has to survive
 * into both, or a confirmation promising "1 entry" deletes two thousand files
 * one request at a time.
 *
 * Scope matching is by path SEGMENT. `Private/!inbox/1` must not pull in
 * `Private/!inbox/10/`, which a plain `startsWith` does.
 */

const UNTRACKED = [
  "Private/!inbox/1/",
  "Private/!inbox/10/",
  "Private/note.md",
  "Private/notes/deep/a.md",
  "top.md",
];

describe("untrackedTargets", () => {
  it("takes everything for the whole group", () => {
    expect(untrackedTargets(UNTRACKED, null)).toEqual(UNTRACKED);
  });

  it("matches a directory entry git collapsed, without expanding it", () => {
    expect(untrackedTargets(UNTRACKED, "Private/!inbox/1")).toEqual(["Private/!inbox/1/"]);
    expect(untrackedTargets(UNTRACKED, "Private/!inbox/1/")).toEqual(["Private/!inbox/1/"]);
  });

  it("does not let a name that merely starts the same come along", () => {
    // "Private/!inbox/1" against "Private/!inbox/10/" is the trap.
    expect(untrackedTargets(UNTRACKED, "Private/!inbox/1")).not.toContain("Private/!inbox/10/");
  });

  it("matches a single file exactly", () => {
    expect(untrackedTargets(UNTRACKED, "Private/note.md")).toEqual(["Private/note.md"]);
  });

  it("takes everything under a parent folder", () => {
    expect(untrackedTargets(UNTRACKED, "Private")).toEqual([
      "Private/!inbox/1/",
      "Private/!inbox/10/",
      "Private/note.md",
      "Private/notes/deep/a.md",
    ]);
  });

  it("deletes just the one file when the scope is inside a collapsed directory", () => {
    // git reports "Private/!inbox/1/" and nothing about the 2415 files in it;
    // the panel lists them from `untrackedChildren`. Tapping the delete on one
    // of those rows used to find no target and do nothing.
    expect(untrackedTargets(UNTRACKED, "Private/!inbox/1/000824E8.md")).toEqual([
      "Private/!inbox/1/000824E8.md",
    ]);
    expect(untrackedTargets(UNTRACKED, "Private/!inbox/1/sub/deeper.md")).toEqual([
      "Private/!inbox/1/sub/deeper.md",
    ]);
  });

  it("still prefers the collapsed entry when the scope IS the directory", () => {
    // The single file above must not turn the folder scope into a self-match.
    expect(untrackedTargets(UNTRACKED, "Private/!inbox/1")).toEqual(["Private/!inbox/1/"]);
  });

  it("returns nothing for a path git did not report as untracked", () => {
    expect(untrackedTargets(UNTRACKED, "Tracked/file.md")).toEqual([]);
    expect(untrackedTargets(UNTRACKED, "top.md.bak")).toEqual([]);
  });

  it("treats the repository root as the whole list", () => {
    expect(untrackedTargets(UNTRACKED, ".")).toEqual(UNTRACKED);
    expect(untrackedTargets(UNTRACKED, "")).toEqual(UNTRACKED);
  });
});
