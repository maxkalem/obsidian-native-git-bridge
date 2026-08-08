import { beforeEach, describe, expect, it } from "vitest";
import { __findAllByClass, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import { ConflictView, type ConflictViewActions } from "../src/ui/ConflictView";
import type { InlineDiffUnit } from "../src/git/inlineDiff";

/**
 * What the conflict pane says about the two sides of a block.
 *
 * It has always answered "these two blocks disagree" and never "about what".
 * On a block of prose, where one word differs between local and remote, that is
 * the only question the reader has, and answering it meant reading both sides
 * character by character by eye.
 *
 * What this canNOT tell you: whether any of it is legible on a phone. That is
 * CSS, the mock has no layout engine, and it stays a device-screenshot
 * question.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

const CONFLICT = `intact line
<<<<<<< HEAD
the quick brown fox
kept the same
=======
the quick red fox
kept the same
>>>>>>> origin/main
tail line
`;

function actions(text: string, unit: InlineDiffUnit = "word"): ConflictViewActions {
  return {
    readFile: () => Promise.resolve(text),
    writeFile: () => Promise.resolve(),
    stageFile: () => Promise.resolve(),
    markersVisible: () => false,
    showInvisibles: () => false,
    inlineUnit: () => unit,
    colors: () => null,
  };
}

async function render(text: string, unit: InlineDiffUnit = "word"): Promise<Any> {
  const view = new ConflictView(leaf, actions(text, unit)) as Any;
  // `reload()` rather than `setState()`: setState delegates to Obsidian's own
  // ItemView, which the mock does not implement. Everything under test here
  // happens after the path is known.
  view.path = "Notes/note.md";
  await view.reload();
  return view.contentEl;
}

/**
 * A cell's text with the markup flattened and NOTHING inserted between the
 * pieces. `__textOf` joins subtrees with a space, which is right for asserting
 * what a panel says and wrong here: the whole point is that splitting a line
 * into `<del>` runs leaves the line itself byte for byte as it was.
 */
const flat = (n: Any): string =>
  (n.textContent ?? "") + (n.children ?? []).map(flat).join("");

/** Text of every content cell on one side of a block. */
const sideText = (root: Any, cls: string) =>
  __findAllByClass(root, cls)
    .filter((r: Any) => !String(r.className ?? "").includes("ngb-conf-marker"))
    .flatMap((r: Any) => __findAllByClass(r, "ngb-conf-text"))
    .map(flat);

describe("ConflictView intra-line comparison", () => {
  beforeEach(() => __resetObsidianMock());

  it("marks what differs on the local side with <del>", async () => {
    const root = await render(CONFLICT);
    const dels = __findAllByClass(root, "ngb-conf-text").flatMap((c: Any) =>
      (c.children ?? []).filter((n: Any) => n.tagName === "DEL").map((n: Any) => n.textContent)
    );
    expect(dels).toEqual(["brown"]);
  });

  it("marks what differs on the remote side with <ins>, and never both on one row", async () => {
    const root = await render(CONFLICT);
    for (const cell of __findAllByClass(root, "ngb-conf-text")) {
      const kinds = new Set((cell.children ?? []).map((n: Any) => n.tagName));
      expect(kinds.has("DEL") && kinds.has("INS")).toBe(false);
    }
    const inss = __findAllByClass(root, "ngb-conf-text").flatMap((c: Any) =>
      (c.children ?? []).filter((n: Any) => n.tagName === "INS").map((n: Any) => n.textContent)
    );
    expect(inss).toEqual(["red"]);
  });

  it("leaves the text of every line intact, so nothing is lost to the markup", async () => {
    const root = await render(CONFLICT);
    expect(sideText(root, "ngb-conf-ours")).toContain("the quick brown fox");
    expect(sideText(root, "ngb-conf-theirs")).toContain("the quick red fox");
  });

  it("says nothing about a line that is identical on both sides", async () => {
    // "kept the same" appears in both blocks. Marking it would be a lie, and it
    // is exactly the noise that makes a long block unreadable.
    const root = await render(CONFLICT);
    const marked = __findAllByClass(root, "ngb-conf-text").filter(
      (c: Any) =>
        __textOf(c).includes("kept the same") &&
        (c.children ?? []).some((n: Any) => n.tagName === "DEL" || n.tagName === "INS")
    );
    expect(marked).toEqual([]);
  });

  it("follows the word/character setting", async () => {
    const pair = `<<<<<<< HEAD
colour
=======
color
>>>>>>> origin/main
`;
    const words = await render(pair, "word");
    expect(
      __findAllByClass(words, "ngb-conf-text").flatMap((c: Any) =>
        (c.children ?? []).filter((n: Any) => n.tagName === "DEL").map((n: Any) => n.textContent)
      )
    ).toEqual([]); // nothing shared at word level, so nothing worth marking

    const chars = await render(pair, "char");
    expect(
      __findAllByClass(chars, "ngb-conf-text").flatMap((c: Any) =>
        (c.children ?? []).filter((n: Any) => n.tagName === "DEL").map((n: Any) => n.textContent)
      )
    ).toEqual(["u"]);
  });

  it("leaves a block whose sides have different line counts alone where they do not pair", async () => {
    const uneven = `<<<<<<< HEAD
one
two
=======
one changed
>>>>>>> origin/main
`;
    const root = await render(uneven);
    // "two" has no counterpart, so it stays plain rather than being compared
    // with something arbitrary.
    const two = __findAllByClass(root, "ngb-conf-text").find((c: Any) => __textOf(c) === "two");
    expect(two.children ?? []).toEqual([]);
  });

  it("opens every block with a marker the stylesheet can separate them by", async () => {
    const root = await render(CONFLICT);
    expect(__findAllByClass(root, "ngb-conf-block-start")).toHaveLength(1);
  });

  it("names the two sides plainly and puts the ref only in the label", async () => {
    const root = await render(CONFLICT);
    const chips = __findAllByClass(root, "ngb-conf-side-chip").map((c: Any) => c.textContent);
    expect(chips).toEqual(["Local (HEAD)", "Remote (origin/main)"]);
  });

  it("keeps the ref out of the buttons, whose meaning does not depend on it", async () => {
    // "Keep remote (7a201ba…)" was as wide as the ref it named, and on a phone
    // it overhung the row and covered the text beside it.
    const root = await render(CONFLICT);
    const buttons = __findAllByClass(root, "ngb-conf-keep").map((b: Any) => b.textContent);
    expect(buttons).toEqual(["Keep Local", "Keep Remote"]);
  });

  it("abbreviates a bare hash in the remote label", async () => {
    const root = await render(
      "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> 812a998bac9fc32c19871710b2a259a107bbe867\n"
    );
    const chips = __findAllByClass(root, "ngb-conf-side-chip").map((c: Any) => c.textContent);
    expect(chips[1]).toBe("Remote (812a998b…)");
  });
});
