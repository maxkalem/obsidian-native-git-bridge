import { describe, expect, it } from "vitest";
import { abortMergeFailure, failureDetail } from "../src/main";
import type { BridgeResult } from "../src/types";

/**
 * `git merge --abort` is `git reset --merge`: it has to put the working tree
 * back, and it cannot do that while the sparse checkout has drifted from the
 * index — entries under an excluded path with no file on disk. It fails with a
 * bare "git merge --abort failed", and the repository stays mid-merge with
 * every pull refusing.
 *
 * Observed on the device, in the operation log: two aborts failed, a
 * `sparse-reapply` succeeded, and the next abort went through on the first try.
 * Nothing in the message said any of that, so the way out was found by trying
 * five other things first.
 *
 * The window names the cause and offers the reapply. It does not RUN it: the
 * reapply rewrites which files are materialised, and this plugin does not
 * repair destructively on its own.
 */

function failed(code: string, message = "git merge --abort failed."): BridgeResult {
  return {
    protocolVersion: 1,
    id: "r-1",
    action: "abort-merge",
    ok: false,
    exitCode: 1,
    error: { code, message, stdout: "", stderr: "error: Entry 'Private/x' would be overwritten" },
  } as unknown as BridgeResult;
}

describe("abort-merge failure", () => {
  it("explains the sparse cause and offers the repair when git itself refused", () => {
    const plan = abortMergeFailure(failed("GIT_FAILED"));
    expect(plan.offerReapply).toBe(true);
    // git's own words first — the explanation is a second opinion, not a
    // replacement for what actually happened.
    expect(plan.lines[0]).toBe("git merge --abort failed.");
    expect(plan.lines.join(" ")).toContain("sparse");
  });

  it("says nothing about sparse for a failure that is not git's refusal", () => {
    // SAFETY_BLOCKED already opens the sparse-safety window with its own
    // repairs, and REPO_MISSING means there is nothing to reapply rules to.
    for (const code of ["SAFETY_BLOCKED", "REPO_MISSING", "TIMEOUT", "RUNNER_INTERNAL"]) {
      const plan = abortMergeFailure(failed(code));
      expect(plan.offerReapply).toBe(false);
      expect(plan.lines).toEqual([]);
    }
  });

  it("does not offer a repair for a result carrying no error at all", () => {
    const ok = { protocolVersion: 1, id: "r-2", action: "abort-merge", ok: true, exitCode: 0 };
    expect(abortMergeFailure(ok as unknown as BridgeResult).offerReapply).toBe(false);
  });
});

/**
 * The log entry's detail. It carried `code: message` and nothing else, which is
 * the sentence that says WHAT happened and never the one that says why. A
 * bundle collected an hour later then held twenty identical "git pull failed."
 * lines with no reason attached, and the runner's own log records outcomes
 * rather than output, so it could not fill the gap.
 */
describe("failureDetail", () => {
  it("keeps git's own output beside the code", () => {
    const d = failureDetail(failed("GIT_FAILED", "git pull failed.")) ?? "";
    expect(d).toContain("GIT_FAILED: git pull failed.");
    expect(d).toContain("stderr:");
    expect(d).toContain("would be overwritten");
  });

  it("labels the two streams rather than running them together", () => {
    const r = failed("GIT_FAILED");
    (r.error as { stdout: string }).stdout = "Already up to date.";
    const d = failureDetail(r) ?? "";
    expect(d.indexOf("stdout:")).toBeGreaterThan(-1);
    expect(d.indexOf("stderr:")).toBeGreaterThan(d.indexOf("stdout:"));
  });

  it("omits an empty stream instead of writing an empty heading", () => {
    const r = failed("CONFLICT", "A merge is already in progress.");
    (r.error as { stderr: string }).stderr = "   \n";
    expect(failureDetail(r)).toBe("CONFLICT: A merge is already in progress.");
  });

  it("has nothing to say about a result that succeeded", () => {
    const ok = { protocolVersion: 1, id: "r-3", action: "pull", ok: true, exitCode: 0 };
    expect(failureDetail(ok as unknown as BridgeResult)).toBeUndefined();
  });
});
