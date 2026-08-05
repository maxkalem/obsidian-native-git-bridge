import type { GitFileEntry, GitStatusSummary, SparseStateSummary } from "../types";

/**
 * Unquote a path as printed by git when core.quotePath=true:
 * surrounded by double quotes, C-style escapes, octal escapes are UTF-8 bytes.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  const enc = new TextEncoder();
  let i = 0;
  while (i < inner.length) {
    const c = inner[i]!;
    if (c !== "\\") {
      for (const b of enc.encode(c)) bytes.push(b);
      i++;
      continue;
    }
    const n = inner[i + 1];
    if (n === undefined) break;
    const simple: Record<string, number> = {
      a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34,
    };
    if (simple[n] !== undefined) {
      bytes.push(simple[n]);
      i += 2;
      continue;
    }
    if (n >= "0" && n <= "7") {
      let oct = "";
      let j = i + 1;
      while (j < inner.length && oct.length < 3) {
        const d = inner[j]!;
        if (d < "0" || d > "7") break;
        oct += d;
        j++;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
      i = j;
      continue;
    }
    // Unknown escape: keep literally.
    for (const b of enc.encode(n)) bytes.push(b);
    i += 2;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

/** Parse `git status --porcelain=v2 --branch` output. */
export function parseStatusPorcelainV2(text: string): GitStatusSummary {
  const s: GitStatusSummary = {
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    if (line.startsWith("# branch.oid ")) {
      const v = line.slice("# branch.oid ".length);
      if (v !== "(initial)") s.oid = v;
    } else if (line.startsWith("# branch.head ")) {
      const v = line.slice("# branch.head ".length);
      if (v === "(detached)") s.detached = true;
      else s.branch = v;
    } else if (line.startsWith("# branch.upstream ")) {
      s.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        s.ahead = parseInt(m[1]!, 10);
        s.behind = parseInt(m[2]!, 10);
      }
    } else if (line.startsWith("1 ")) {
      // 1 XY sub mH mI mW hH hI path
      const parts = splitN(line, " ", 8);
      if (parts.length === 9) {
        const xy = parts[1]!;
        pushEntry(s, {
          path: unquoteGitPath(parts[8]!),
          index: xy[0] ?? ".",
          worktree: xy[1] ?? ".",
        });
      }
    } else if (line.startsWith("2 ")) {
      // 2 XY sub mH mI mW hH hI Xscore path<TAB>origPath
      const parts = splitN(line, " ", 9);
      if (parts.length === 10) {
        const xy = parts[1]!;
        const [p, orig] = parts[9]!.split("\t");
        pushEntry(s, {
          path: unquoteGitPath(p ?? ""),
          origPath: orig !== undefined ? unquoteGitPath(orig) : undefined,
          index: xy[0] ?? ".",
          worktree: xy[1] ?? ".",
        });
      }
    } else if (line.startsWith("u ")) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = splitN(line, " ", 10);
      if (parts.length === 11) {
        const xy = parts[1]!;
        s.conflicted.push({
          path: unquoteGitPath(parts[10]!),
          index: xy[0] ?? ".",
          worktree: xy[1] ?? ".",
        });
      }
    } else if (line.startsWith("? ")) {
      s.untracked.push(unquoteGitPath(line.slice(2)));
    }
    // "! " ignored entries are not tracked here.
  }
  return s;
}

/**
 * Group the runner's `untrackedChildren` listing (newline-separated file
 * paths, raw/unquoted because the runner collects them with `-z`) under the
 * untracked directory entries reported by git status. Directories reported by
 * status are disjoint (git collapses at the topmost untracked level), so each
 * child belongs to at most one of them; children matching no reported
 * directory are dropped rather than invented into the UI.
 */
export function groupUntrackedChildren(
  childrenText: string,
  untracked: readonly string[]
): Record<string, string[]> {
  const dirs = untracked.filter((u) => u.endsWith("/"));
  const out: Record<string, string[]> = {};
  if (dirs.length === 0) return out;
  for (const rawLine of childrenText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const dir = dirs.find((d) => line.startsWith(d));
    if (dir === undefined) continue;
    // The directory row itself is already in `untracked`; keep files only.
    if (line === dir) continue;
    (out[dir] ??= []).push(line);
  }
  return out;
}

