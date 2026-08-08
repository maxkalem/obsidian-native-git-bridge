import { describe, expect, it } from "vitest";
import {
  CONFLICT_COLOR_VARS,
  DEFAULT_COLORS,
  DIFF_COLOR_VARS,
  conflictColorVars,
  diffColorVars,
  sanitizeColorSet,
} from "../src/ui/colors";
import { gutterWidthCh } from "../src/ui/DiffView";

describe("default colours", () => {
  it("uses a solid #AA1414 for deleted characters in both themes", () => {
    // The translucent red it replaced was unreadable against the row tint on
    // a phone: the characters that actually changed were the hardest to find.
    expect(DEFAULT_COLORS.dark.diffDelHl).toBe("#AA1414");
    expect(DEFAULT_COLORS.light.diffDelHl).toBe("#AA1414");
  });

  it("keeps light and dark apart", () => {
    expect(DEFAULT_COLORS.light.diffAddBg).not.toBe(DEFAULT_COLORS.dark.diffAddBg);
  });
});

describe("colour variables", () => {
  it("maps a set onto exactly the variables the panes declare", () => {
    const diff = diffColorVars(DEFAULT_COLORS.dark);
    expect(Object.keys(diff).sort()).toEqual([...DIFF_COLOR_VARS].sort());
    const conf = conflictColorVars(DEFAULT_COLORS.dark);
    expect(Object.keys(conf).sort()).toEqual([...CONFLICT_COLOR_VARS].sort());
    expect(diff["--ngb-diff-del-hl"]).toBe("#AA1414");
  });
});

describe("sanitizeColorSet", () => {
  it("keeps hex values and falls back to the default for everything else", () => {
    const s = sanitizeColorSet(
      {
        diffAddBg: "#123456",
        diffAddHl: "#abc",
        diffDelBg: "red",
        diffDelHl: "url(javascript:alert(1))",
        conflictLocalBg: 42,
      },
      "dark"
    );
    expect(s.diffAddBg).toBe("#123456");
    expect(s.diffAddHl).toBe("#abc");
    // These end up in a style attribute, so anything that is not a plain hex
    // colour is dropped rather than passed through.
    expect(s.diffDelBg).toBe(DEFAULT_COLORS.dark.diffDelBg);
    expect(s.diffDelHl).toBe(DEFAULT_COLORS.dark.diffDelHl);
    expect(s.conflictLocalBg).toBe(DEFAULT_COLORS.dark.conflictLocalBg);
  });

  it("returns the defaults for junk input", () => {
    expect(sanitizeColorSet(null, "light")).toEqual(DEFAULT_COLORS.light);
    expect(sanitizeColorSet("nope", "dark")).toEqual(DEFAULT_COLORS.dark);
  });
});

describe("gutterWidthCh", () => {
  /**
   * `picking` stands in for line-selection mode, where a checkbox shares the
   * cell with the numbers and the measurement has to allow for it.
   */
  const fake = (nums: string[], picking = false) =>
    ({
      querySelectorAll: () => nums.map((t) => ({ textContent: t })),
      querySelector: (sel: string) =>
        sel === ".ngb-line-pick" && picking ? ({} as unknown) : null,
    }) as unknown as ParentNode;

  it("grows with the longest line number, so the +/- prefix stays inside the gutter", () => {
    // The wrapped layout needs an explicit width on the number column. A fixed
    // guess was too small for three-digit numbers: the content overflowed the
    // cell and the prefix was drawn past the border, looking like code.
    const one = gutterWidthCh(fake(["1", "7"]));
    const three = gutterWidthCh(fake(["4", "187", "192"]));
    expect(three).toBeGreaterThan(one);
    expect(one).toBe(7); // 2 digits + prefix + padding + separation
    expect(three).toBe(11);
  });

  it("never returns zero for an empty diff", () => {
    expect(gutterWidthCh(fake([]))).toBeGreaterThan(0);
    expect(gutterWidthCh(fake(["", "  "]))).toBeGreaterThan(0);
  });

  // The checkbox shares the cell with the numbers, and the wrapped layout takes
  // this measurement as the column's fixed width.
  it("leaves room for the line checkbox while picking", () => {
    expect(gutterWidthCh(fake(["1", "7"], true))).toBeGreaterThan(gutterWidthCh(fake(["1", "7"])));
  });
});
