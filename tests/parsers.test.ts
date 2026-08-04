import { describe, expect, it } from "vitest";
import {
  countSkipWorktree,
  parseLastCommit,
  parseNameStatus,
  parseSparseState,
  parseStatusPorcelainV1,
  parseStatusPorcelainV2,
  unquoteGitPath,
} from "../src/git/parsers";

describe("unquoteGitPath", () => {
  it("passes through unquoted paths", () => {
    expect(unquoteGitPath("notes/Ideas.md")).toBe("notes/Ideas.md");
  });
  it("unquotes escaped quotes and backslashes", () => {
    expect(unquoteGitPath('"a\\"b\\\\c.md"')).toBe('a"b\\c.md');
  });
  it("decodes octal UTF-8 sequences (unicode filenames)", () => {
    // "Füße.md" as git prints it with quotePath
    expect(unquoteGitPath('"F\\303\\274\\303\\237e.md"')).toBe("Füße.md");
  });
  it("handles spaces (kept verbatim inside quotes)", () => {
    expect(unquoteGitPath('"my note.md"')).toBe("my note.md");
  });
});

describe("parseStatusPorcelainV2", () => {
  const sample = [
    "# branch.oid 1234567890abcdef1234567890abcdef12345678",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 aaaa bbbb notes/changed.md",
    "1 M. N... 100644 100644 100644 aaaa bbbb notes/staged.md",
    "1 MM N... 100644 100644 100644 aaaa bbbb notes/both.md",
    "2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.md\told name.md",
    "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.md",
    "? untracked note.md",
  ].join("\n");

  it("parses branch and ahead/behind", () => {
    const s = parseStatusPorcelainV2(sample);
    expect(s.branch).toBe("main");
    expect(s.upstream).toBe("origin/main");
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.detached).toBe(false);
  });
  it("classifies staged/unstaged/untracked/conflicted", () => {
    const s = parseStatusPorcelainV2(sample);
    expect(s.unstaged.map((e) => e.path)).toContain("notes/changed.md");
    expect(s.staged.map((e) => e.path)).toContain("notes/staged.md");
    expect(s.staged.map((e) => e.path)).toContain("notes/both.md");
    expect(s.unstaged.map((e) => e.path)).toContain("notes/both.md");
    expect(s.untracked).toEqual(["untracked note.md"]);
    expect(s.conflicted.map((e) => e.path)).toEqual(["conflict.md"]);
  });
  it("parses renames with original path", () => {
    const s = parseStatusPorcelainV2(sample);
    const r = s.staged.find((e) => e.index === "R");
    expect(r?.path).toBe("new name.md");
    expect(r?.origPath).toBe("old name.md");
  });
  it("handles detached head", () => {
    const s = parseStatusPorcelainV2("# branch.head (detached)\n");
    expect(s.detached).toBe(true);
    expect(s.branch).toBeUndefined();
  });
});

describe("parseStatusPorcelainV1", () => {
  it("parses simple entries", () => {
    const es = parseStatusPorcelainV1(" D Private/AgentsMemory/x.md\nM  Projects/Backus/y.md\n?? new.md\n");
    expect(es).toHaveLength(3);
    expect(es[0]).toMatchObject({ path: "Private/AgentsMemory/x.md", index: ".", worktree: "D" });
    expect(es[1]).toMatchObject({ path: "Projects/Backus/y.md", index: "M", worktree: "." });
    expect(es[2]).toMatchObject({ path: "new.md", index: "?", worktree: "?" });
  });
  it("parses renames", () => {
    const es = parseStatusPorcelainV1("R  old.md -> new.md\n");
    expect(es[0]).toMatchObject({ path: "new.md", origPath: "old.md", index: "R" });
  });
});

describe("parseNameStatus", () => {
  it("parses deletions and renames", () => {
    const es = parseNameStatus("D\tPrivate/AgentsMemory/a.md\nR100\told.md\tnew.md\n");
    expect(es[0]).toMatchObject({ path: "Private/AgentsMemory/a.md", index: "D" });
    expect(es[1]).toMatchObject({ path: "new.md", origPath: "old.md", index: "R" });
  });
});

describe("sparse state", () => {
  it("counts skip-worktree entries", () => {
    expect(countSkipWorktree("H a.md\nS b.md\nS c.md\n")).toBe(2);
  });
  it("parses combined sparse state", () => {
    const st = parseSparseState({
      sparseEnabled: "true\n",
      sparseCone: "false",
      sparseList: "/*\n!Private/AgentsMemory/\n",
      lsFilesV: "S hidden.md\n",
    });
    expect(st.enabled).toBe(true);
    expect(st.coneMode).toBe(false);
    expect(st.patterns).toEqual(["/*", "!Private/AgentsMemory/"]);
    expect(st.skipWorktreeCount).toBe(1);
  });
});

describe("parseLastCommit", () => {
  it("parses hash/date/subject", () => {
    const c = parseLastCommit("0123abc4567890def\t2026-08-01T10:00:00+02:00\tfix: some subject\twith tab\n");
    expect(c?.hash).toBe("0123abc4567890def");
    expect(c?.subject).toBe("fix: some subject\twith tab");
  });
  it("returns undefined on garbage", () => {
    expect(parseLastCommit("")).toBeUndefined();
    expect(parseLastCommit("not-a-hash\tx\ty")).toBeUndefined();
  });
});

describe("untracked directory paths from porcelain v2", () => {
  it("keeps the trailing slash so the UI can show a folder name", () => {
    const s = parseStatusPorcelainV2("? Private/Work/\n? note.md\n");
    expect(s.untracked).toEqual(["Private/Work/", "note.md"]);
  });
});
