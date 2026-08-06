import { unquoteGitPath } from "./parsers";

export interface FileLogEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
  /** The file's path AT this commit (differs from the current path across renames). */
  pathAtCommit: string;
  /** Change letter for this file in this commit (A, M, D, R, C, T). */
  code?: string;
  /** The path the file had BEFORE a rename or copy in this commit. */
  origPath?: string;
  /** Lines added / deleted (runner v9+, from --numstat; absent for binaries). */
  added?: number;
  deleted?: number;
}

/**
 * One-line description of what happened to the file in a commit, for the
 * file-history rows: "added", "+25 −12", "renamed from old.md", "deleted".
 * Falls back to the bare change letter when a v8 runner gave us no numbers.
 */
export function describeFileChange(e: FileLogEntry): string {
  const counts =
    e.added !== undefined && e.deleted !== undefined ? `+${e.added} −${e.deleted}` : "";
  switch (e.code) {
    case "A":
      return counts === "" ? "added" : `added, ${counts}`;
    case "D":
      return "deleted";
    case "R":
      return e.origPath ? `renamed from ${e.origPath}` : "renamed";
    case "C":
      return e.origPath ? `copied from ${e.origPath}` : "copied";
    case "T":
      return "type changed";
    case "M":
    default:
      return counts === "" ? (e.code ? `changed (${e.code})` : "changed") : counts;
  }
}

const RS = String.fromCharCode(0x1e); // record separator
const FS = String.fromCharCode(0x1f); // field separator

/**
 * Parse `git log --follow --raw --numstat --format='%x1e%H%x1f%cI%x1f%an%x1f%s'`.
 *
 * Each record carries up to two body lines for the file:
 *   `:100644 100644 aaa bbb R100\told.md\tnew.md`  (raw: change letter, paths)
 *   `3\t1\told.md => new.md`                        (numstat: added, deleted)
 * The raw line is authoritative for the file's name AT the commit (git log
 * walks backwards, so the NEW side is the name at that point) and for
 * telling an addition from a modification; numstat supplies the counts.
 * Output from an older runner had neither, so both are optional and the
 * name-status form (`M\tpath`) is still understood.
 */
export function parseFileLog(raw: string, currentPath: string): FileLogEntry[] {
  const out: FileLogEntry[] = [];
  let lastKnownPath = currentPath;
  for (const record of raw.split(RS)) {
    if (record.trim() === "") continue;
    const lines = record.split("\n");
    const header = lines[0] ?? "";
    const [hash, date, author, ...subj] = header.split(FS);
    if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    let pathAtCommit: string | undefined;
    let code: string | undefined;
    let origPath: string | undefined;
    let added: number | undefined;
    let deleted: number | undefined;
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("\t");
      if (line.startsWith(":")) {
        // raw: ":<modes> <shas> <STATUS>\t<path>[\t<path2>]"
        const status = (parts[0] ?? "").split(" ").pop() ?? "";
        code = status[0];
        if ((code === "R" || code === "C") && parts.length >= 3) {
          origPath = unquoteGitPath(parts[1]!);
          pathAtCommit = unquoteGitPath(parts[2]!);
        } else if (parts.length >= 2) {
          pathAtCommit = unquoteGitPath(parts[1]!);
        }
        continue;
      }
      if (/^(\d+|-)\t(\d+|-)\t/.test(line)) {
        // numstat: "<added>\t<deleted>\t<path>"; "-" marks a binary file.
        const a = parts[0] ?? "";
        const d = parts[1] ?? "";
        if (a !== "-" && d !== "-") {
          added = Number(a);
          deleted = Number(d);
        }
        if (pathAtCommit === undefined && parts.length >= 3) {
          // Rename form in numstat is "old => new"; take the new side.
          const p = parts[2]!;
          const arrow = p.indexOf(" => ");
          pathAtCommit = unquoteGitPath(arrow >= 0 ? p.slice(arrow + 4) : p);
        }
        continue;
      }
      // name-status fallback (runner v8 and older).
      if (code === undefined) {
        const c = parts[0] ?? "";
        code = c[0];
        if ((c.startsWith("R") || c.startsWith("C")) && parts.length >= 3) {
          origPath = unquoteGitPath(parts[1]!);
          pathAtCommit = unquoteGitPath(parts[2]!);
        } else if (parts.length >= 2) {
          pathAtCommit = unquoteGitPath(parts[1]!);
        }
      }
    }
    if (pathAtCommit === undefined) pathAtCommit = lastKnownPath;
    lastKnownPath = pathAtCommit;
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      pathAtCommit,
      code,
      origPath,
      added,
      deleted,
    });
  }
  return out;
}

export interface RepoLogFile {
  /** Change letter as git reports it: M, A, D, T, and R/C WITHOUT the score. */
  code: string;
  /** The file's path AT the commit (the NEW side of a rename/copy). */
  path: string;
  /** The old path for renames/copies. */
  origPath?: string;
}

export interface RepoLogEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
  files: RepoLogFile[];
}

/**
 * Parse `git log --name-status --format='%x1e%H%x1f%cI%x1f%an%x1f%s'` across
 * the whole repository (the history panel): one record per commit, each
 * carrying the full changed-file list so a commit can expand without another
 * Termux round trip.
 */
export function parseRepoLog(raw: string): RepoLogEntry[] {
  const out: RepoLogEntry[] = [];
  for (const record of raw.split(RS)) {
    if (record.trim() === "") continue;
    const lines = record.split("\n");
    const header = lines[0] ?? "";
    const [hash, date, author, ...subj] = header.split(FS);
    if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    const files: RepoLogFile[] = [];
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("\t");
      const code = parts[0] ?? "";
      if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
        files.push({
          code: code[0]!,
          path: unquoteGitPath(parts[2]!),
          origPath: unquoteGitPath(parts[1]!),
        });
      } else if (parts.length >= 2 && code !== "") {
        files.push({ code: code[0]!, path: unquoteGitPath(parts[1]!) });
      }
    }
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      files,
    });
  }
  return out;
}

/** Decode base64 (as produced by `base64 -w0`) into bytes. */
export function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Returns decoded UTF-8 text, or null when the payload looks binary (NUL byte). */
export function bytesToTextIfNotBinary(bytes: Uint8Array): string | null {
  const probe = bytes.subarray(0, Math.min(bytes.length, 8000));
  for (const b of probe) if (b === 0) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