function pushEntry(s: GitStatusSummary, e: GitFileEntry): void {
  if (e.index !== ".") s.staged.push(e);
  if (e.worktree !== ".") s.unstaged.push(e);
}

/** Split into at most n+1 pieces on sep (like String.split with limit that keeps the tail). */
function splitN(line: string, sep: string, n: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let k = 0; k < n; k++) {
    const idx = rest.indexOf(sep);
    if (idx < 0) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}

/** Parse `git status --porcelain=v1` output (used for protected-path safety checks). */
export function parseStatusPorcelainV1(text: string): GitFileEntry[] {
  const entries: GitFileEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    let rest = line.slice(3);
    let orig: string | undefined;
    if (x === "R" || x === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow >= 0) {
        orig = unquoteGitPath(rest.slice(0, arrow));
        rest = rest.slice(arrow + 4);
      }
    }
    entries.push({
      path: unquoteGitPath(rest),
      origPath: orig,
      index: x === " " ? "." : x,
      worktree: y === " " ? "." : y,
    });
  }
  return entries;
}

/** Parse `git diff --cached --name-status` output (tab-separated). */
export function parseNameStatus(text: string): GitFileEntry[] {
  const entries: GitFileEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const kind = code[0] ?? "?";
    if ((kind === "R" || kind === "C") && parts.length >= 3) {
      entries.push({
        path: unquoteGitPath(parts[2]!),
        origPath: unquoteGitPath(parts[1]!),
        index: kind,
        worktree: ".",
      });
    } else if (parts.length >= 2) {
      entries.push({ path: unquoteGitPath(parts[1]!), index: kind, worktree: "." });
    }
  }
  return entries;
}

/** Count skip-worktree entries from `git ls-files -v` output ("S " prefix). */
export function countSkipWorktree(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("S ")) n++;
  }
  return n;
}

/**
 * Repo-relative paths hidden by non-cone sparse EXCLUSION patterns
 * (e.g. `!/Private/Hidden/` -> `Private/Hidden`). Only clean
 * literal exclusions qualify: wildcard patterns cannot be mapped to a single
 * protectable path and are skipped — deriving protection from them would give
 * a false sense of safety.
 */
export function sparseExclusionPaths(patterns: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of patterns) {
    let p = raw.trim();
    if (!p.startsWith("!")) continue;
    p = p.slice(1).trim();
    if (p.startsWith("/")) p = p.slice(1);
    p = p.replace(/\/+$/, "");
    if (p === "" || /[*?[\]]/.test(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function parseSparseState(fields: {
  sparseEnabled: string;
  sparseCone: string;
  sparseList: string;
  /** Legacy: full `git ls-files -v` output. Prefer skipWorktreeCount. */
  lsFilesV?: string;
  /** Preferred: count computed by the runner (the full list can be megabytes). */
  skipWorktreeCount?: string;
}): SparseStateSummary {
  const enabled = fields.sparseEnabled.trim() === "true";
  const coneRaw = fields.sparseCone.trim();
  return {
    enabled,
    coneMode: coneRaw === "" ? undefined : coneRaw === "true",
    patterns: fields.sparseList
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
    skipWorktreeCount: resolveSkipCount(fields.skipWorktreeCount, fields.lsFilesV),
  };
}

/** Parse `git log -1 --format=%H%x09%cI%x09%s`. */
function resolveSkipCount(count: string | undefined, lsFilesV: string | undefined): number {
  if (count !== undefined && count.trim() !== "") {
    const n = parseInt(count.trim(), 10);
    if (!Number.isNaN(n)) return n;
  }
  return countSkipWorktree(lsFilesV ?? "");
}

export function parseLastCommit(
  text: string
): { hash: string; date: string; subject: string } | undefined {
  const line = text.split("\n")[0]?.trim();
  if (!line) return undefined;
  const [hash, date, ...subj] = line.split("\t");
  if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) return undefined;
  return { hash, date: date ?? "", subject: subj.join("\t") };
}
