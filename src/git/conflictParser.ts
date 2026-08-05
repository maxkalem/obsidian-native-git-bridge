/**
 * Parsing and resolving git conflict markers in working-tree text files.
 * Pure functions — the ConflictView renders what these produce, and writing
 * the resolved text back goes through the vault adapter.
 */

export interface ConflictBlock {
  /** Index into the segments array (for stable references across renders). */
  index: number;
  /** Label after `<<<<<<<` (usually HEAD — the local side). */
  oursLabel: string;
  /** Label after `>>>>>>>` (the incoming side). */
  theirsLabel: string;
  ours: string[];
  theirs: string[];
  /** Common-ancestor lines when merge.conflictStyle=diff3 produced them. */
  base?: string[];
}

export type ConflictSegment =
  | { kind: "text"; lines: string[] }
  | ({ kind: "conflict" } & ConflictBlock);

export interface ParsedConflictFile {
  segments: ConflictSegment[];
  /** Number of conflict blocks found. */
  conflictCount: number;
}

/**
 * Marker forms. git writes the standard ones; anything THIS plugin writes
 * back uses a leading "-" (`-<<<<<<<`, `-=======`, `->>>>>>>`): in Obsidian's
 * Markdown rendering a bare `=======` turns the previous line into a heading
 * and `>>>>>>>` into nested blockquotes, so a half-resolved note looked
 * destroyed in the editor. The "-" form renders as a harmless list item.
 * Both forms are parsed; git itself never reads worktree markers (the
 * unmerged state lives in the index), so the substitution is safe.
 */
function markerLabel(line: string, marker: string): string | null {
  if (line.startsWith(marker)) return line.slice(marker.length).trim();
  if (line.startsWith("-" + marker)) return line.slice(marker.length + 1).trim();
  return null;
}
const isDivider = (l: string) => l === "=======" || l === "-=======";

/**
 * Split file content into plain-text runs and conflict blocks. Tolerant of
 * diff3-style blocks (`||||||| base` section). Malformed marker sequences
 * (e.g. a `<<<<<<<` without its closing `>>>>>>>`) are kept as PLAIN TEXT
 * rather than guessed at — resolving must never invent content.
 */
export function parseConflictFile(content: string): ParsedConflictFile {
  const lines = content.split("\n");
  const segments: ConflictSegment[] = [];
  let plain: string[] = [];
  let conflictCount = 0;
  let i = 0;
  const flushPlain = () => {
    if (plain.length > 0) {
      segments.push({ kind: "text", lines: plain });
      plain = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const oursLabel = markerLabel(line, "<<<<<<<");
    if (oursLabel !== null) {
      const block = tryParseBlock(lines, i);
      if (block !== null) {
        flushPlain();
        segments.push({
          kind: "conflict",
          index: segments.length,
          oursLabel,
          theirsLabel: block.theirsLabel,
          ours: block.ours,
          theirs: block.theirs,
          base: block.base,
        });
        conflictCount++;
        i = block.end + 1;
        continue;
      }
    }
    plain.push(line);
    i++;
  }
  flushPlain();
  return { segments, conflictCount };
}

function tryParseBlock(
  lines: string[],
  start: number
): { ours: string[]; theirs: string[]; base?: string[]; theirsLabel: string; end: number } | null {
  const ours: string[] = [];
  const base: string[] = [];
  const theirs: string[] = [];
  let mode: "ours" | "base" | "theirs" = "ours";
  let sawBase = false;
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j]!;
    const closeLabel = markerLabel(l, ">>>>>>>");
    if (mode === "ours" && markerLabel(l, "|||||||") !== null) {
      mode = "base";
      sawBase = true;
    } else if ((mode === "ours" || mode === "base") && isDivider(l)) {
      mode = "theirs";
    } else if (mode === "theirs" && closeLabel !== null) {
      return { ours, theirs, base: sawBase ? base : undefined, theirsLabel: closeLabel, end: j };
    } else if (markerLabel(l, "<<<<<<<") !== null) {
      return null; // nested opener before closing: malformed, do not guess
    } else {
      (mode === "ours" ? ours : mode === "base" ? base : theirs).push(l);
    }
  }
  return null; // unterminated
}

/**
 * Rebuild the file with ONE conflict block replaced by the chosen side.
 * All other blocks keep their markers, so resolution is strictly per-block.
 * Remaining markers are written in the Obsidian-safe "-" form (see above), so
 * a half-resolved note no longer renders as headings and blockquote soup.
 */
export function resolveBlock(
  parsed: ParsedConflictFile,
  blockIndex: number,
  side: "ours" | "theirs"
): string {
  const out: string[] = [];
  for (const seg of parsed.segments) {
    if (seg.kind === "text") {
      out.push(...seg.lines);
    } else if (seg.index === blockIndex) {
      out.push(...(side === "ours" ? seg.ours : seg.theirs));
    } else {
      out.push(`-<<<<<<< ${seg.oursLabel}`);
      out.push(...seg.ours);
      if (seg.base !== undefined) {
        out.push("-||||||| (base)");
        out.push(...seg.base);
      }
      out.push("-=======");
      out.push(...seg.theirs);
      out.push(`->>>>>>> ${seg.theirsLabel}`);
    }
  }
  return out.join("\n");
}
