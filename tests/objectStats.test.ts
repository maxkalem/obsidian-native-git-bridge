import { describe, expect, it } from "vitest";
import {
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
