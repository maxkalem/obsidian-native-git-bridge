import { describe, expect, it } from "vitest";
import { parseHunks, restoreHunk } from "../src/git/hunks";

const DIFF = [
  "diff --git a/n.md b/n.md",
  "index 111..222 100644",
  "--- a/n.md",
  "+++ b/n.md",
  "@@ -1,3 +1,3 @@",
  " intro",
  "-old line",
  "+new line",
  " tail",
  "@@ -10,2 +10,3 @@",
  " keep",
  "+extra",
].join("\n");

describe("parseHunks", () => {
  it("splits a file diff into hunks with both sides", () => {
    const h = parseHunks(DIFF);
    expect(h).toHaveLength(2);
    expect(h[0]!.header).toBe("@@ -1,3 +1,3 @@");
    expect(h[0]!.before).toEqual(["intro", "old line", "tail"]);
    expect(h[0]!.after).toEqual(["intro", "new line", "tail"]);
    expect(h[1]!.before).toEqual(["keep"]);
    expect(h[1]!.after).toEqual(["keep", "extra"]);
  });

  it("ignores file headers and returns nothing for an empty diff", () => {
    expect(parseHunks("")).toEqual([]);
    expect(parseHunks("diff --git a/x b/x\n--- a/x\n+++ b/x\n")).toEqual([]);
  });
});

describe("restoreHunk", () => {
  const hunk = parseHunks(DIFF)[0]!;

  it("replaces the pre-commit block with the committed version", () => {
    const current = "header\nintro\nold line\ntail\nfooter";
    const r = restoreHunk(current, hunk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBe(true);
      expect(r.text).toBe("header\nintro\nnew line\ntail\nfooter");
    }
  });

  it("reports no change when the block already matches the commit", () => {
    const current = "intro\nnew line\ntail";
    const r = restoreHunk(current, hunk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBe(false);
      expect(r.text).toBe(current);
    }
  });

  it("refuses when the block drifted instead of guessing where it belongs", () => {
    const current = "intro\nsomething else entirely\ntail";
    expect(restoreHunk(current, hunk)).toEqual({ ok: false, reason: "not-found" });
  });

  it("touches only the first matching block and leaves the rest alone", () => {
    const current = "intro\nold line\ntail\n---\nintro\nold line\ntail";
    const r = restoreHunk(current, hunk);
    expect(r.ok && r.text).toBe("intro\nnew line\ntail\n---\nintro\nold line\ntail");
  });

  it("handles a pure addition hunk", () => {
    const add = parseHunks(DIFF)[1]!;
    const r = restoreHunk("before\nkeep\nafter", add);
    expect(r.ok && r.text).toBe("before\nkeep\nextra\nafter");
  });
});
