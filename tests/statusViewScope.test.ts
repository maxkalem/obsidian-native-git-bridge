import { describe, expect, it } from "vitest";
import { actionSlots, isRowAffected, type Group } from "../src/ui/StatusView";

/**
 * Group headers and folder rows must occupy the SAME action columns as the
 * file rows beneath them: [open] [stage/unstage] [discard]. The bug this
 * guards against is a header rendering only its real buttons, which pushed
 * "unstage all" and "stage all" into the file rows' open-file column.
 */
describe("actionSlots", () => {
  const groups: Group[] = ["conflicted", "staged", "unstaged", "untracked"];

  it("always reserves exactly three columns", () => {
    for (const g of groups) {
      expect(actionSlots("group", g)).toHaveLength(3);
      expect(actionSlots("folder", g)).toHaveLength(3);
      expect(actionSlots("group", g, false)).toHaveLength(3);
    }
  });

  it("never puts an action in the first column (that one belongs to 'open file')", () => {
    for (const g of groups) {
      expect(actionSlots("group", g)[0]?.icon).toBeNull();
      expect(actionSlots("folder", g)[0]?.icon).toBeNull();
    }
  });

  it("puts the group header's buttons in the same columns as a folder row's", () => {
    for (const g of groups) {
      const header = actionSlots("group", g).map((s) => s.action ?? null);
      const folder = actionSlots("folder", g).map((s) => s.action ?? null);
      // Same column for stage/unstage; the untracked group deliberately has no
      // bulk trash, but the column stays reserved so the count still lines up.
      expect(header[1]).toBe(folder[1]);
      expect(header[2] === folder[2] || header[2] === null).toBe(true);
    }
  });

  it("offers unstage (not discard) for staged content, in the middle column", () => {
    const s = actionSlots("group", "staged");
    expect(s[1]?.action).toBe("unstage");
    expect(s[2]?.icon).toBeNull();
  });

  it("renders an empty group as three placeholders", () => {
    expect(actionSlots("group", "untracked", false).every((s) => s.icon === null)).toBe(true);
  });

  it("does not offer a one-tap trash for every new file in the group", () => {
    expect(actionSlots("group", "untracked").some((s) => s.icon === "trash")).toBe(false);
    expect(actionSlots("folder", "untracked").some((s) => s.icon === "trash")).toBe(true);
  });
});

/**
 * Animation scoping for per-path operations in the status panel: a stage /
 * unstage / discard on one path must light up ONLY that row (or, for a
 * folder, the folder row and its visible descendants) — never sibling rows
 * that merely share the action name, and never the global toolbar buttons.
 */
describe("isRowAffected", () => {
  it("matches the acted file exactly", () => {
    expect(isRowAffected("Notes/a.md", "Notes/a.md")).toBe(true);
  });

  it("does not match sibling files", () => {
    expect(isRowAffected("Notes/a.md", "Notes/b.md")).toBe(false);
    expect(isRowAffected("Notes/a.md", "Other/a.md")).toBe(false);
  });

  it("matches rows inside an acted folder", () => {
    expect(isRowAffected("Notes", "Notes/a.md")).toBe(true);
    expect(isRowAffected("Notes", "Notes/deep/b.md")).toBe(true);
  });

  it("normalises the trailing slash git puts on untracked directories", () => {
    // Row is the directory itself, as listed in the untracked group.
    expect(isRowAffected("Private/Work/", "Private/Work/")).toBe(true);
    expect(isRowAffected("Private/Work", "Private/Work/")).toBe(true);
    // Action path from a menu carries the slash, rows underneath do not.
    expect(isRowAffected("Private/Work/", "Private/Work/x.md")).toBe(true);
  });

  it("is segment-aware: 'Doc' must not match 'Docs/a.md'", () => {
    expect(isRowAffected("Doc", "Docs/a.md")).toBe(false);
    expect(isRowAffected("Notes/a", "Notes/a.md")).toBe(false);
  });

  it("does not light up a folder row while one of its files is acted on", () => {
    // Spec: a FILE action animates only the selected file row.
    expect(isRowAffected("Notes/a.md", "Notes/")).toBe(false);
  });

  it("never matches without an action path (global or path-less operations)", () => {
    expect(isRowAffected(undefined, "Notes/a.md")).toBe(false);
    expect(isRowAffected("", "Notes/a.md")).toBe(false);
    expect(isRowAffected("/", "Notes/a.md")).toBe(false);
  });
});
