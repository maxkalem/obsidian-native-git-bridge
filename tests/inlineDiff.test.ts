import { describe, expect, it } from "vitest";
import {
  INLINE_DIFF_CHAR_LIMIT,
  INLINE_DIFF_TOKEN_LIMIT,
  inlineDiff,
  tokenizeLine,
  worthHighlighting,
} from "../src/git/inlineDiff";

/** Compact view of a side: "same|add|remove" runs as `kind:text`. */
const show = (runs: { kind: string; text: string }[]) => runs.map((r) => `${r.kind}:${r.text}`);
/** Runs must always reassemble into the original line, or the pane lies. */
const joined = (runs: { text: string }[]) => runs.map((r) => r.text).join("");

describe("tokenizeLine", () => {
  it("splits words, whitespace and punctuation apart", () => {
    expect(tokenizeLine("the quick, fox")).toEqual(["the", " ", "quick", ",", " ", "fox"]);
  });

  it("keeps a whitespace run as ONE token", () => {
    expect(tokenizeLine("a   b")).toEqual(["a", "   ", "b"]);
  });

  it("treats non-Latin letters as letters, not punctuation", () => {
    // `\w` would make every one of these its own punctuation token and every
    // edit would repaint the whole line.
    expect(tokenizeLine("привіт світ")).toEqual(["привіт", " ", "світ"]);
    expect(tokenizeLine("日本 語")).toEqual(["日本", " ", "語"]);
  });

  it("survives an empty line", () => {
    expect(tokenizeLine("")).toEqual([]);
  });
});

describe("inlineDiff", () => {
  it("marks only the word that changed", () => {
    const { before, after } = inlineDiff("the quick brown fox", "the quick red fox");
    expect(show(before)).toEqual(["same:the quick ", "remove:brown", "same: fox"]);
    expect(show(after)).toEqual(["same:the quick ", "add:red", "same: fox"]);
  });

  // diff2html ran with `diffStyle: "char"` and rendered this pair as
  // `<del>b</del>r<del>own</del>`, because "brown" and "red" share an "r".
  it("does not chase incidental shared letters inside words", () => {
    const { before } = inlineDiff("brown", "red");
    expect(show(before)).toEqual(["remove:brown"]);
  });

  it("handles an appended tail", () => {
    const { before, after } = inlineDiff("the fox", "the fox jumps");
    expect(show(before)).toEqual(["same:the fox"]);
    expect(show(after)).toEqual(["same:the fox", "add: jumps"]);
  });

  it("handles a removed head", () => {
    const { before, after } = inlineDiff("well, the fox", "the fox");
    expect(show(before)).toEqual(["remove:well, ", "same:the fox"]);
    expect(show(after)).toEqual(["same:the fox"]);
  });

  it("coalesces neighbouring tokens of the same kind", () => {
    // "a b c" -> "a c": the removal covers two tokens (" " and "b") plus one
    // more space, and must arrive as ONE run rather than three.
    const { before } = inlineDiff("a b c", "a c");
    expect(before.filter((r) => r.kind === "remove")).toHaveLength(1);
  });

  it("reports identical lines as a single shared run", () => {
    const { before, after } = inlineDiff("unchanged", "unchanged");
    expect(show(before)).toEqual(["same:unchanged"]);
    expect(show(after)).toEqual(["same:unchanged"]);
  });

  it("handles one side being empty", () => {
    expect(show(inlineDiff("", "added").after)).toEqual(["add:added"]);
    expect(show(inlineDiff("gone", "").before)).toEqual(["remove:gone"]);
  });

  it("always reassembles into the original text", () => {
    const pairs: [string, string][] = [
      ["the quick brown fox", "the quick red fox jumps"],
      ["alpha", "beta"],
      ["  indented", "\tindented"],
      ["## Heading", "## Heading two"],
      ["- [ ] task", "- [x] task done"],
      ["", "x"],
      ["x", ""],
      ["привіт світ", "привіт великий світ"],
    ];
    for (const [a, b] of pairs) {
      const r = inlineDiff(a, b);
      expect(joined(r.before)).toBe(a);
      expect(joined(r.after)).toBe(b);
    }
  });

  it("preserves leading whitespace changes, which is all a reindent consists of", () => {
    const { before, after } = inlineDiff("  two", "    four");
    expect(joined(before)).toBe("  two");
    expect(joined(after)).toBe("    four");
    expect(before.some((r) => r.kind === "remove")).toBe(true);
  });

  // A diff of a bundled main.js really does contain single lines with tens of
  // thousands of tokens; O(n·m) on that hangs the pane.
  it("gives up on absurdly long lines instead of hanging", () => {
    const long = "x ".repeat(INLINE_DIFF_TOKEN_LIMIT + 50);
    const t0 = Date.now();
    const { before, after } = inlineDiff(long + "a", long + "b");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(show(before)).toEqual([`remove:${long}a`]);
    expect(show(after)).toEqual([`add:${long}b`]);
  });

  it("still diffs a line right at the limit", () => {
    const tokens = Math.floor(INLINE_DIFF_TOKEN_LIMIT / 2) - 1;
    const a = Array.from({ length: tokens }, (_, i) => `w${i}`).join(" ");
    const r = inlineDiff(a, `${a} tail`);
    expect(r.after.some((x) => x.kind === "add")).toBe(true);
  });
});

