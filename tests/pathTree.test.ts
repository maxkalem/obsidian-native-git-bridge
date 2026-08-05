import { describe, expect, it } from "vitest";
import { buildPathTree } from "../src/ui/pathTree";

const paths = (ps: string[]) => ps.map((p) => ({ path: p }));

describe("buildPathTree", () => {
  it("separates root items from nested folders", () => {
    const t = buildPathTree(paths(["a.md", "Notes/b.md", "Notes/Deep/c.md"]), (i) => i.path);
    expect(t.rootItems.map((i) => i.path)).toEqual(["a.md"]);
    expect(t.folders).toHaveLength(1);
    const notes = t.folders[0]!;
    expect(notes.name).toBe("Notes");
    expect(notes.path).toBe("Notes");
    expect(notes.items.map((i) => i.path)).toEqual(["Notes/b.md"]);
    expect(notes.children).toHaveLength(1);
    expect(notes.children[0]!.path).toBe("Notes/Deep");
  });

  it("counts every item under a node (collapsed-folder badge)", () => {
    const t = buildPathTree(
      paths(["N/a.md", "N/b.md", "N/D/c.md", "N/D/E/d.md"]),
      (i) => i.path
    );
    expect(t.folders[0]!.count).toBe(4);
    expect(t.folders[0]!.children[0]!.count).toBe(2);
  });

  it("treats trailing-slash directory entries as leaves of their parent", () => {
    // git reports a fully untracked directory as "Private/Work/"; when nothing
    // enumerated its contents it must stay visible as a leaf under Private.
    const t = buildPathTree(paths(["Private/Work/"]), (i) => i.path);
    expect(t.folders[0]!.name).toBe("Private");
    expect(t.folders[0]!.items.map((i) => i.path)).toEqual(["Private/Work/"]);
  });

  it("sorts folders by name on every level", () => {
    const t = buildPathTree(paths(["b/x.md", "a/y.md", "a/c/z.md", "a/b/w.md"]), (i) => i.path);
    expect(t.folders.map((f) => f.name)).toEqual(["a", "b"]);
    expect(t.folders[0]!.children.map((f) => f.name)).toEqual(["b", "c"]);
  });

  it("handles an empty input", () => {
    const t = buildPathTree([], () => "");
    expect(t.rootItems).toEqual([]);
    expect(t.folders).toEqual([]);
  });
});
