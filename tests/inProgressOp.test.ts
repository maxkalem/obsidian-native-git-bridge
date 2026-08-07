import { describe, expect, it } from "vitest";
import { describeInProgressOp } from "../src/git/inProgressOp";

describe("describeInProgressOp", () => {
  it("shows nothing on a repository that is not mid-anything", () => {
    expect(describeInProgressOp({ conflictCount: 0 })).toBeNull();
    expect(
      describeInProgressOp({ mergeInProgress: false, rebaseInProgress: false, conflictCount: 3 })
    ).toBeNull();
  });

  // The reported state: MERGE_HEAD present, every conflict already resolved and
  // staged, so the Conflicts group is empty and the panel used to offer no way
  // out at all while every pull answered "a merge is already in progress".
  it("offers the merge exit when the conflicts are already resolved", () => {
    const b = describeInProgressOp({ mergeInProgress: true, conflictCount: 0 });
    expect(b).not.toBeNull();
    expect(b!.kind).toBe("merge");
    expect(b!.title).toBe("Merge in progress — everything is resolved");
    expect(b!.finish).toEqual({ label: "Commit merge", enabled: true });
    expect(b!.abort).toEqual({ label: "Abort merge", enabled: true });
  });

  it("refuses to finish while files are still conflicted, but never blocks the abort", () => {
    const b = describeInProgressOp({ mergeInProgress: true, conflictCount: 2 })!;
    expect(b.title).toBe("Merge in progress — 2 files are still conflicted");
    expect(b.finish.enabled).toBe(false);
    expect(b.abort.enabled).toBe(true);
  });

  it("gets the singular right", () => {
    const b = describeInProgressOp({ mergeInProgress: true, conflictCount: 1 })!;
    expect(b.title).toBe("Merge in progress — 1 file is still conflicted");
  });

  it("uses rebase vocabulary for a rebase", () => {
    const b = describeInProgressOp({ rebaseInProgress: true, conflictCount: 0 })!;
    expect(b.kind).toBe("rebase");
    expect(b.finish.label).toBe("Continue rebase");
    expect(b.abort.label).toBe("Abort rebase");
    expect(b.detail).toContain("before the rebase started");
  });

  // A rebase that stops on a conflict can leave MERGE_HEAD from the replayed
  // commit. Naming that "merge" would offer `git commit`, which is not how a
  // rebase is finished.
  it("calls it a rebase when both flags are set", () => {
    const b = describeInProgressOp({
      mergeInProgress: true,
      rebaseInProgress: true,
      conflictCount: 1,
    })!;
    expect(b.kind).toBe("rebase");
    expect(b.finish.label).toBe("Continue rebase");
  });

  // On a phone the banner sits in the panel's fixed region, so every line it
  // takes is a line of file list nobody can see. The wording is shortened at
  // the source; the font is deliberately NOT reduced.
  describe("compact wording for the phone", () => {
    const cases: { s: Parameters<typeof describeInProgressOp>[0]; title: string }[] = [
      { s: { mergeInProgress: true, conflictCount: 0 }, title: "Merge ready to commit" },
      { s: { mergeInProgress: true, conflictCount: 1 }, title: "Merge: 1 conflict left" },
      { s: { mergeInProgress: true, conflictCount: 3 }, title: "Merge: 3 conflicts left" },
      { s: { rebaseInProgress: true, conflictCount: 0 }, title: "Rebase ready to continue" },
      { s: { rebaseInProgress: true, conflictCount: 2 }, title: "Rebase: 2 conflicts left" },
    ];
    it.each(cases)("says $title", ({ s, title }) => {
      expect(describeInProgressOp(s)!.shortTitle).toBe(title);
    });

    it("is genuinely shorter than the desktop wording, not just different", () => {
      for (const { s } of cases) {
        const b = describeInProgressOp(s)!;
        expect(b.shortTitle.length).toBeLessThan(b.title.length);
        expect(b.shortDetail.length).toBeLessThan(b.detail.length);
        // Two lines on a ~34-character phone column.
        expect(b.shortTitle.length).toBeLessThanOrEqual(34);
        expect(b.shortDetail.length).toBeLessThanOrEqual(48);
      }
    });

    it("still names both exits, so nothing is lost by shortening", () => {
      const b = describeInProgressOp({ mergeInProgress: true, conflictCount: 0 })!;
      expect(b.shortDetail.toLowerCase()).toContain("commit");
      expect(b.shortDetail.toLowerCase()).toContain("abort");
    });
  });

  it("treats a negative count as zero rather than rendering nonsense", () => {
    const b = describeInProgressOp({ mergeInProgress: true, conflictCount: -1 })!;
    expect(b.finish.enabled).toBe(true);
    expect(b.title).toContain("everything is resolved");
  });
});
