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

describe("single-child chain compression", () => {
  it("shows a folder that only holds another folder as one combined path", () => {
    const t = buildPathTree(paths(["Private/Inbox/a.md", "Private/Inbox/b.md"]), (i) => i.path);
    expect(t.folders).toHaveLength(1);
    expect(t.folders[0]!.name).toBe("Private/Inbox");
    // The surviving node addresses the DEEPEST directory, so folder actions
    // still target the directory whose files are listed.
    expect(t.folders[0]!.path).toBe("Private/Inbox");
    expect(t.folders[0]!.items.map((i) => i.path)).toEqual([
      "Private/Inbox/a.md",
      "Private/Inbox/b.md",
    ]);
    expect(t.folders[0]!.children).toEqual([]);
  });

  it("compresses several levels at once", () => {
    const t = buildPathTree(paths(["a/b/c/d/x.md"]), (i) => i.path);
    expect(t.folders[0]!.name).toBe("a/b/c/d");
    expect(t.folders[0]!.path).toBe("a/b/c/d");
    expect(t.folders[0]!.count).toBe(1);
  });

  it("stops at a folder that has files of its own", () => {
    const t = buildPathTree(paths(["a/own.md", "a/b/x.md"]), (i) => i.path);
    expect(t.folders[0]!.name).toBe("a");
    expect(t.folders[0]!.children.map((c) => c.name)).toEqual(["b"]);
  });

  it("stops at a folder that branches", () => {
    const t = buildPathTree(paths(["a/b/x.md", "a/c/y.md"]), (i) => i.path);
    expect(t.folders[0]!.name).toBe("a");
    expect(t.folders[0]!.children.map((c) => c.name)).toEqual(["b", "c"]);
  });

  it("compresses inside a deeper branch too", () => {
    const t = buildPathTree(paths(["a/own.md", "a/b/c/x.md"]), (i) => i.path);
    expect(t.folders[0]!.children[0]!.name).toBe("b/c");
    expect(t.folders[0]!.children[0]!.path).toBe("a/b/c");
  });
});
