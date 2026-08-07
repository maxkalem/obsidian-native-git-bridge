import { describe, expect, it } from "vitest";
import { evaluateSparseSafety, isPathProtected, planSparseRepair } from "../src/git/sparseSafety";

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

describe("evaluateSparseSafety label reads BOTH porcelain columns", () => {
  const prot = ["Private/Mem"];

  // The bug this test exists for: a file added to the index and then removed
  // from the worktree by `sparse-checkout reapply` is `AD`. Reading only the
  // index column called it "added", the modal offered to delete a file that
  // was not on disk, the delete moved nothing, and the safety check kept
  // blocking every commit, push and sync with no way out inside the plugin.
  it("names an index entry whose file is missing from the worktree", () => {
    const r = evaluateSparseSafety("AD Private/Mem/handoff.md\n", "", prot);
    expect(r.violations[0]).toMatchObject({
      path: "Private/Mem/handoff.md",
      status: "added to the index, missing from the worktree",
      index: "A",
      worktree: "D",
    });
  });

  it("keeps both columns on the violation for the repair planner", () => {
    const r = evaluateSparseSafety("MM Private/Mem/a.md\n", "", prot);
    expect(r.violations[0]).toMatchObject({ index: "M", worktree: "M", status: "modified" });
  });

  it("does not say a single-state code twice", () => {
    const r = evaluateSparseSafety("?? Private/Mem/new.md\nUU Private/Mem/c.md\n", "", prot);
    expect(r.violations.map((v) => v.status)).toEqual(["untracked", "unmerged"]);
  });

  it("reports two genuinely different columns as two states", () => {
    const r = evaluateSparseSafety("MD Private/Mem/a.md\n", "", prot);
    expect(r.violations[0]!.status).toBe("modified to the index, missing from the worktree");
  });

  it("a staged-diff violation has no worktree column to report", () => {
    const r = evaluateSparseSafety("", "A\tPrivate/Mem/new.md\n", prot);
    expect(r.violations[0]).toMatchObject({ index: "A", source: "staged" });
    expect(r.violations[0]!.worktree).toBeUndefined();
  });
});

describe("planSparseRepair", () => {
  const prot = ["Private/Mem"];

  it("trashes an untracked file inside a protected directory", () => {
    const p = planSparseRepair(evaluateSparseSafety("?? Private/Mem/new.md\n", "", prot));
    expect(p).toEqual({ trash: ["Private/Mem/new.md"], unstage: [], blocked: [] });
  });

  // The reported bug, end to end: nothing to delete, everything to unstage.
  it("unstages an index entry whose file is not on disk, and trashes nothing", () => {
    const p = planSparseRepair(
      evaluateSparseSafety("AD Private/Mem/handoff.md\n", "A\tPrivate/Mem/handoff.md\n", prot)
    );
    expect(p.trash).toEqual([]);
    expect(p.unstage).toEqual(["Private/Mem/handoff.md"]);
    expect(p.blocked).toEqual([]);
  });

  it("does both when the addition is staged AND the file is still on disk", () => {
    const p = planSparseRepair(
      evaluateSparseSafety("A  Private/Mem/new.md\n", "A\tPrivate/Mem/new.md\n", prot)
    );
    expect(p.trash).toEqual(["Private/Mem/new.md"]);
    expect(p.unstage).toEqual(["Private/Mem/new.md"]);
  });

  it("refuses anything tracked in HEAD, with a reason instead of silence", () => {
    const p = planSparseRepair(
      evaluateSparseSafety(" M Private/Mem/old.md\n", "D\tPrivate/Mem/gone.md\n", prot)
    );
    expect(p.trash).toEqual([]);
    expect(p.unstage).toEqual([]);
    expect(p.blocked.map((b) => b.path).sort()).toEqual(["Private/Mem/gone.md", "Private/Mem/old.md"]);
    expect(p.blocked[0]!.reason).toContain("tracked in the last commit");
  });

  it("decides per PATH, not per violation: one tracked column blocks the whole path", () => {
    const p = planSparseRepair(
      evaluateSparseSafety("?? Private/Mem/x.md\n", "M\tPrivate/Mem/x.md\n", prot)
    );
    expect(p.trash).toEqual([]);
    expect(p.unstage).toEqual([]);
    expect(p.blocked).toHaveLength(1);
  });

  it("lists the same path once even when both sources report it", () => {
    const p = planSparseRepair(
      evaluateSparseSafety("A  Private/Mem/a.md\n", "A\tPrivate/Mem/a.md\n", prot)
    );
    expect(p.unstage).toEqual(["Private/Mem/a.md"]);
  });

  // AA (both added) and AU (added by us) carry an "A" in the index column and
  // would otherwise read as ordinary staged additions. Trashing the file and
  // dropping the index entry of a path that is mid-conflict destroys the merge
  // state, so every unmerged shape is blocked and named as a conflict.
  it.each([
    ["UU", "UU Private/Mem/c.md\n"],
    ["AA", "AA Private/Mem/c.md\n"],
    ["AU", "AU Private/Mem/c.md\n"],
    ["UA", "UA Private/Mem/c.md\n"],
    ["DU", "DU Private/Mem/c.md\n"],
    ["UD", "UD Private/Mem/c.md\n"],
    ["DD", "DD Private/Mem/c.md\n"],
  ])("blocks the unmerged state %s", (_code, raw) => {
    const p = planSparseRepair(evaluateSparseSafety(raw, "", prot));
    expect(p.trash).toEqual([]);
    expect(p.unstage).toEqual([]);
    expect(p.blocked).toHaveLength(1);
  });

  it("says a conflict is a conflict, not 'tracked in the last commit'", () => {
    const p = planSparseRepair(evaluateSparseSafety("AA Private/Mem/c.md\n", "", prot));
    expect(p.blocked[0]!.reason).toContain("conflicted");
  });

  it("plans nothing for a safe report", () => {
    expect(planSparseRepair(evaluateSparseSafety("", "", prot))).toEqual({
      trash: [],
      unstage: [],
      blocked: [],
    });
  });
});
