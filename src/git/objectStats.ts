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

/** A hundred megabytes: below this, nothing on a phone is worth a window. */
const OFFER_FLOOR_KB = 100 * 1024;

/**
 * Should the repair's last window offer the storage cleanup, and what does it
 * say it saw?
 *
 * This exists because a real device sat on 6.3 GB of object store while both
 * lightweight toggles said the repository was configured small, and the
 * repair's footprint check never looked: it only ran when a partial-clone
 * FILTER was configured. The user's own cleanup then took it to 2.0 GB in one
 * pass. Where the 4.3 GB came from is written down in the buried-bodies file;
 * the point here is that none of it was history anybody had chosen to keep.
 *
 * The rule the user set stays intact — "the toggles off mean the full history
 * IS the configured state, so nothing to check and nothing to ask" — because
 * it is a rule about HISTORY. Loose objects nothing references, git's own
 * garbage, and a second copy of the same pack are not history under any
 * setting; they are what an interrupted fetch, a refetch and a shallow
 * truncation leave behind, and nothing in this design prunes them on its own.
 *
 * Three reasons, in the order a reader should meet them, and at most one is
 * reported: the biggest number is the one that decides.
 */
export function decideStorageOffer(opts: {
  stats: ObjectStats;
  /** Blob content on disk, from maintenance-scan; 0 when it was not measured. */
  blobKb: number;
  /** A partial-clone filter is configured, so blobs are shedable. */
  partial: boolean;
}): { reclaimKb: number; reason: string } | null {
  const { stats, blobKb, partial } = opts;
  // The filter case first: it is the only one where the number is exact,
  // because the filter says precisely what may be shed.
  if (partial && blobKb >= OFFER_FLOOR_KB) {
    return {
      reclaimKb: blobKb,
      reason: "packs hold file content the filter allows shedding",
    };
  }
  const wasted = stats.looseKb + stats.garbageKb;
  if (wasted >= OFFER_FLOOR_KB) {
    return {
      reclaimKb: wasted,
      reason:
        stats.garbageKb > stats.looseKb
          ? "leftover temporary files from an interrupted fetch"
          : "loose objects no branch, tag or reflog reaches",
    };
  }
  // Several packs holding a lot: a repack merges them, and how much that
  // frees is not knowable until it runs — so the number offered is the total
  // and the caller has to say it is an upper bound, never a promise.
  if (stats.packCount >= 3 && stats.packKb >= 5 * OFFER_FLOOR_KB) {
    return {
      reclaimKb: stats.packKb,
      reason: `${stats.packCount} separate packs, which a repack merges into one`,
    };
  }
  return null;
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
export function maintenanceReportLines(
  s: ObjectStats,
  rescueBranches: string[],
  /** The repository keeps a shallow history. See the warning below. */
  shallow = false
): string[] {
  const lines = [
    `Object database: ${formatSize(totalKb(s))} (${s.packCount} pack${s.packCount === 1 ? "" : "s"} ${formatSize(
      s.packKb
    )}, loose objects ${formatSize(s.looseKb)}).`,
    `Leftover temporary files: ${s.garbageCount === 0 ? "none" : `${s.garbageCount}, ${formatSize(s.garbageKb)}`}.`,
    "Cleanup removes stale temporary files and unreachable loose objects older than two weeks, then repacks everything reachable into one pack. Nothing any branch, tag, reflog or the index can reach is touched.",
    "The repack is the long step and needs free space roughly the size of the repacked history while it runs.",
  ];
  if (shallow) {
    // Observed on a real device, 2026-08-30, and NOT explained. The repository
    // verified clean right after its history was shortened (`missing=no
    // findings=no`); three days later, with prune + repack the only object
    // operations in between, 490 objects were referenced and absent —
    // `cat-file -t` confirmed them gone, and the remote had to give them back.
    // Neither obvious mechanism reproduces in the sandbox (shallow + repack,
    // and a leftover promisor marker + repack), but the sandbox runs git 2.34
    // and the device runs 2.55, above every boundary this suite can test. So
    // the warning states the correlation and stops there: a guess dressed as a
    // cause would be worse than none, and refusing outright would take a
    // working cleanup away on evidence this thin. The user decides.
    lines.push(
      "This repository keeps a SHALLOW history. On one device, a cleanup of a shallow repository was followed by objects going missing from its history — the cause is not established, and everything was recoverable from the remote because it had all been pushed. Push anything unpushed before running this here."
    );
  }
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
