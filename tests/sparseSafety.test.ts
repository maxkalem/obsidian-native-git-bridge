import { describe, expect, it } from "vitest";
import { evaluateSparseSafety, isPathProtected } from "../src/git/sparseSafety";

describe("isPathProtected", () => {
  const prot = ["Private/AgentsMemory", "Projects/Backus"];
  it("matches exact and nested paths", () => {
    expect(isPathProtected("Private/AgentsMemory", prot)).toBe(true);
    expect(isPathProtected("Private/AgentsMemory/deep/file.md", prot)).toBe(true);
  });
  it("does not match sibling prefixes", () => {
    expect(isPathProtected("Private/AgentsMemoryBackup/x.md", prot)).toBe(false);
    expect(isPathProtected("Projects/BackusNaur", prot)).toBe(false);
  });
});

describe("evaluateSparseSafety", () => {
  const prot = ["Private/AgentsMemory", "Projects/Backus"];

  it("is safe when both raw outputs are empty (sparse omissions are NOT deletions)", () => {
    const r = evaluateSparseSafety("", "", prot);
    expect(r.safe).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("blocks when a protected path is deleted in the worktree", () => {
    const r = evaluateSparseSafety(" D Private/AgentsMemory/mem.md\n", "", prot);
    expect(r.safe).toBe(false);
    expect(r.violations[0]).toMatchObject({
      path: "Private/AgentsMemory/mem.md",
      status: "deleted",
      source: "worktree",
    });
  });

  it("blocks when a protected path is staged for deletion", () => {
    const r = evaluateSparseSafety("", "D\tProjects/Backus/spec.md\n", prot);
    expect(r.safe).toBe(false);
    expect(r.violations[0]).toMatchObject({
      path: "Projects/Backus/spec.md",
      status: "deleted",
      source: "staged",
    });
  });

  it("blocks on modification, addition and rename alike", () => {
    const r = evaluateSparseSafety(
      "M  Private/AgentsMemory/a.md\n?? Private/AgentsMemory/new.md\n",
      "R100\tProjects/Backus/old.md\tProjects/Backus/new.md\n",
      prot
    );
    expect(r.safe).toBe(false);
    expect(r.violations.map((v) => v.status).sort()).toEqual(["modified", "renamed", "untracked"]);
  });

  it("handles quoted unicode paths from git output", () => {
    const r = evaluateSparseSafety(' D "Private/AgentsMemory/F\\303\\274\\303\\237e.md"\n', "", prot);
    expect(r.safe).toBe(false);
    expect(r.violations[0]!.path).toBe("Private/AgentsMemory/Füße.md");
  });
});
