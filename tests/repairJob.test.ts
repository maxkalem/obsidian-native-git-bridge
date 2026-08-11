import { describe, expect, it } from "vitest";
import { decideRepair, missingOids, type RepairContext } from "../src/ops/repairJob";

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
