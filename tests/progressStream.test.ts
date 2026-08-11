import { describe, expect, it } from "vitest";
import {
  collapseProgress,
  lastProgressLine,
  progressForBundle,
} from "../src/ops/progressStream";
import { streamAction } from "../src/main";

/**
 * The plugin knew how long it had been waiting and nothing else.
 *
 * `run_git` sent git's stderr to a `mktemp` file and read it after git exited,
 * so through the fifteen minutes an object repair takes — the operation the user
 * on this device has actually been waiting on — the panel could only count
 * seconds. Three percent in and completely wedged looked the same, and when the
 * repair hit its old 90 s budget the report was a timeout with no indication of
 * how far it had got.
 *
 * The runner now appends stderr to `runtime/progress/<id>.txt` while it works.
 * These are the rules for reading it: what a terminal would have shown, with
 * credentials out, short enough to sit on one line of a phone-width panel.
 */

/** What git really writes: chunk, carriage return, next chunk over the top. */
const METER =
  "remote: Enumerating objects: 83, done.        \n" +
  "remote: Counting objects:  50% (42/83)        \r" +
  "remote: Counting objects: 100% (83/83), done.        \n" +
  "Receiving objects:  12% (10/83)\rReceiving objects: 100% (83/83), done.\n";

describe("collapseProgress", () => {
  it("keeps only the final state of each redrawn line", () => {
    const out = collapseProgress(METER).split("\n");
    expect(out[1]).toBe("remote: Counting objects: 100% (83/83), done.");
    expect(out[2]).toBe("Receiving objects: 100% (83/83), done.");
    // The percentages it passed through are gone, not merely hidden.
    expect(collapseProgress(METER)).not.toContain("50%");
    expect(collapseProgress(METER)).not.toContain("12%");
  });

  it("drops the padding git uses to erase the previous chunk", () => {
    // Spaces that exist only so a shorter line fully covers a longer one. On a
    // terminal they are invisible; in a file they are on the end of every line.
    expect(collapseProgress("remote: Counting objects: 100%   \n")).toBe(
      "remote: Counting objects: 100%\n"
    );
  });

  it("leaves ordinary output alone", () => {
    const plain = "From https://example.invalid/repo\n   abc1234..def5678  main -> origin/main";
    expect(collapseProgress(plain)).toBe(plain);
  });
});

describe("lastProgressLine", () => {
  it("takes the newest line that says something", () => {
    expect(lastProgressLine(METER)).toBe("Receiving objects: 100% (83/83), done.");
  });

  it("ignores the blank tail a stream in flight normally has", () => {
    // git has written a chunk and no newline yet, or the runner just appended
    // one; either way the last "line" is often empty and is not the answer.
    expect(lastProgressLine("sync: fetching from origin\n\n   \n")).toBe(
      "sync: fetching from origin"
    );
  });

  it("answers null for an empty stream rather than an empty line", () => {
    // The caller decides whether to show anything, and "" would render as a
    // stray separator next to the elapsed-seconds ticker.
    expect(lastProgressLine("")).toBeNull();
    expect(lastProgressLine("\n\n")).toBeNull();
  });

  it("redacts a token carried in the remote URL", () => {
    // This is not hypothetical: over https with a PAT, the token IS the
    // username, and fetch prints the URL it used. The line goes on screen and
    // into a shareable bundle.
    const line = lastProgressLine("From https://ghp_deadbeefdeadbeef@github.com/o/r\n", 200);
    expect(line).not.toContain("ghp_deadbeefdeadbeef");
    expect(line).toContain("***@github.com");
  });

  it("cuts a long line instead of letting it wrap the panel", () => {
    const long = "x".repeat(200);
    const line = lastProgressLine(long, 40);
    expect(line).toHaveLength(40);
    expect(line?.endsWith("…")).toBe(true);
  });
});

describe("progressForBundle", () => {
  it("keeps the end, because that is where the failure is", () => {
    const text = Array.from({ length: 500 }, (_, i) => `step ${i}`).join("\n");
    const out = progressForBundle(text, 200);
    expect(out).toContain("step 499");
    expect(out).not.toContain("step 0\n");
    expect(out).toContain("earlier bytes omitted");
  });

  it("starts at a line boundary so the file never opens mid-word", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line-number-${i}`).join("\n");
    const body = progressForBundle(text, 60).split("\n").slice(1);
    for (const l of body) expect(l).toMatch(/^line-number-\d+$/);
  });

  it("collapses and redacts the whole stream, not just the last line", () => {
    const out = progressForBundle(
      "Counting: 1%\rCounting: 100%\nFrom https://ghp_secretsecret@host/r\n"
    );
    expect(out).not.toContain("1%");
    expect(out).not.toContain("ghp_secretsecret");
  });

  it("returns nothing at all for a stream that never got started", () => {
    expect(progressForBundle("")).toBe("");
  });
});

describe("streamAction", () => {
  it("takes the action from the stream's own first line", () => {
    // The runner opens every stream with "<action> started", which is what lets
    // the output panel label an operation that finished in another session
    // without the plugin remembering anything about it.
    expect(streamAction("sync started\nsync: fetching from origin")).toBe("sync");
    expect(streamAction("repair-refetch started\n…")).toBe("repair-refetch");
  });

  it("refuses anything that is not an action name", () => {
    // A stream trimmed from the front — the bundle does exactly that — can begin
    // mid-word or mid-sentence, and guessing from it would put "Receiving" or
    // "(1204/1943)" where an action belongs.
    expect(streamAction("… (2048 earlier bytes omitted)")).toBeNull();
    expect(streamAction("Receiving objects: 62% (1204/1943)")).toBeNull();
    expect(streamAction("")).toBeNull();
  });
});
