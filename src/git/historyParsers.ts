import { unquoteGitPath } from "./parsers";

export interface FileLogEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
  /** The file's path AT this commit (differs from the current path across renames). */
  pathAtCommit: string;
}

const RS = String.fromCharCode(0x1e); // record separator
const FS = String.fromCharCode(0x1f); // field separator

/**
 * Parse `git log --follow --name-status --format='%x1e%H%x1f%cI%x1f%an%x1f%s'`.
 * The name-status block under each record tells us the file's name at that
 * commit (rename records carry old\tnew; the file's name AT the commit is the
 * NEW one, since git log walks history backwards).
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
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("\t");
      const code = parts[0] ?? "";
      if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
        pathAtCommit = unquoteGitPath(parts[2]!);
      } else if (parts.length >= 2) {
        pathAtCommit = unquoteGitPath(parts[1]!);
      }
      if (pathAtCommit !== undefined) break;
    }
    if (pathAtCommit === undefined) pathAtCommit = lastKnownPath;
    lastKnownPath = pathAtCommit;
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      pathAtCommit,
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
