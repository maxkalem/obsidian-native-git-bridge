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
    expect(formatCount(9999)).toEqual({ text: "9999", small: true, clamped: true });
  });
  it("clamps above 9999", () => {
    expect(formatCount(10000)).toEqual({ text: "9999+", small: true, clamped: true });
    expect(formatCount(3_900_000)).toEqual({ text: "9999+", small: true, clamped: true });
  });
  it("normalises junk input instead of rendering it", () => {
    expect(formatCount(-5).text).toBe("0");
    expect(formatCount(12.7).text).toBe("12");
  });
});
