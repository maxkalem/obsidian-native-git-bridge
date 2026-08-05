import { describe, expect, it } from "vitest";
import { parseConflictFile, resolveBlock } from "../src/git/conflictParser";

const SIMPLE = [
  "before",
  "<<<<<<< HEAD",
  "mine A",
  "mine B",
  "=======",
  "theirs A",
  ">>>>>>> feature",
  "after",
].join("\n");

describe("parseConflictFile", () => {
  it("splits text and conflict segments with labels", () => {
    const p = parseConflictFile(SIMPLE);
    expect(p.conflictCount).toBe(1);
    expect(p.segments).toHaveLength(3);
    const c = p.segments[1]!;
    expect(c.kind).toBe("conflict");
    if (c.kind === "conflict") {
      expect(c.oursLabel).toBe("HEAD");
      expect(c.theirsLabel).toBe("feature");
      expect(c.ours).toEqual(["mine A", "mine B"]);
      expect(c.theirs).toEqual(["theirs A"]);
      expect(c.base).toBeUndefined();
    }
  });

  it("understands diff3-style blocks with a base section", () => {
    const raw = [
      "<<<<<<< HEAD",
      "mine",
      "||||||| merged common ancestors",
      "orig",
      "=======",
      "theirs",
      ">>>>>>> branch",
    ].join("\n");
    const p = parseConflictFile(raw);
    const c = p.segments[0]!;
    if (c.kind === "conflict") {
      expect(c.base).toEqual(["orig"]);
      expect(c.ours).toEqual(["mine"]);
      expect(c.theirs).toEqual(["theirs"]);
    } else {
      throw new Error("expected conflict");
    }
  });

  it("treats malformed / unterminated markers as plain text (never guesses)", () => {
    const unterminated = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\nno closer";
    const p = parseConflictFile(unterminated);
    expect(p.conflictCount).toBe(0);
    expect(p.segments).toHaveLength(1);
    const nested = "<<<<<<< HEAD\n<<<<<<< again\n=======\nx\n>>>>>>> b";
    // The inner block still parses as a valid conflict; the outer opener
    // becomes plain text.
    const p2 = parseConflictFile(nested);
    expect(p2.conflictCount).toBe(1);
  });

  it("handles multiple blocks and content that merely resembles markers", () => {
    const raw = `${SIMPLE}\nmiddle ==== not a marker\n${SIMPLE}`;
    const p = parseConflictFile(raw);
    expect(p.conflictCount).toBe(2);
  });
});

describe("resolveBlock", () => {
  it("replaces only the chosen block and keeps the rest verbatim", () => {
    const two = `${SIMPLE}\n${SIMPLE}`;
    const p = parseConflictFile(two);
    const firstIdx = p.segments.findIndex((s) => s.kind === "conflict");
    const out = resolveBlock(p, firstIdx, "ours");
    expect(out).toContain("mine A\nmine B\nafter");
    expect(out).not.toMatch(/^before\n<<<<<<</); // first block resolved
    // second block untouched, markers intact
    expect(out.match(/<<<<<<< HEAD/g)).toHaveLength(1);
    expect(out).toContain(">>>>>>> feature");
    const p2 = parseConflictFile(out);
    expect(p2.conflictCount).toBe(1);
  });

  it("keeps 'theirs' when chosen and drops base sections of the resolved block", () => {
    const raw = [
      "<<<<<<< HEAD",
      "mine",
      "||||||| base",
      "orig",
      "=======",
      "theirs",
      ">>>>>>> b",
    ].join("\n");
    const p = parseConflictFile(raw);
    expect(resolveBlock(p, 0, "theirs")).toBe("theirs");
  });

  it("round-trips: resolving every block one by one removes all markers", () => {
    const two = `${SIMPLE}\n${SIMPLE}`;
    let p = parseConflictFile(two);
    while (p.conflictCount > 0) {
      const idx = p.segments.findIndex((s) => s.kind === "conflict");
      p = parseConflictFile(resolveBlock(p, idx, "theirs"));
    }
    expect(p.conflictCount).toBe(0);
  });
});

describe("shortRefLabel (button naming: who the conflict is with)", () => {
  it("abbreviates bare commit hashes to 8 chars", async () => {
    const { shortRefLabel } = await import("../src/ui/ConflictView");
    expect(shortRefLabel("812a998bac9fc32c19871710b2a259a107bbe867")).toBe("812a998b");
  });
  it("keeps branch names, trimming only very long ones", async () => {
    const { shortRefLabel } = await import("../src/ui/ConflictView");
    expect(shortRefLabel("feature/menu")).toBe("feature/menu");
    expect(shortRefLabel("release/very-long-branch-name-here")).toBe(
      "release/very-long-branch".slice(0, 24) + "…"
    );
    expect(shortRefLabel("")).toBe("");
  });
});

describe("Obsidian-safe marker form (-<<<<<<< / -======= / ->>>>>>>)", () => {
  // Bare ======= turns the previous Markdown line into a heading and >>>>>>>
  // into nested blockquotes, so the plugin writes remaining blocks back with
  // a leading "-" (renders as a harmless list item). Both forms must parse.
  const SAFE = [
    "before",
    "-<<<<<<< HEAD",
    "mine",
    "-=======",
    "theirs",
    "->>>>>>> 812a998bac9fc32c19871710b2a259a107bbe867",
    "after",
  ].join("\n");

  it("parses the '-' form like the standard one", () => {
    const p = parseConflictFile(SAFE);
    expect(p.conflictCount).toBe(1);
    const c = p.segments[1]!;
    if (c.kind !== "conflict") throw new Error("expected conflict");
    expect(c.ours).toEqual(["mine"]);
    expect(c.theirs).toEqual(["theirs"]);
    expect(c.theirsLabel).toBe("812a998bac9fc32c19871710b2a259a107bbe867");
  });

  it("writes remaining blocks in the '-' form when one block is resolved", () => {
    const two = `${SAFE}\n${SAFE}`;
    const p = parseConflictFile(two);
    const idx = p.segments.findIndex((s) => s.kind === "conflict");
    const out = resolveBlock(p, idx, "ours");
    expect(out).toContain("-<<<<<<< HEAD");
    expect(out).toContain("-=======");
    expect(out).toContain("->>>>>>> 812a998b");
    expect(out).not.toMatch(/^=======$/m);
    expect(out).not.toMatch(/^>>>>>>>/m);
    // and the rewritten form still round-trips
    expect(parseConflictFile(out).conflictCount).toBe(1);
  });

  it("mixed standard + '-' forms in one file both parse", () => {
    const std = "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x";
    const p = parseConflictFile(`${std}\n${SAFE}`);
    expect(p.conflictCount).toBe(2);
  });
});