describe("inlineDiff, character unit", () => {
  it("marks the letters that changed, not the whole word", () => {
    // The word unit reports "brown" replaced by "red". The character unit is
    // what diff2html produced, and it is the useful one for an identifier or a
    // path, where one letter IS the edit.
    const { before, after } = inlineDiff("colour", "color", "char");
    expect(show(before)).toEqual(["same:colo", "remove:u", "same:r"]);
    expect(show(after)).toEqual(["same:color"]);
  });

  it("refines only inside a stretch the word pass already changed", () => {
    // "quick" is untouched, so it stays one shared run: the character pass must
    // not re-diff the whole line and start matching letters across words.
    const { before, after } = inlineDiff("the quick fox", "the quick fix", "char");
    expect(joined(before)).toBe("the quick fox");
    expect(joined(after)).toBe("the quick fix");
    expect(before.some((r) => r.kind === "same" && r.text.includes("quick"))).toBe(true);
    expect(before.filter((r) => r.kind === "remove")).toEqual([{ kind: "remove", text: "o" }]);
    expect(after.filter((r) => r.kind === "add")).toEqual([{ kind: "add", text: "i" }]);
  });

  it("leaves the word unit alone", () => {
    const { before } = inlineDiff("colour", "color");
    expect(show(before)).toEqual(["remove:colour"]);
  });

  it("does not split a surrogate pair", () => {
    // Array.from splits by code point; "".split("") would cut the emoji in
    // half and render a replacement glyph on each side.
    const { before, after } = inlineDiff("a 😀 b", "a 😀 c", "char");
    expect(joined(before)).toBe("a 😀 b");
    expect(joined(after)).toBe("a 😀 c");
    // A correct run may well CONTAIN surrogates — an emoji is a pair of them.
    // What must never appear is half a pair on its own.
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const r of [...before, ...after]) expect(r.text).not.toMatch(lone);
  });

  it("always reassembles into the original text", () => {
    const pairs: [string, string][] = [
      ["the quick brown fox", "the quick red fox jumps"],
      ["alpha", "beta"],
      ["  indented", "\tindented"],
      ["Projects/Water Sort/GD.md", "Projects/Water Sort/GDD.md"],
      ["", "x"],
      ["x", ""],
      ["привіт світ", "привіт світе"],
    ];
    for (const [a, b] of pairs) {
      const r = inlineDiff(a, b, "char");
      expect(joined(r.before)).toBe(a);
      expect(joined(r.after)).toBe(b);
    }
  });

  it("falls back to the word unit on a stretch too long to refine", () => {
    // The ceiling is per changed stretch, not per line, so a paragraph with one
    // small edit is still refined while one rewritten wholesale is not.
    const a = "z".repeat(INLINE_DIFF_CHAR_LIMIT + 10);
    const b = "y".repeat(INLINE_DIFF_CHAR_LIMIT + 10);
    const t0 = Date.now();
    const r = inlineDiff(a, b, "char");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(show(r.before)).toEqual([`remove:${a}`]);
    expect(show(r.after)).toEqual([`add:${b}`]);
  });

  it("stays as cheap as the word pass on a long line with one small edit", () => {
    const filler = Array.from({ length: 150 }, (_, i) => `word${i}`).join(" ");
    const t0 = Date.now();
    const r = inlineDiff(`${filler} alpha`, `${filler} alpho`, "char");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.before.filter((x) => x.kind === "remove")).toEqual([{ kind: "remove", text: "a" }]);
  });
});

describe("worthHighlighting", () => {
  it("is false when the two lines share nothing", () => {
    expect(worthHighlighting(inlineDiff("alpha", "beta").before)).toBe(false);
  });

  it("is false when the only thing shared is whitespace", () => {
    // Sharing a space is not sharing content; marking the rest as <del> on top
    // of an already-coloured row only adds noise.
    expect(worthHighlighting(inlineDiff("aa bb", "cc dd").before)).toBe(false);
  });

  it("is true when real text is shared", () => {
    expect(worthHighlighting(inlineDiff("the quick fox", "the slow fox").before)).toBe(true);
  });
});
