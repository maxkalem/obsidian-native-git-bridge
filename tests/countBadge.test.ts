import { describe, expect, it } from "vitest";
import { formatCount } from "../src/ui/countBadge";

describe("formatCount", () => {
  it("shows small counts verbatim at normal size", () => {
    for (const n of [0, 1, 9, 42, 99]) {
      expect(formatCount(n)).toEqual({ text: String(n), small: false, clamped: false });
    }
  });
  it("shrinks past two digits and marks the value as needing the popup", () => {
    expect(formatCount(100)).toEqual({ text: "100", small: true, clamped: true });
    expect(formatCount(999)).toEqual({ text: "999", small: true, clamped: true });
  });
  it("abbreviates from a thousand up, so the column never has to widen", () => {
    // 2415 untracked files in one folder is an ordinary number in this vault,
    // and four digits widened the fixed column and shifted that row's buttons.
    expect(formatCount(1000)).toEqual({ text: "1.0k", small: true, clamped: true });
    expect(formatCount(2415)).toEqual({ text: "2.4k", small: true, clamped: true });
    expect(formatCount(3947)).toEqual({ text: "3.9k", small: true, clamped: true });
    expect(formatCount(9999)).toEqual({ text: "9.9k", small: true, clamped: true });
    expect(formatCount(10000)).toEqual({ text: "10k", small: true, clamped: true });
    expect(formatCount(99999)).toEqual({ text: "99k", small: true, clamped: true });
  });
  it("rounds down, never up: a badge must not claim files that are not there", () => {
    expect(formatCount(1999).text).toBe("1.9k");
    expect(formatCount(10999).text).toBe("10k");
  });
  it("clamps above 99999", () => {
    expect(formatCount(100000)).toEqual({ text: "99k+", small: true, clamped: true });
    expect(formatCount(3_900_000)).toEqual({ text: "99k+", small: true, clamped: true });
  });
  it("never renders more than four characters", () => {
    for (const n of [0, 9, 99, 100, 999, 1000, 2415, 9999, 10000, 99999, 1e6]) {
      expect(formatCount(n).text.length).toBeLessThanOrEqual(4);
    }
  });
  it("normalises junk input instead of rendering it", () => {
    expect(formatCount(-5).text).toBe("0");
    expect(formatCount(12.7).text).toBe("12");
  });
});
