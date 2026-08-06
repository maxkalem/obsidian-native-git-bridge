import { describe, expect, it } from "vitest";
import { evaluateSparseSafety, isPathProtected } from "../src/git/sparseSafety";

describe("isPathProtected", () => {
  const prot = ["Private/Hidden", "Projects/Arch"];
  it("matches exact and nested paths", () => {
    expect(isPathProtected("Private/Hidden", prot)).toBe(true);
    expect(isPathProtected("Private/Hidden/deep/file.md", prot)).toBe(true);
  });
  it("does not match sibling prefixes", () => {
    expect(isPathProtected("Private/HiddenBackup/x.md", prot)).toBe(false);
    expect(isPathProtected("Projects/Archive", prot)).toBe(false);
  });
});

describe("evaluateSparseSafety", () => {
  const prot = ["Private/Hidden", "Projects/Archive"];

  it("is safe when both raw outputs are empty (sparse omissions are NOT deletions)", () => {
    const r = evaluateSparseSafety("", "", prot);
    expect(r.safe).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("blocks when a protected path is deleted in the worktree", () => {
    const r = evaluateSparseSafety(" D Private/Hidden/mem.md\n", "", prot);
    expect(r.safe).toBe(false);
    expect(r.violations[0]).toMatchObject({
      path: "Private/Hidden/mem.md",
      status: "deleted",
      source: "worktree",
    });
  });

  it("blocks when a protected path is staged for deletion", () => {
    const r = evaluateSparseSafety("", "D\tProjects/Archive/spec.md\n", prot);
    expect(r.safe).toBe(false);
    expect(r.violations[0]).toMatchObject({
      path: "Projects/Archive/spec.md",
      status: "deleted",
      source: "staged",
    });
  });

  it("blocks on modification, addition and rename alike", () => {
    const r = evaluateSparseSafety(
      "M  Private/Hidden/a.md\n?? Private/Hidden/new.md\n",
      "R100\tProjects/Archive/old.md\tProjects/Archive/new.md\n",
      prot
    );
    expect(r.safe).toBe(false);
    expect(r.violations.map((v) => v.status).sort()).toEqual(["modified", "renamed", "untracked"]);
  });

  it("handles quoted unicode paths from git output", () => {
    const r = evaluateSparseSafety(' D "Private/Hidden/F\\303\\274\\303\\237e.md"\n', "", prot);
    expect(r.safe).toBe(false);
    expect(r.violations[0]!.path).toBe("Private/Hidden/Füße.md");
  });
});

describe("safety-modal recovery eligibility", () => {
  // The modal offers "delete locally" only for paths that are NEW here.
  // Deleting a tracked protected file would create a staged deletion, which
  // is precisely what the gate exists to stop, so those are excluded.
  const isNew = (s: string) => s === "untracked" || s === "added";
  const deletable = (report: ReturnType<typeof evaluateSparseSafety>) => {
    const risky = new Set(
      report.violations.filter((v) => !isNew(v.status)).map((v) => v.path)
    );
    return [
      ...new Set(
        report.violations
          .filter((v) => isNew(v.status) && !risky.has(v.path))
          .map((v) => v.path)
      ),
    ];
  };

  it("offers deletion for an untracked file inside a protected directory", () => {
    const r = evaluateSparseSafety("?? Private/Mem/new.md\n", "", ["Private/Mem"]);
    expect(deletable(r)).toEqual(["Private/Mem/new.md"]);
  });

  it("offers deletion for a newly added (staged) file", () => {
    const r = evaluateSparseSafety("", "A\tPrivate/Mem/new.md\n", ["Private/Mem"]);
    expect(deletable(r)).toEqual(["Private/Mem/new.md"]);
  });

  it("never offers deletion for a modified or deleted tracked path", () => {
    const r = evaluateSparseSafety(" M Private/Mem/old.md\n", "D\tPrivate/Mem/gone.md\n", ["Private/Mem"]);
    expect(deletable(r)).toEqual([]);
  });

  it("excludes a path that is both added and modified (mixed states are not safe to delete)", () => {
    const r = evaluateSparseSafety("?? Private/Mem/x.md\n", "M\tPrivate/Mem/x.md\n", ["Private/Mem"]);
    expect(deletable(r)).toEqual([]);
  });
});
