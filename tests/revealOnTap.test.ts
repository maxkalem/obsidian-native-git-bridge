import { beforeEach, describe, expect, it } from "vitest";
import {
  __fakeEl,
  __findByClass,
  __fire,
  __mockDoc,
  __resetObsidianMock,
  __textOf,
} from "./mocks/obsidian";
import { revealOnTap } from "../src/ui/revealOnTap";
import { renderCountBadge } from "../src/ui/countBadge";

/**
 * A label that had to be shortened has to be able to answer in full, and the
 * two places that shorten one — the count badge and the rename hint — have to
 * answer the same way. This is the shared half.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

(globalThis as Any).window = {
  setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
};

const PATH = "Projects/Water Sort Cafe/_references/researches/Sorting Balls and Water Equivalence.pdf";

describe("revealOnTap", () => {
  beforeEach(() => {
    __resetObsidianMock();
  });

  it("marks the target so it reads as tappable", () => {
    const el = __fakeEl("span", "", "← file.pdf");
    revealOnTap(el, PATH);
    expect(el.hasClass("ngb-reveal-target")).toBe(true);
  });

  it("shows the whole value on tap, not the shortened one", () => {
    const el = __fakeEl("span", "", "← file.pdf");
    revealOnTap(el, PATH, { align: "left" });
    expect(__findByClass(__mockDoc.body, "ngb-reveal-pop")).toBeNull();

    expect(__fire(el, "click")).toBe(true);
    const pop = __findByClass(__mockDoc.body, "ngb-reveal-pop");
    expect(pop).not.toBeNull();
    // `__textOf`, not `.textContent`: the popup puts each line in its own div,
    // so the wrapper carries no text of its own. A move has to read as two
    // paths with an arrow between them rather than one blob.
    expect(__textOf(pop)).toBe(PATH);
  });

  it("opens one popup however many times it is tapped", () => {
    const el = __fakeEl("span", "", "2.4k");
    revealOnTap(el, "2415 files");
    __fire(el, "click");
    __fire(el, "click");
    __fire(el, "pointerdown");
    expect(__mockDoc.body.children.filter((c: Any) => c.hasClass("ngb-reveal-pop"))).toHaveLength(1);
  });

  it("stops the click reaching the row it sits on", () => {
    // The hint lives inside a row whose own click opens a diff. Revealing a
    // path must not also navigate away from the panel showing it.
    const el = __fakeEl("span", "", "← file.pdf");
    revealOnTap(el, PATH);
    let stopped = false;
    __fire(el, "click", { stopPropagation: () => (stopped = true) });
    expect(stopped).toBe(true);
  });

  it("is the same mechanism the count badge uses", () => {
    const parent = __fakeEl("div");
    const badge = renderCountBadge(parent, 2415, (n) => `${n} files`);
    expect(badge.hasClass("ngb-reveal-target")).toBe(true);
    __fire(badge, "click");
    expect(__textOf(__findByClass(__mockDoc.body, "ngb-reveal-pop"))).toBe("2415 files");
  });

  it("leaves a count that reads exactly alone", () => {
    // Nothing was hidden, so there is nothing to reveal and no affordance to
    // promise one.
    const parent = __fakeEl("div");
    const badge = renderCountBadge(parent, 42, (n) => `${n} files`);
    expect(badge.hasClass("ngb-reveal-target")).toBe(false);
    expect(__fire(badge, "click")).toBe(false);
  });
});
