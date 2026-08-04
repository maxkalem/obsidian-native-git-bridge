import { describe, expect, it } from "vitest";
import {
  isValidCommitHash,
  isValidRefName,
  isValidRequestId,
  validateProtectedPaths,
  validateRepoRelativePath,
} from "../src/settings/pathValidation";

describe("validateRepoRelativePath", () => {
  it("accepts and normalizes good paths", () => {
    expect(validateRepoRelativePath("Private/Hidden")).toEqual({ ok: true, normalized: "Private/Hidden" });
    expect(validateRepoRelativePath("./Projects//Archive/")).toEqual({ ok: true, normalized: "Projects/Archive" });
    expect(validateRepoRelativePath("Projects\\Archive")).toEqual({ ok: true, normalized: "Projects/Archive" });
    expect(validateRepoRelativePath("ünïcode/nøte s.md")).toEqual({ ok: true, normalized: "ünïcode/nøte s.md" });
  });
  it("rejects absolute paths", () => {
    expect(validateRepoRelativePath("/etc/passwd").ok).toBe(false);
    expect(validateRepoRelativePath("C:\\vault").ok).toBe(false);
    expect(validateRepoRelativePath("~/notes").ok).toBe(false);
  });
  it("rejects traversal and empties", () => {
    expect(validateRepoRelativePath("a/../b").ok).toBe(false);
    expect(validateRepoRelativePath("..").ok).toBe(false);
    expect(validateRepoRelativePath("").ok).toBe(false);
    expect(validateRepoRelativePath("   ").ok).toBe(false);
    expect(validateRepoRelativePath(".").ok).toBe(false);
  });
  it("rejects .git and control characters", () => {
    expect(validateRepoRelativePath(".git/config").ok).toBe(false);
    expect(validateRepoRelativePath("a\u0000b").ok).toBe(false);
    expect(validateRepoRelativePath("a\nb").ok).toBe(false);
  });
  it("rejects .git as ANY segment, case-insensitively (Android storage is case-insensitive)", () => {
    expect(validateRepoRelativePath(".GIT/config").ok).toBe(false);
    expect(validateRepoRelativePath(".Git/hooks/pre-commit").ok).toBe(false);
    expect(validateRepoRelativePath("sub/.git/config").ok).toBe(false);
    expect(validateRepoRelativePath("sub/.GiT/hooks/x").ok).toBe(false);
    expect(validateRepoRelativePath("nested/repo/.git").ok).toBe(false);
    // Lookalikes that are NOT .git stay valid.
    expect(validateRepoRelativePath(".gitignore").ok).toBe(true);
    expect(validateRepoRelativePath("sub/.github/workflows/x.yml").ok).toBe(true);
  });
  it("rejects git pathspec magic (leading ':')", () => {
    // ':/' would address the whole repo; ':(exclude)x' / ':!x' invert meaning.
    expect(validateRepoRelativePath(":/").ok).toBe(false);
    expect(validateRepoRelativePath(":/Notes/a.md").ok).toBe(false);
    expect(validateRepoRelativePath(":(exclude)Private").ok).toBe(false);
    expect(validateRepoRelativePath(":!Private").ok).toBe(false);
    // ':' elsewhere in a name is a plain character ("a:b.md" is already
    // rejected by the drive-letter rule; a longer prefix is not).
    expect(validateRepoRelativePath("ab:c.md").ok).toBe(true);
  });
});

describe("validateProtectedPaths", () => {
  it("normalizes and dedupes", () => {
    const r = validateProtectedPaths(["Private/Hidden/", "./Private/Hidden", "Projects/Archive"]);
    expect(r).toEqual({ ok: true, normalized: ["Private/Hidden", "Projects/Archive"] });
  });
  it("reports the offending entry", () => {
    const r = validateProtectedPaths(["good", "/bad"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offending).toBe("/bad");
  });
});

describe("ref/hash/id validators", () => {
  it("commit hashes", () => {
    expect(isValidCommitHash("abc123")).toBe(true);
    expect(isValidCommitHash("g123")).toBe(false);
    expect(isValidCommitHash("")).toBe(false);
  });
  it("ref names", () => {
    expect(isValidRefName("main")).toBe(true);
    expect(isValidRefName("feature/x-1.2")).toBe(true);
    expect(isValidRefName("-evil")).toBe(false);
    expect(isValidRefName("a..b")).toBe(false);
    expect(isValidRefName("a b")).toBe(false);
    expect(isValidRefName("x.lock")).toBe(false);
    expect(isValidRefName("a@{1}")).toBe(false);
  });
  it("request ids", () => {
    expect(isValidRequestId("r-20260803T101500Z-ab12cd")).toBe(true);
    expect(isValidRequestId("r-../../etc")).toBe(false);
    expect(isValidRequestId("nope")).toBe(false);
  });
});