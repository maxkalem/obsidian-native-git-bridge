import { describe, expect, it } from "vitest";
import {
  decideRepair,
  decideStaleLock,
  missingOids,
  planRepair,
  type LockFacts,
  type RepairContext,
  type RepairTriageFacts,
} from "../src/ops/repairJob";

/**
 * The decisions between the repair steps.
 *
 * The one-piece repair shipped three defects, all of them in exactly these
 * decisions, and a fourth in its verdict: it advised "clone the vault again"
 * about objects that were never on the remote because they belonged to local,
 * unpushed commits. The fixture below is the 15:11 log bundle of 2026-08-10
 * replayed: missing tree 5ae15b81…, branch 7 ahead, a full refetch that
 * changed nothing — the sequence that must end in the reset offer and must
 * never end in the clone advice.
 */

const TREE = "5ae15b81841cb822aac335600a8a3ba67f6771f3";
const BUNDLE_MISSING = [
  `error: ${TREE}: invalid sha1 pointer in cache-tree of .git/index`,
  "broken link from    tree be11d9a27078d8e6c143ed68e238f8d1c7a8b5a6",
  `missing tree ${TREE}`,
].join("\n");

const ctx = (over: Partial<RepairContext> = {}): RepairContext => ({
  ahead: 0,
  cacheTreeBroken: false,
  hasUpstream: true,
  ...over,
});

describe("missingOids", () => {
  it("extracts unique full ids and nothing shorter", () => {
    const ids = missingOids(BUNDLE_MISSING);
    // The referencing tree is named too — both are ids fsck printed in full.
    expect(ids).toContain(TREE);
    expect(ids).toContain("be11d9a27078d8e6c143ed68e238f8d1c7a8b5a6");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps the list at what one request accepts", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      `missing blob ${String(i).padStart(4, "0")}${"a".repeat(36)}`
    ).join("\n");
    expect(missingOids(many).length).toBeLessThanOrEqual(64);
  });
});

describe("decideRepair", () => {
  it("is clean only when nothing is missing AND nothing is damaged", () => {
    expect(decideRepair("scan", { fsckMissing: "", fsckRemaining: "" }, ctx()).kind).toBe("clean");
    // Damaged-but-present objects are left alone by design and must be named,
    // not declared repaired — that lie shipped once already.
    expect(
      decideRepair("scan", { fsckMissing: "", fsckRemaining: "error: garbage in blob abc" }, ctx())
        .kind
    ).toBe("damaged");
  });

  it("asks the remote for exactly the missing objects first", () => {
    const d = decideRepair("scan", { fsckMissing: BUNDLE_MISSING, fsckRemaining: BUNDLE_MISSING }, ctx());
    expect(d.kind).toBe("fetch-missing");
    if (d.kind === "fetch-missing") expect(d.oids).toContain(TREE);
  });

  it("gates the full download behind the user's yes", () => {
    const d = decideRepair(
      "fetch-missing",
      { fsckMissing: BUNDLE_MISSING, fsckRemaining: BUNDLE_MISSING },
      ctx()
    );
    expect(d.kind).toBe("ask-refetch");
  });

  it("replays the bundle: ahead of upstream after a refetch means offer the reset, never the clone", () => {
    const d = decideRepair(
      "refetch",
      { fsckMissing: BUNDLE_MISSING, fsckRemaining: BUNDLE_MISSING },
      ctx({ ahead: 7 })
    );
    expect(d.kind).toBe("offer-reset");
  });

  it("a broken cache-tree alone also earns the reset offer", () => {
    const d = decideRepair(
      "refetch",
      { fsckMissing: BUNDLE_MISSING, fsckRemaining: BUNDLE_MISSING },
      ctx({ cacheTreeBroken: true })
    );
    expect(d.kind).toBe("offer-reset");
  });

  it("without local-only evidence the honest ending is that the remote cannot help", () => {
    const d = decideRepair(
      "refetch",
      { fsckMissing: BUNDLE_MISSING, fsckRemaining: BUNDLE_MISSING },
      ctx()
    );
    expect(d.kind).toBe("missing-remote");
  });

  it("without an upstream there is nothing to rebuild on, whatever the evidence says", () => {
    const d = decideRepair(
      "refetch",
      { fsckMissing: BUNDLE_MISSING, fsckRemaining: BUNDLE_MISSING },
      ctx({ ahead: 7, cacheTreeBroken: true, hasUpstream: false })
    );
    expect(d.kind).toBe("missing-remote");
  });

  it("a refetch that finishes the job ends clean, whatever the branch looked like", () => {
    const d = decideRepair("refetch", { fsckMissing: "", fsckRemaining: "" }, ctx({ ahead: 7 }));
    expect(d.kind).toBe("clean");
  });
});

/**
 * The stale-lock plan. v15 killed blind — every uid process, no questions —
 * and had never said it closes Termux sessions. The distinction is the
 * user's: a live git plus a fresh lock is a RUNNING command (wait), a lock
 * with no process behind it is a corpse from Android stopping Termux (simply
 * removed), and anything alive means the kill needs a yes.
 */
