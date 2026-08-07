import { describe, expect, it } from "vitest";
import {
  describePreviousRepo,
  daysSince,
  formatSize,
  isPreviousRepoDir,
  parsePreviousRepo,
  reposToRemindAbout,
  REMIND_INTERVAL_MS,
  type PreviousRepo,
} from "../src/git/previousRepos";

const repo = (over: Partial<PreviousRepo> = {}): PreviousRepo => ({
  dir: "previous-git-20260807T101500Z",
  createdAt: "2026-08-07T10:15:00Z",
  sizeKb: 188416,
  commits: 1240,
  branch: "main",
  lastCommit: "abc1234 2026-08-01 fix typo",
  ...over,
});

describe("parsePreviousRepo", () => {
  it("reads a manifest the runner wrote", () => {
    const r = parsePreviousRepo(JSON.stringify(repo()));
    expect(r).toEqual(repo());
  });

  it("rejects anything whose directory name is not the runner's", () => {
    // The name becomes a delete target, so it is validated, not trusted.
    for (const dir of ["../../etc", "previous-git-x", "notes", "previous-git-2026", ""]) {
      expect(parsePreviousRepo(JSON.stringify(repo({ dir }))), dir).toBeNull();
    }
    expect(parsePreviousRepo("not json")).toBeNull();
    expect(parsePreviousRepo("[]")).toBeNull();
  });

  it("survives a manifest with missing or wrong-typed fields", () => {
    const r = parsePreviousRepo('{"dir":"previous-git-20260807T101500Z","sizeKb":"big","commits":-4}');
    expect(r).toMatchObject({ sizeKb: 0, commits: 0, branch: "", lastCommit: "" });
  });

  it("validates directory names on their own", () => {
    expect(isPreviousRepoDir("previous-git-20260807T101500Z")).toBe(true);
    expect(isPreviousRepoDir("previous-git-20260807T101500Z/../..")).toBe(false);
  });
});

describe("formatSize", () => {
  it("says something a person can act on", () => {
    expect(formatSize(0)).toBe("unknown size");
    expect(formatSize(512)).toBe("512 KB");
    expect(formatSize(2048)).toBe("2.0 MB");
    expect(formatSize(188416)).toBe("184 MB");
    expect(formatSize(2 * 1024 * 1024)).toBe("2.0 GB");
  });
});

describe("describePreviousRepo", () => {
  it("puts size, commits, branch and age on one line", () => {
    const line = describePreviousRepo(repo(), new Date("2026-08-09T10:15:00Z"));
    expect(line).toContain("184 MB");
    expect(line).toContain("1240 commits");
    expect(line).toContain("main");
    expect(line).toContain("2 days ago");
  });
  it("handles a manifest with no usable date", () => {
    expect(describePreviousRepo(repo({ createdAt: "" }))).not.toContain("NaN");
    expect(daysSince("nonsense")).toBeNull();
  });
});

describe("reposToRemindAbout", () => {
  const now = Date.parse("2026-08-09T12:00:00Z");

  it("reminds when a day has passed", () => {
    const due = reposToRemindAbout([repo()], { lastRemindedAt: now - REMIND_INTERVAL_MS - 1, dismissed: [] }, now);
    expect(due).toHaveLength(1);
  });

  it("stays quiet for the rest of the day", () => {
    expect(reposToRemindAbout([repo()], { lastRemindedAt: now - 60_000, dismissed: [] }, now)).toEqual([]);
  });

  it("never mentions one the user has waved away", () => {
    const due = reposToRemindAbout([repo()], { lastRemindedAt: 0, dismissed: [repo().dir] }, now);
    expect(due).toEqual([]);
  });

  it("mentions the others even when one is dismissed", () => {
    const other = repo({ dir: "previous-git-20260808T101500Z" });
    const due = reposToRemindAbout([repo(), other], { lastRemindedAt: 0, dismissed: [repo().dir] }, now);
    expect(due).toEqual([other]);
  });

  it("says nothing when there is nothing set aside", () => {
    expect(reposToRemindAbout([], { lastRemindedAt: 0, dismissed: [] }, now)).toEqual([]);
  });
});
