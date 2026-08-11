import { describe, expect, it } from "vitest";
import { describeRestore, restoreBlockInFile } from "../src/git/restoreBlock";
import { parseHunks } from "../src/git/hunks";

/**
 * Putting one block back the way it was at a commit.
 *
 * Two surfaces offer it — the file-history panel's hunks and a diff opened from
 * the commit history — and this is the one implementation both call. The order
 * of the steps is the part worth pinning: the patch is built from the texts as
 * they are BEFORE the file is written, because afterwards the "current" text no
 * longer describes what is on disk and git has nothing to match the removals
 * against.
 */

const BASE = "one\ntwo\nthree\nfour\n";
/** A hunk that turns `two` back into `TWO`, as it was at the commit. */
const DIFF = `--- a/note.md
+++ b/note.md
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
 four
`;

function io(current: string | null, over: Partial<Record<string, unknown>> = {}) {
  const written: string[] = [];
  const staged: string[] = [];
  return {
    written,
    staged,
    io: {
      readFile: async () => current,
      writeFile: async (_p: string, c: string) => void written.push(c),
      stagePatch: async (p: string) => {
        staged.push(p);
        return (over.stageOk as boolean | undefined) ?? true;
      },
    },
  };
}

describe("restoreBlockInFile", () => {
  it("writes the restored text and stages exactly that block", async () => {
    const hunk = parseHunks(DIFF)[0]!;
    const h = io(BASE);
    const out = await restoreBlockInFile("note.md", hunk, h.io);

    expect(out).toEqual({ kind: "restored", staged: true });
    expect(h.written[0]).toBe("one\nTWO\nthree\nfour\n");
    // A patch for the file, built from the two texts — not a blanket `git add`,
    // which would sweep in every other edit in the file.
    expect(h.staged[0]).toContain("note.md");
    expect(h.staged[0]).toContain("+TWO");
  });

  it("builds the patch BEFORE writing, or git has nothing to match", async () => {
    const hunk = parseHunks(DIFF)[0]!;
    const order: string[] = [];
    const out = await restoreBlockInFile("note.md", hunk, {
      readFile: async () => BASE,
      writeFile: async () => void order.push("write"),
      stagePatch: async (p) => {
        order.push("stage");
        // The removals must describe the text as it was, which is only true if
        // the patch was built before the write.
        expect(p).toContain("-two");
        return true;
      },
    });
    expect(out.kind).toBe("restored");
    expect(order).toEqual(["write", "stage"]);
  });

  it("says the block is stale rather than writing something wrong", async () => {
    const hunk = parseHunks(DIFF)[0]!;
    const h = io("something else entirely\n");
    expect(await restoreBlockInFile("note.md", hunk, h.io)).toEqual({ kind: "stale" });
    expect(h.written).toEqual([]);
  });

  it("does nothing when the block already matches", async () => {
    const hunk = parseHunks(DIFF)[0]!;
    const h = io("one\nTWO\nthree\nfour\n");
    expect(await restoreBlockInFile("note.md", hunk, h.io)).toEqual({ kind: "unchanged" });
    expect(h.written).toEqual([]);
  });

  it("reports an unreadable file instead of throwing at it", async () => {
    const hunk = parseHunks(DIFF)[0]!;
    const h = io(null);
    expect(await restoreBlockInFile("note.md", hunk, h.io)).toEqual({ kind: "unreadable" });
  });

  it("keeps the restore when staging fails, and says which happened", async () => {
    // The file is already written by then. Undoing it to make the report tidy
    // would throw away the thing the user actually asked for.
    const hunk = parseHunks(DIFF)[0]!;
    const h = io(BASE, { stageOk: false });
    const out = await restoreBlockInFile("note.md", hunk, h.io);
    expect(out).toEqual({ kind: "restored", staged: false, reason: "stage-failed" });
    expect(h.written[0]).toBe("one\nTWO\nthree\nfour\n");
  });
});

describe("describeRestore", () => {
  it("names the commit in the success cases", () => {
    expect(describeRestore({ kind: "restored", staged: true }, "abc12345")).toContain("abc12345");
    expect(
      describeRestore({ kind: "restored", staged: false, reason: "stage-failed" }, "abc12345")
    ).toContain("staging it failed");
  });

  it("tells the user what is left to do when the patch could not be built", () => {
    const s = describeRestore({ kind: "restored", staged: false, reason: "no-newline" }, "abc12345");
    expect(s).toContain("Stage it from the git panel");
  });

  it("has a sentence for every outcome, so none can render as undefined", () => {
    for (const o of [
      { kind: "unreadable" },
      { kind: "stale" },
      { kind: "unchanged" },
      { kind: "restored", staged: true },
    ] as const) {
      expect(describeRestore(o, "abc12345").length).toBeGreaterThan(10);
    }
  });
});
