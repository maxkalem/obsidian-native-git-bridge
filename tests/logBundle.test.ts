import { describe, expect, it } from "vitest";
import { buildLogBundle, logBundleName, RUNNER_LOG_TAIL_BYTES } from "../src/ops/logBundle";
import type { LogEntry } from "../src/ops/OperationLog";

/**
 * The bundle exists because a report from a device used to arrive as the
 * visible list and nothing else, which is the one third of the evidence that
 * least often contains the answer. The failure that prompted it — an abort that
 * would not go through — was explained by the SEQUENCE in the log plus git's
 * stderr, and neither travelled.
 */

const entries: LogEntry[] = [
  { ts: "2026-08-09T16:48:25Z", level: "info", action: "abort-merge", message: "Queued request r-1." },
  {
    ts: "2026-08-09T16:48:29Z",
    level: "error",
    action: "abort-merge",
    message: "Request r-1 finished ok=false exit=1.",
    detail: "GIT_FAILED: git merge --abort failed.\nerror: Entry 'Private/x' would be overwritten",
  },
];

const parts = {
  now: "2026-08-09T18:00:00.000Z",
  facts: { "Plugin version": "0.6.2", Platform: "Android app" },
  entries,
  runnerLog: "2026-08-09T16:48:29Z abort-merge start\n2026-08-09T16:48:29Z abort-merge fail\n",
};

describe("the log bundle", () => {
  it("carries all three sources, not just the visible list", () => {
    const out = buildLogBundle(parts);
    expect(out).toContain("Plugin version: 0.6.2");
    expect(out).toContain("Request r-1 finished ok=false");
    // The stderr behind the entry, which is where the reason actually is.
    expect(out).toContain("error: Entry 'Private/x' would be overwritten");
    // And the Termux side, which never reaches a result file at all.
    expect(out).toContain("abort-merge fail");
  });

  it("indents an entry's output so it cannot read as more entries", () => {
    const out = buildLogBundle(parts);
    expect(out).toContain("    GIT_FAILED: git merge --abort failed.");
  });

  it("says so when the runner has never written a log to this vault", () => {
    const out = buildLogBundle({ ...parts, runnerLog: null });
    expect(out).toContain("(not present");
    // Absence named as absence, never rendered as an empty section that reads
    // like a runner which did nothing.
    expect(out).not.toContain("abort-merge fail");
  });

  it("redacts credentials that reached the Termux log", () => {
    // The plugin's own entries are redacted on the way in. This file is not:
    // it comes from git's own output in Termux, where a remote URL carrying a
    // token can and does appear.
    const out = buildLogBundle({
      ...parts,
      runnerLog: "fatal: could not read from https://maxkalem:ghp_secret@github.com/x/y.git\n",
    });
    expect(out).not.toContain("ghp_secret");
    expect(out).toContain("github.com/x/y.git");
  });

  it("keeps the TAIL of an oversized runner log, cut at a line boundary", () => {
    const big = "x".repeat(RUNNER_LOG_TAIL_BYTES) + "\nlast line here\n";
    const out = buildLogBundle({ ...parts, runnerLog: big });
    expect(out).toContain("last line here");
    expect(out).toContain("trimmed to the last");
    // Cut at a newline, so the section never opens mid-line.
    const section = out.slice(out.indexOf("trimmed to the last"));
    expect(section.split("\n")[1]).toBe("last line here");
  });

  it("names an empty log as empty rather than printing nothing", () => {
    expect(buildLogBundle({ ...parts, entries: [] })).toContain("(empty)");
  });

  it("carries the progress streams, which are the only account of an operation that timed out", () => {
    // A request killed by the timeout leaves no result, so no entry detail and
    // no runner verdict — but its stream stops at the percentage it reached,
    // which is the difference between "it was working" and "it was stuck".
    const out = buildLogBundle({
      ...parts,
      progress: [
        { id: "r-20260810T093000Z-aa", text: "repair: scanning the object store\nrepair: refetching" },
        { id: "r-20260810T092000Z-bb", text: "sync: fetching from origin" },
      ],
    });
    expect(out).toContain("## Progress streams (2, newest first)");
    expect(out).toContain("### r-20260810T093000Z-aa");
    expect(out).toContain("repair: refetching");
    expect(out).toContain("sync: fetching from origin");
  });

  it("says why there are no streams instead of showing a bare heading", () => {
    // Absent because the runner is older, or because nothing has run — either
    // way an empty section reads like a bridge that produced nothing.
    const out = buildLogBundle(parts);
    expect(out).toContain("## Progress streams (0, newest first)");
    expect(out).toContain("the runner predates them");
  });
});

describe("logBundleName", () => {
  it("is sortable and carries no path separator or colon", () => {
    const n = logBundleName("2026-08-09T18:00:00.000Z");
    expect(n).toBe("ngb-log-2026-08-09T18-00-00.txt");
    expect(n).not.toContain("/");
    expect(n).not.toContain(":");
  });
});
