import { describe, expect, it } from "vitest";
import { isRowAffected } from "../src/ui/StatusView";

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