describe("decideStaleLock", () => {
  const facts = (over: Partial<LockFacts> = {}): LockFacts => ({
    lockExists: true,
    lockAgeSeconds: 3600,
    liveGit: false,
    liveProcesses: [],
    ...over,
  });

  it("no lock, no plan — and above all no kill", () => {
    expect(decideStaleLock(facts({ lockExists: false, liveGit: true })).kind).toBe("no-lock");
  });

  it("a live git with a fresh lock is a running command: wait", () => {
    expect(
      decideStaleLock(facts({ liveGit: true, lockAgeSeconds: 30, liveProcesses: ["123 git"] })).kind
    ).toBe("running");
  });

  it("a live git with an OLD lock is not proof of work: ask before killing", () => {
    expect(
      decideStaleLock(facts({ liveGit: true, lockAgeSeconds: 3600, liveProcesses: ["123 git"] }))
        .kind
    ).toBe("ask-kill");
  });

  it("a lock with nothing alive is a corpse: removed without stopping anything", () => {
    expect(decideStaleLock(facts()).kind).toBe("corpse");
  });

  it("an unknown lock age never counts as fresh", () => {
    expect(
      decideStaleLock(facts({ liveGit: true, lockAgeSeconds: null, liveProcesses: ["123 git"] }))
        .kind
    ).toBe("ask-kill");
  });

  it("non-git processes alive: the kill is needed and needs a yes", () => {
    expect(decideStaleLock(facts({ liveProcesses: ["77 bash"] })).kind).toBe("ask-kill");
  });
});

/**
 * The unified repair's step planner. The fixture below is the real phone as
 * the 0.6.6 spec records it: a re-clone took the local identity with the old
 * .git, the global one remained, a local credential helper exists (global
 * does not), sparse is off with the derived list still remembering two paths
 * (the reconcile window's case, not this planner's).
 */
describe("planRepair", () => {
  const base = (over: Partial<RepairTriageFacts> = {}): RepairTriageFacts => ({
    lock: { lockExists: false, lockAgeSeconds: null, liveGit: false, liveProcesses: [] },
    identity: { local: true, global: false, any: true },
    globalCredHelper: false,
    sparse: { enabled: true, cone: false, hasBase: true, hasEmptyingDefault: false },
    rescueBranches: [],
    previousGitDirs: [],
    ...over,
  });

  it("plans nothing for a healthy repository", () => {
    expect(planRepair(base())).toEqual([]);
  });

  it("replays the phone: no local identity means offer-set, and nothing else", () => {
    const plan = planRepair(
      base({
        identity: { local: false, global: true, any: true },
        sparse: { enabled: false, cone: false, hasBase: false, hasEmptyingDefault: false },
      })
    );
    expect(plan).toEqual([{ step: "identity", act: "offer-set" }]);
  });

  it("offers the global removal ONLY beside an existing local identity", () => {
    expect(planRepair(base({ identity: { local: true, global: true, any: true } }))).toEqual([
      { step: "identity", act: "offer-drop-global" },
    ]);
    // No identity anywhere: set first; removal is never on the plan.
    const plan = planRepair(base({ identity: { local: false, global: false, any: false } }));
    expect(plan).toEqual([{ step: "identity", act: "offer-set" }]);
  });

  it("plans the sparse repair for the emptying default and for a missing base", () => {
    expect(
      planRepair(base({ sparse: { enabled: true, cone: false, hasBase: true, hasEmptyingDefault: true } }))
    ).toEqual([{ step: "sparse", act: "repair-definition" }]);
    expect(
      planRepair(base({ sparse: { enabled: true, cone: false, hasBase: false, hasEmptyingDefault: false } }))
    ).toEqual([{ step: "sparse", act: "repair-definition" }]);
    // Cone mode is a decision, not a repair; disabled sparse plans nothing.
    expect(
      planRepair(base({ sparse: { enabled: true, cone: true, hasBase: false, hasEmptyingDefault: true } }))
    ).toEqual([{ step: "sparse", act: "cone-needs-decision" }]);
    expect(
      planRepair(base({ sparse: { enabled: false, cone: false, hasBase: false, hasEmptyingDefault: false } }))
    ).toEqual([]);
  });

  it("keeps the user's order: blockers first, leftovers last", () => {
    const plan = planRepair(
      base({
        lock: { lockExists: true, lockAgeSeconds: 9999, liveGit: false, liveProcesses: [] },
        identity: { local: false, global: true, any: true },
        globalCredHelper: true,
        sparse: { enabled: true, cone: false, hasBase: true, hasEmptyingDefault: true },
        rescueBranches: ["ngb-rescue-20260810T235946Z"],
        previousGitDirs: ["previous-git-20260807T101500Z"],
      })
    );
    expect(plan.map((p) => `${p.step}:${p.act}`)).toEqual([
      "lock:remove-corpse",
      "identity:offer-set",
      "cred-helper:offer-reset",
      "sparse:repair-definition",
      "leftovers:rescue-branches",
      "leftovers:previous-git",
    ]);
  });

  it("a running git command stops the plan at the lock step", () => {
    const plan = planRepair(
      base({ lock: { lockExists: true, lockAgeSeconds: 5, liveGit: true, liveProcesses: ["1 git"] } })
    );
    expect(plan[0]).toEqual({ step: "lock", act: "wait-running" });
  });
});
