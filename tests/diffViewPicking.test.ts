import { beforeEach, describe, expect, it } from "vitest";
import { __findAllByClass, __resetObsidianMock } from "./mocks/obsidian";
import { DiffView, type DiffLoadResult, type DiffViewActions } from "../src/ui/DiffView";

/**
 * Line-picking mode in the diff pane: what stays usable while nothing is
 * ticked, and what survives the pane being pointed at another file.
 *
 * Both were reported from the device. The toggle out of picking mode carries
 * the same class as the actions beside it so it looks like them, and the
 * refresh that disables the actions when no line is ticked was disabling the
 * toggle with them — leaving the reader inside a mode with no way out. And the
 * pane is REUSED for every diff, so a mode left on greeted the next file with
 * checkboxes nobody had asked for.
 *
 * What this canNOT tell you: whether any of it is legible or reachable on a
 * phone. That is CSS, the mock has no layout engine, and it stays a
 * device-screenshot question.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const leaf = {} as Any;

(globalThis as Any).window = {
  setInterval: (fn: Any, ms: Any) => setInterval(fn, ms),
  clearInterval: (id: Any) => clearInterval(id),
};

const DIFF = `+++ b/note.md
@@ -1,3 +1,3 @@
 context
-was
+is
`;

function result(diff = DIFF): DiffLoadResult {
  return { diff, truncated: false, hunksShown: 1, hunksTotal: 1, totalBytes: 0, limitBytes: 0 };
}

function actions(over: Partial<DiffViewActions> = {}): DiffViewActions {
  return {
    loadDiff: () => Promise.resolve(result()),
    confirmLargerDiff: () => Promise.resolve(null),
    wrapLines: () => false,
    showInvisibles: () => false,
    inlineUnit: () => "word",
    keepLineSelection: () => false,
    colors: () => null,
    progressText: () => "",
    openFileAt: () => undefined,
    restoreBlock: () => Promise.resolve(),
    applyPatch: () => Promise.resolve(true),
    confirmDiscard: () => Promise.resolve(true),
    ...over,
  };
}

/** A pane showing the unstaged diff of one file, which is what offers picking. */
async function pane(over: Partial<DiffViewActions> = {}): Promise<Any> {
  const view = new DiffView(leaf, actions(over)) as Any;
  await view.setState({ path: "note.md", from: "INDEX", to: "WORKTREE", label: "x" }, {});
  return view;
}

const toggle = (view: Any) => __findAllByClass(view.contentEl, "ngb-hunk-pick-toggle")[0];
const actionButtons = (view: Any) =>
  __findAllByClass(view.contentEl, "ngb-hunk-btn").filter(
    (b: Any) => !String(b.className ?? "").includes("ngb-hunk-pick-toggle")
  );

describe("diff pane, line picking", () => {
  beforeEach(() => __resetObsidianMock());

  it("keeps the way out of picking mode enabled when nothing is ticked", async () => {
    const view = await pane();
    view.picking = true;
    view.picked.clear();
    view.renderBody(view.contentEl.querySelector(".ngb-diff-pane-body"), view.lastResult);
    view.refreshHunkBars();

    expect(actionButtons(view).every((b: Any) => b.disabled === true)).toBe(true);
    expect(toggle(view).disabled).toBeFalsy();
  });

  it("enables the actions again once a line is ticked", async () => {
    const view = await pane();
    view.picking = true;
    view.picked.add("0:1"); // the removed line of the only hunk
    view.renderBody(view.contentEl.querySelector(".ngb-diff-pane-body"), view.lastResult);
    view.refreshHunkBars();

    expect(actionButtons(view).some((b: Any) => b.disabled === true)).toBe(false);
    expect(toggle(view).disabled).toBeFalsy();
  });

  it("leaves picking mode when the pane is pointed at another file", async () => {
    const view = await pane();
    view.picking = true;
    view.picked.add("0:1");
    await view.setState({ path: "other.md", from: "INDEX", to: "WORKTREE", label: "y" }, {});
    expect(view.picking).toBe(false);
    expect(view.picked.size).toBe(0);
  });

  it("keeps picking mode across files when the setting says so", async () => {
    const view = await pane({ keepLineSelection: () => true });
    view.picking = true;
    view.picked.add("0:1");
    await view.setState({ path: "other.md", from: "INDEX", to: "WORKTREE", label: "y" }, {});
    expect(view.picking).toBe(true);
    // The picks go either way: they are coordinates into the diff that was on
    // screen, and against another file they would point at arbitrary lines.
    expect(view.picked.size).toBe(0);
  });

  it("does not reset anything when the pane reloads the SAME diff", async () => {
    const view = await pane();
    view.picking = true;
    view.picked.add("0:1");
    await view.setState({ path: "note.md", from: "INDEX", to: "WORKTREE", label: "x" }, {});
    expect(view.picking).toBe(true);
    expect(view.picked.size).toBe(1);
  });
});
