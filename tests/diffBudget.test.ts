import { describe, expect, it } from "vitest";
import { describeDiffBudget, overrideWarning, type DiffBudgetFacts } from "../src/git/diffBudget";

const facts = (over: Partial<DiffBudgetFacts> = {}): DiffBudgetFacts => ({
  hunksShown: 12,
  hunksTotal: 40,
  totalBytes: 2_400_000,
  limitBytes: 102_400,
  linesShown: 1_100,
  ...over,
});

describe("describeDiffBudget", () => {
  it("says nothing when the diff arrived whole", () => {
    expect(describeDiffBudget(facts({ hunksShown: 40, hunksTotal: 40 }))).toBeNull();
  });

  it("says nothing for a diff with no hunks at all", () => {
    // "Binary files differ" has no hunks; there is nothing being withheld.
    expect(describeDiffBudget(facts({ hunksShown: 0, hunksTotal: 0 }))).toBeNull();
  });

  it("counts hunks, not bytes, in the sentence the user reads", () => {
    const n = describeDiffBudget(facts())!;
    expect(n.text).toContain("Showing 12 of 40 hunks");
    expect(n.text).toContain("100 KB limit");
    expect(n.text).toContain("2.3 MB");
  });

  it("phrases the case where not even the first hunk fit", () => {
    const n = describeDiffBudget(facts({ hunksShown: 0, linesShown: 0 }))!;
    expect(n.text).toContain("None of the 40 hunks fit");
  });

  it("asks for exactly the diff's own size", () => {
    const n = describeDiffBudget(facts({ totalBytes: 300 * 1024 }))!;
    expect(n.overrideKb).toBe(300);
    expect(n.cappedByTransport).toBe(false);
    expect(n.overrideLabel).toBe("Show the whole diff");
  });

  it("stops at what one request can carry, and says so", () => {
    const n = describeDiffBudget(facts({ totalBytes: 9 * 1024 * 1024 }))!;
    expect(n.overrideKb).toBe(4096);
    expect(n.cappedByTransport).toBe(true);
    expect(n.overrideLabel).toContain("as much as possible");
  });

  it("estimates the line count from the part that did arrive", () => {
    // 102 400 bytes carried 1 100 lines, so ~93 bytes a line; 2.4 MB of the same
    // material is around 26 000 lines.
    const n = describeDiffBudget(facts())!;
    expect(n.estimatedLines).toBeGreaterThan(20_000);
    expect(n.estimatedLines).toBeLessThan(32_000);
  });

  it("falls back to a byte estimate when no sample arrived", () => {
    const n = describeDiffBudget(facts({ hunksShown: 0, linesShown: 0, totalBytes: 40_000 }))!;
    expect(n.estimatedLines).toBe(1000); // 40 000 / 40
  });
});

describe("overrideWarning", () => {
  it("warns in lines and elements, which is what the pane pays", () => {
    const n = describeDiffBudget(facts())!;
    const w = overrideWarning(n).join(" ");
    expect(w).toMatch(/about [\d,   ]+ lines/);
    expect(w).toContain("elements");
  });

  it("promises the setting is left alone", () => {
    const w = overrideWarning(describeDiffBudget(facts())!).join(" ");
    expect(w).toContain("this diff only");
  });

  it("admits when even the override cannot show everything", () => {
    const n = describeDiffBudget(facts({ totalBytes: 9 * 1024 * 1024 }))!;
    expect(overrideWarning(n).join(" ")).toContain("larger than one request can carry");
  });

  it("does not add that line when the whole diff does fit in one request", () => {
    const n = describeDiffBudget(facts({ totalBytes: 300 * 1024 }))!;
    expect(overrideWarning(n).join(" ")).not.toContain("larger than one request");
  });
});
