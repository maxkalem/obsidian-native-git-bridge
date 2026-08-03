export type PathValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

// Built via RegExp constructor so the source file contains no raw control bytes.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]");

/**
 * Validate and normalize a repository-relative path (protected sparse paths,
 * file arguments, ...). Rejects absolute paths, traversal, empties, control
 * characters and anything reaching into .git.
 */
export function validateRepoRelativePath(input: string): PathValidationResult {
  if (typeof input !== "string") return { ok: false, reason: "Not a string." };
  let p = input.trim();
  if (p === "") return { ok: false, reason: "Empty path." };
  if (CONTROL_CHARS.test(p)) return { ok: false, reason: "Control characters are not allowed." };
  p = p.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) return { ok: false, reason: "Absolute (drive) paths are not allowed." };
  if (p.startsWith("/")) return { ok: false, reason: "Absolute paths are not allowed." };
  if (p.startsWith("~")) return { ok: false, reason: "Home-relative paths are not allowed." };
  p = p.replace(/\/{2,}/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/+$/, "");
  if (p === "" || p === ".") return { ok: false, reason: "Path resolves to the repository root." };
  const segments = p.split("/");
  if (segments.some((s) => s === "..")) return { ok: false, reason: "Path traversal ('..') is not allowed." };
  if (segments.some((s) => s === "")) return { ok: false, reason: "Empty path segment." };
  if (segments[0]!.toLowerCase() === ".git") return { ok: false, reason: "Paths inside .git are not allowed." };
  return { ok: true, normalized: p };
}

/** Validate a list of protected paths; returns normalized list or the first error. */
export function validateProtectedPaths(
  inputs: readonly string[]
): { ok: true; normalized: string[] } | { ok: false; reason: string; offending: string } {
  const out: string[] = [];
  for (const raw of inputs) {
    const r = validateRepoRelativePath(raw);
    if (!r.ok) return { ok: false, reason: r.reason, offending: raw };
    if (!out.includes(r.normalized)) out.push(r.normalized);
  }
  return { ok: true, normalized: out };
}

export function isValidCommitHash(s: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(s);
}

export function isValidRefName(s: string): boolean {
  if (s.length === 0 || s.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(s)) return false;
  if (s.startsWith("-") || s.startsWith("/") || s.endsWith("/")) return false;
  if (s.includes("..") || s.includes("//") || s.endsWith(".lock") || s.includes("@{")) return false;
  return true;
}

export function isValidRequestId(s: string): boolean {
  return /^r-[0-9A-Za-z.TZ:-]{1,64}$/.test(s) && !s.includes("..");
}
