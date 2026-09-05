import { describe, expect, it } from "vitest";
import { computeExplorerSigns, signLetter, signTitle } from "../src/ui/explorerSigns";
import { ROOTS_COINCIDE, type RootOffset } from "../src/git/repoRoot";
import type { GitStatusSummary } from "../src/types";

/**
 * The lookup table behind the file explorer's signs. Pure, so this is where
 * the precedence and the folder aggregation are proven; the controller that
 * paints it is tested against the fake DOM in mainOrchestration.
 */

function status(partial: Partial<GitStatusSummary>): GitStatusSummary {
  return {
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ...partial,
  };
}

describe("computeExplorerSigns", () => {
  it("is empty without a status, and asks nothing of the caller", () => {
    const t = computeExplorerSigns(undefined, ROOTS_COINCIDE);
    expect(t.files.size).toBe(0);
    expect(t.folders.size).toBe(0);
  });

  it("marks each group with its own letter", () => {
    const t = computeExplorerSigns(
      status({
        staged: [
          { path: "a/new.md", index: "A", worktree: "." },
          { path: "a/gone.md", index: "D", worktree: "." },
          { path: "a/edited.md", index: "M", worktree: "." },
        ],
        unstaged: [
          { path: "b/dirty.md", index: ".", worktree: "M" },
          { path: "b/removed.md", index: ".", worktree: "D" },
        ],
        untracked: ["loose.md"],
        conflicted: [{ path: "c/fight.md", index: "U", worktree: "U" }],
      }),
      ROOTS_COINCIDE
    );
    expect(t.files.get("a/new.md")).toBe("added");
    expect(t.files.get("a/gone.md")).toBe("deleted");
    expect(t.files.get("a/edited.md")).toBe("modified");
    expect(t.files.get("b/dirty.md")).toBe("modified");
    expect(t.files.get("b/removed.md")).toBe("deleted");
    expect(t.files.get("loose.md")).toBe("untracked");
    expect(t.files.get("c/fight.md")).toBe("conflict");
    expect(signLetter("conflict")).toBe("!");
    expect(signLetter("modified")).toBe("M");
    expect(signTitle("changed")).toBe("Changes inside");
  });

  it("lets the sign the user must act on win when a file is in several groups", () => {
    // git lists a conflicted file under the changes too; a file both staged
    // and dirty is listed twice; a deletion that is also "modified" is gone.
    const t = computeExplorerSigns(
      status({
        staged: [
          { path: "x.md", index: "M", worktree: "M" },
          { path: "y.md", index: "A", worktree: "D" },
        ],
        unstaged: [
          { path: "x.md", index: "M", worktree: "M" },
          { path: "y.md", index: "A", worktree: "D" },
          { path: "z.md", index: ".", worktree: "M" },
        ],
        conflicted: [{ path: "z.md", index: "U", worktree: "U" }],
      }),
      ROOTS_COINCIDE
    );
    expect(t.files.get("x.md")).toBe("modified");
    expect(t.files.get("y.md")).toBe("deleted");
    expect(t.files.get("z.md")).toBe("conflict");
  });

  it("turns a collapsed untracked folder back into its files when the runner listed them", () => {
    const t = computeExplorerSigns(
      status({
        untracked: ["New Folder/"],
        untrackedChildren: { "New Folder/": ["New Folder/idea.md", "New Folder/deep/two.md"] },
      }),
      ROOTS_COINCIDE
    );
    expect(t.files.get("New Folder/idea.md")).toBe("untracked");
    expect(t.files.get("New Folder/deep/two.md")).toBe("untracked");
    expect(t.files.has("New Folder")).toBe(false);
    expect(t.folders.get("New Folder")).toBe("changed");
    expect(t.folders.get("New Folder/deep")).toBe("changed");
  });

  it("marks the folder row itself when an older runner listed no children", () => {
    const t = computeExplorerSigns(status({ untracked: ["Fresh/"] }), ROOTS_COINCIDE);
    expect(t.files.get("Fresh")).toBe("untracked");
  });

  it("a staged rename marks the new name and the old one as gone", () => {
    const t = computeExplorerSigns(
      status({ staged: [{ path: "b.md", origPath: "a.md", index: "R", worktree: "." }] }),
      ROOTS_COINCIDE
    );
    expect(t.files.get("b.md")).toBe("modified");
    expect(t.files.get("a.md")).toBe("deleted");
  });

  it("every ancestor folder carries a dot, and a conflict below outranks everything", () => {
    const t = computeExplorerSigns(
      status({
        unstaged: [{ path: "Notes/2026/sep/a.md", index: ".", worktree: "M" }],
        conflicted: [{ path: "Notes/2026/oct/b.md", index: "U", worktree: "U" }],
        untracked: ["Inbox/x.md"],
      }),
      ROOTS_COINCIDE
    );
    expect(t.folders.get("Notes")).toBe("conflict");
    expect(t.folders.get("Notes/2026")).toBe("conflict");
    expect(t.folders.get("Notes/2026/sep")).toBe("changed");
    expect(t.folders.get("Notes/2026/oct")).toBe("conflict");
    expect(t.folders.get("Inbox")).toBe("changed");
    // The vault root is not a folder row.
    expect(t.folders.has("")).toBe(false);
  });

  it("keys the table by VAULT path, and drops repository files the vault cannot name", () => {
    const vaultInRepo: RootOffset = { kind: "vault-in-repo", offset: "docs" };
    const t = computeExplorerSigns(
      status({
        unstaged: [
          { path: "docs/Notes/a.md", index: ".", worktree: "M" },
          { path: "src/main.ts", index: ".", worktree: "M" },
        ],
      }),
      vaultInRepo
    );
    expect(t.files.get("Notes/a.md")).toBe("modified");
    expect(t.files.has("src/main.ts")).toBe(false);
    expect(t.folders.get("Notes")).toBe("changed");
    expect(t.folders.has("src")).toBe(false);
    const repoInVault: RootOffset = { kind: "repo-in-vault", offset: "project" };
    const u = computeExplorerSigns(status({ untracked: ["a.md"] }), repoInVault);
    expect(u.files.get("project/a.md")).toBe("untracked");
    expect(u.folders.get("project")).toBe("changed");
  });
});
