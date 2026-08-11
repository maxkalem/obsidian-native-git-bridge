import { formatSize } from "./previousRepos";

/**
 * What `git count-objects -v` reports about the object database, parsed.
 *
 * The sizes are KiB, as git prints them (`size`, `size-pack`, `size-garbage`).
 * "Garbage" is git's own word for files under `.git/objects` that are neither
 * valid loose objects nor valid packs — which is exactly where an interrupted
 * fetch's multi-gigabyte `tmp_pack_*` lands, so the field is load-bearing for
 * the cleanup report rather than a curiosity.
 */
export interface ObjectStats {
  looseCount: number;
  looseKb: number;
  inPackCount: number;
  packCount: number;
  packKb: number;
  garbageCount: number;
  garbageKb: number;
}

const FIELD_KEYS: Record<string, keyof ObjectStats> = {
  count: "looseCount",
  size: "looseKb",
  "in-pack": "inPackCount",
  packs: "packCount",
  "size-pack": "packKb",
  garbage: "garbageCount",
  "size-garbage": "garbageKb",
};

/** Parse `git count-objects -v`. Unknown lines are ignored; missing fields are 0. */
export function parseCountObjects(raw: string): ObjectStats {
  const stats: ObjectStats = {
    looseCount: 0,
    looseKb: 0,
    inPackCount: 0,
    packCount: 0,
    packKb: 0,
    garbageCount: 0,
    garbageKb: 0,
  };
  for (const line of raw.split("\n")) {
    const m = /^([a-z-]+):\s*(\d+)\s*$/.exec(line.trim());
    if (!m) continue;
    const key = FIELD_KEYS[m[1]!];
    if (key !== undefined) stats[key] = parseInt(m[2]!, 10);
  }
  return stats;
}

/** Everything the object database occupies, KiB. */
export function totalKb(s: ObjectStats): number {
  return s.looseKb + s.packKb + s.garbageKb;
}

/** One pack file as the maintenance scan lists it: `<bytes>\t<name>` per line. */
export interface PackFile {
  name: string;
  bytes: number;
}

export function parsePackFiles(raw: string): PackFile[] {
  const out: PackFile[] = [];
  for (const line of raw.split("\n")) {
    const m = /^(\d+)\t(.+)$/.exec(line);
    if (m) out.push({ bytes: parseInt(m[1]!, 10), name: m[2]! });
  }
  return out;
}

/**
 * The lines the confirmation window shows before anything runs. Pure, so the
 * numbers a user says yes to are the numbers a test asserted.
 *
 * The headroom line states repack's real requirement: the new pack is written
 * while every old one still exists, so the peak is roughly today's size plus
 * the deduplicated size — and the deduplicated size is not knowable up front,
 * so the reachable in-pack total stands in for it as the honest estimate.
 */
export function maintenanceReportLines(s: ObjectStats, rescueBranches: string[]): string[] {
  const lines = [
    `Object database: ${formatSize(totalKb(s))} (${s.packCount} pack${s.packCount === 1 ? "" : "s"} ${formatSize(
      s.packKb
    )}, loose objects ${formatSize(s.looseKb)}).`,
    `Leftover temporary files: ${s.garbageCount === 0 ? "none" : `${s.garbageCount}, ${formatSize(s.garbageKb)}`}.`,
    "Cleanup removes stale temporary files and unreachable loose objects older than two weeks, then repacks everything reachable into one pack. Nothing any branch, tag, reflog or the index can reach is touched.",
    "The repack is the long step and needs free space roughly the size of the repacked history while it runs.",
  ];
  if (rescueBranches.length > 0) {
    lines.push(
      `Rescue branch${rescueBranches.length === 1 ? "" : "es"} ${rescueBranches.join(
        ", "
      )} still keeps its objects reachable, so the space it holds is not freed until the backup is deleted.`
    );
  }
  return lines;
}

/** The closing line: what the cleanup actually changed. */
export function maintenanceVerdict(before: ObjectStats, after: ObjectStats): string {
  const freedKb = totalKb(before) - totalKb(after);
  if (freedKb <= 0) return `Nothing to free: the object database stays at ${formatSize(totalKb(after))}.`;
  return `Freed ${formatSize(freedKb)}: ${formatSize(totalKb(before))} down to ${formatSize(totalKb(after))} (${
    after.packCount
  } pack${after.packCount === 1 ? "" : "s"} now).`;
}
