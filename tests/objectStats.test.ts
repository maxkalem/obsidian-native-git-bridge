import { describe, expect, it } from "vitest";
import {
  decideStorageOffer,
  maintenanceReportLines,
  maintenanceVerdict,
  parseCountObjects,
  parsePackFiles,
  totalKb,
} from "../src/git/objectStats";

/**
 * The numbers the cleanup confirmation shows are the numbers these tests
 * assert: the user says yes to `parseCountObjects` output, so a parsing slip
 * here is a wrong promise on screen. Sizes are KiB, as `count-objects -v`
 * prints them.
 */

const REAL_OUTPUT = `count: 12
size: 48
in-pack: 15743
packs: 5
size-pack: 16777216
prune-packable: 0
garbage: 2
size-garbage: 4194304
`;

describe("parseCountObjects", () => {
  it("reads every field the report uses", () => {
    const s = parseCountObjects(REAL_OUTPUT);
    expect(s).toEqual({
      looseCount: 12,
      looseKb: 48,
      inPackCount: 15743,
      packCount: 5,
      packKb: 16777216,
      garbageCount: 2,
      garbageKb: 4194304,
    });
    expect(totalKb(s)).toBe(48 + 16777216 + 4194304);
  });

  it("treats missing fields as zero and ignores what it does not know", () => {
    const s = parseCountObjects("count: 3\nsize: 9\nfuture-field: 7\n");
    expect(s.looseCount).toBe(3);
    expect(s.packCount).toBe(0);
    expect(s.garbageKb).toBe(0);
  });

  it("answers all zeroes for empty output rather than throwing", () => {
    expect(totalKb(parseCountObjects(""))).toBe(0);
  });
});

describe("parsePackFiles", () => {
  it("reads size-tab-name lines and skips anything else", () => {
    const files = parsePackFiles("4400000000\ttmp_pack_abc\n1234\tpack-1.pack\n\nnot a line\n");
    expect(files).toEqual([
      { bytes: 4400000000, name: "tmp_pack_abc" },
      { bytes: 1234, name: "pack-1.pack" },
    ]);
  });
});

describe("the confirmation report and the verdict", () => {
  const before = parseCountObjects(REAL_OUTPUT); // 16 GB packs + 4 GB garbage

  it("states the size, the packs and the garbage in human units", () => {
    const lines = maintenanceReportLines(before, []);
    expect(lines[0]).toContain("20.0 GB");
    expect(lines[0]).toContain("5 packs");
    expect(lines[1]).toContain("4.0 GB");
  });

  it("warns on a SHALLOW repository, and states the correlation as a correlation", () => {
    // A real device verified clean right after its history was shortened and,
    // three days later with prune + repack the only object operations in
    // between, had 490 objects referenced and absent. The mechanism is not
    // established — neither obvious candidate reproduces on the sandbox's git
    // 2.34, and the device runs 2.55 — so the line must not claim a cause.
    const withShallow = maintenanceReportLines(before, [], true).join(" ");
    expect(withShallow).toContain("SHALLOW");
    expect(withShallow).toContain("the cause is not established");
    expect(withShallow).toContain("Push anything unpushed");
    // Silent where it does not apply, and silent by default.
    expect(maintenanceReportLines(before, [], false).join(" ")).not.toContain("SHALLOW");
    expect(maintenanceReportLines(before, []).join(" ")).not.toContain("SHALLOW");
  });

  it("names a rescue branch as the thing keeping its space reachable", () => {
    const lines = maintenanceReportLines(before, ["ngb-rescue-20260810T120000Z"]);
    expect(lines.some((l) => l.includes("ngb-rescue-20260810T120000Z"))).toBe(true);
    expect(maintenanceReportLines(before, []).some((l) => l.includes("Rescue"))).toBe(false);
  });

  it("the verdict states what was freed, from before and after", () => {
    const after = parseCountObjects("count: 0\nsize: 0\nin-pack: 15743\npacks: 1\nsize-pack: 4194304\n");
    const v = maintenanceVerdict(before, after);
    expect(v).toContain("Freed");
    expect(v).toContain("16.0 GB"); // 20 GB - 4 GB
    expect(v).toContain("1 pack");
  });

  it("says so honestly when nothing was freed", () => {
    expect(maintenanceVerdict(before, before)).toContain("Nothing to free");
  });
});

/**
 * The device that motivated this: 6.3 GB of object store while both
 * lightweight toggles read "small", and the repair's footprint check never
 * looked because it only ran for a partial-clone FILTER. The user's own
 * cleanup took it to 2.0 GB in one pass.
 */
describe("decideStorageOffer", () => {
  const stats = (over: Partial<ReturnType<typeof parseCountObjects>> = {}) => ({
    looseCount: 0,
    looseKb: 0,
    inPackCount: 1000,
    packCount: 1,
    packKb: 50 * 1024,
    garbageCount: 0,
    garbageKb: 0,
    ...over,
  });

  it("says nothing about a small, tidy store", () => {
    expect(decideStorageOffer({ stats: stats(), blobKb: 0, partial: false })).toBeNull();
  });

  it("keeps the filter case exact and first", () => {
    // The one case where the number is a promise rather than a bound: the
    // filter says precisely which blobs may be shed.
    const o = decideStorageOffer({ stats: stats(), blobKb: 4_500_000, partial: true });
    expect(o?.reclaimKb).toBe(4_500_000);
    expect(o?.reason).toContain("filter allows shedding");
  });

  it("does not read blob content as reclaimable without a filter", () => {
    // The user's rule stands: with the toggles off, the full history IS the
    // configured state. Blobs are history; they are not waste.
    expect(decideStorageOffer({ stats: stats(), blobKb: 4_500_000, partial: false })).toBeNull();
  });

  it("reports loose objects nothing reaches, which are waste under any setting", () => {
    const o = decideStorageOffer({ stats: stats({ looseKb: 3_000_000 }), blobKb: 0, partial: false });
    expect(o?.reclaimKb).toBe(3_000_000);
    expect(o?.reason).toContain("loose objects");
  });

  it("names git's own garbage when that is the bigger half", () => {
    // `size-garbage` is where an interrupted fetch's multi-gigabyte tmp_pack
    // lands, so the wording has to point at the cause, not at loose objects.
    const o = decideStorageOffer({
      stats: stats({ looseKb: 10 * 1024, garbageKb: 2_000_000 }),
      blobKb: 0,
      partial: false,
    });
    expect(o?.reason).toContain("interrupted fetch");
  });

  it("reports several large packs as an upper bound, not a promise", () => {
    const o = decideStorageOffer({
      stats: stats({ packCount: 4, packKb: 6_000_000 }),
      blobKb: 0,
      partial: false,
    });
    expect(o?.reclaimKb).toBe(6_000_000);
    expect(o?.reason).toContain("4 separate packs");
    // Two packs is what a healthy repack leaves; three is where it starts
    // being worth saying something.
    expect(
      decideStorageOffer({ stats: stats({ packCount: 2, packKb: 6_000_000 }), blobKb: 0, partial: false })
    ).toBeNull();
  });

  it("stays quiet below the hundred-megabyte floor", () => {
    // A phone should not be asked about 40 MB.
    expect(
      decideStorageOffer({ stats: stats({ looseKb: 40 * 1024 }), blobKb: 0, partial: false })
    ).toBeNull();
    expect(decideStorageOffer({ stats: stats(), blobKb: 90 * 1024, partial: true })).toBeNull();
  });
});
