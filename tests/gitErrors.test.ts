import { describe, expect, it } from "vitest";
import {
  looksLikeObjectCorruption,
  looksLikeStaleLock,
  needsTermuxCredentials,
  summarizeGitError,
} from "../src/git/gitErrors";

/**
 * A failed sync said "git pull failed during sync." and put the reason behind a
 * collapsed `stderr`. On a repository of this size that block opens with the
 * reason and then buries it under two hundred lines of
 * `Updating index flags: 67% (4590/6783)` — and because progress is written
 * with carriage returns, it arrives as one enormous line that scrolling cannot
 * make readable. The user could not tell why the sync had failed.
 */

const REAL = `error: Your local changes to the following files would be overwritten by merge:
\t.obsidian/community-plugins.json
Please commit your changes or stash them before you merge.
Aborting
Updating index flags:  67% (4590/6783)\rUpdating index flags:  68% (4613/6783)\rUpdating index flags:  69% (4681/6783)\rUpdating index flags: 100% (6783/6783)\r`;

describe("summarizeGitError", () => {
  it("leads with the reason and the advice, which is what was hidden", () => {
    const out = summarizeGitError(REAL);
    expect(out[0]).toContain("would be overwritten by merge");
    expect(out).toContain("\t.obsidian/community-plugins.json");
    expect(out.some((l) => l.includes("commit your changes or stash them"))).toBe(true);
  });

  it("drops every line of progress", () => {
    const out = summarizeGitError(REAL);
    expect(out.join("\n")).not.toContain("Updating index flags");
    expect(out.join("\n")).not.toContain("%");
  });

  it("splits on carriage returns, or the progress is one unfilterable line", () => {
    const out = summarizeGitError("Counting objects: 10%\rCounting objects: 90%\rfatal: bad thing");
    expect(out).toEqual(["fatal: bad thing"]);
  });

  it("drops the noise git writes with no message of its own", () => {
    for (const noise of [
      "Receiving objects:  50% (5/10)",
      "remote: Compressing objects: 100% (3/3)",
      "Resolving deltas: 100% (1/1)",
      "  ",
      "37% (12/32)",
    ]) {
      expect(summarizeGitError(noise)).toEqual([]);
    }
  });

  it("says nothing when git said nothing", () => {
    expect(summarizeGitError(undefined, undefined)).toEqual([]);
    expect(summarizeGitError("", "")).toEqual([]);
  });

  it("keeps stdout too, because git puts the reason in either one", () => {
    expect(summarizeGitError("", "Already up to date.")).toEqual(["Already up to date."]);
  });

  it("stops at the limit: this is the summary, the rest is under the fold", () => {
    const many = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    expect(summarizeGitError(many)).toHaveLength(6);
    expect(summarizeGitError(many, "", 2)).toEqual(["line 0", "line 1"]);
  });

  it("does not repeat a line git repeated", () => {
    expect(summarizeGitError("fatal: x\nfatal: x\nfatal: y")).toEqual(["fatal: x", "fatal: y"]);
  });
});

/**
 * A damaged object database announces itself through whichever operation
 * happened to walk into it, so the message never mentions the real cause. This
 * is what it looked like on the device, in the middle of a sync:
 *
 *     error: object file .git/objects/2d/9ebf…af7 is empty
 *     fatal: unable to read tree (2d9ebf…)
 *
 * A zero-byte object file is what git leaves when it was stopped between
 * creating the file and writing to it — routine on Android, where the system
 * stops Termux in the background.
 */
describe("looksLikeObjectCorruption", () => {
  it("recognises the empty object file, whatever operation reported it", () => {
    expect(
      looksLikeObjectCorruption(
        "error: object file .git/objects/2d/9ebf5bcd0b5beda5a893c098db9075884b6af7 is empty\n" +
          "fatal: unable to read tree (2d9ebf5bcd0b5beda5a893c098db9075884b6af7)"
      )
    ).toBe(true);
  });

  it("recognises the other shapes git uses for the same fault", () => {
    expect(looksLikeObjectCorruption("error: loose object 2d9ebf5 is corrupt")).toBe(true);
    expect(looksLikeObjectCorruption("fatal: unable to read sha1 file of Notes/a.md")).toBe(true);
    expect(looksLikeObjectCorruption("error: garbage at end of loose object")).toBe(true);
  });

  it("does not cry corruption over an ordinary failure", () => {
    // Every one of these is a normal day. Offering to repair the repository
    // here would teach the user to distrust the offer when it matters.
    for (const s of [
      "error: Your local changes to the following files would be overwritten by merge:",
      "fatal: Authentication failed for 'https://github.com/x/y.git/'",
      "error: failed to push some refs to 'origin'",
      "CONFLICT (content): Merge conflict in Notes/a.md",
      "",
    ]) {
      expect(looksLikeObjectCorruption(s)).toBe(false);
    }
  });

  it("looks at stdout too", () => {
    expect(looksLikeObjectCorruption("", "fatal: unable to read object")).toBe(true);
  });
});

describe("needsTermuxCredentials", () => {
  it("recognises every shape of 'git wanted credentials and could not ask'", () => {
    // The first two are exactly what the device produced (18:03 bundle of the
    // after-0.6.3 session, and the 0.6.5 mirror recovery before it).
    for (const s of [
      "fatal: could not read Password for 'https://github.com': terminal prompts disabled",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "fatal: Authentication failed for 'https://github.com/x/y.git/'",
      "Host key verification failed.",
    ]) {
      expect(needsTermuxCredentials(s), s).toBe(true);
    }
  });

  it("stays quiet where a terminal prompt would not be the fix", () => {
    for (const s of [
      "git@github.com: Permission denied (publickey).", // a missing key, not a missing answer
      "error: Your local changes to the following files would be overwritten by merge:",
      "fatal: unable to read tree (2d9ebf5bcd0b5beda5a893c098db9075884b6af7)",
      "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
      "",
    ]) {
      expect(needsTermuxCredentials(s), s).toBe(false);
    }
  });

  it("looks at stdout too", () => {
    expect(needsTermuxCredentials("", "fatal: Authentication failed for 'https://h/r.git/'")).toBe(true);
  });
});

describe("looksLikeStaleLock", () => {
  it("recognises the two lines a leftover index.lock produces", () => {
    // Verbatim from a real device (the 00:34 bundle's reset-all).
    expect(
      looksLikeStaleLock(
        "fatal: Unable to create '/storage/emulated/0/Documents/Kalem/.git/index.lock': File exists.\n\n" +
          "Another git process seems to be running in this repository, or the lock file may be stale"
      )
    ).toBe(true);
    expect(looksLikeStaleLock("Another git process seems to be running in this repository")).toBe(true);
  });

  it("stays quiet on ordinary failures", () => {
    for (const s of [
      "error: Your local changes to the following files would be overwritten by merge:",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "fatal: unable to read tree (2d9ebf5bcd0b5beda5a893c098db9075884b6af7)",
      "",
    ]) {
      expect(looksLikeStaleLock(s), s).toBe(false);
    }
  });
});
