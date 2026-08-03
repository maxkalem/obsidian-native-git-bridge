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
    expect(validateRepoRelativePath("Private/AgentsMemory")).toEqual({ ok: true, normalized: "Private/AgentsMemory" });
    expect(validateRepoRelativePath("./Projects//Backus/")).toEqual({ ok: true, normalized: "Projects/Backus" });
    expect(validateRepoRelativePath("Projects\\Backus")).toEqual({ ok: true, normalized: "Projects/Backus" });
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
});

describe("validateProtectedPaths", () => {
  it("normalizes and dedupes", () => {
    const r = validateProtectedPaths(["Private/AgentsMemory/", "./Private/AgentsMemory", "Projects/Backus"]);
    expect(r).toEqual({ ok: true, normalized: ["Private/AgentsMemory", "Projects/Backus"] });
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
