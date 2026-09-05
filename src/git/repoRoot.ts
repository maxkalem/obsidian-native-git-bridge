/**
 * The git repository root and the Obsidian vault root are not the same
 * directory, and this module is the only place that knows the difference.
 *
 * Everything shipped before this assumed one directory was both. The
 * assumption is invisible while it holds and dangerous the moment it does
 * not: the plugin takes REPOSITORY-relative paths out of git's output and
 * hands them to Obsidian's vault adapter, which is VAULT-relative by
 * definition. With two roots each of those calls addresses a different real
 * file and reports success.
 *
 * Two arrangements have to work, and they are not symmetrical:
 *
 * - The vault sits INSIDE the repository (`/project/.git`, vault at
 *   `/project/docs`). Repository files above the vault exist, are operable
 *   through the runner, and have no vault-relative name at all.
 *   `toVault` answers `null` for them, which is the whole point of it.
 * - The repository sits INSIDE the vault (vault at `/Main`, repository at
 *   `/Main/project`). Every repository file has a vault path; vault files
 *   outside the repository have no repository path, so `toRepo` answers
 *   `null` for those.
 *
 * The wire stays repository-relative (ADR-003): requests and results carry
 * exactly what they carry today, raw git output is parsed in TypeScript as
 * before, and the conversion happens here, at the adapter boundary, and
 * nowhere else. Views, menus, patches, sparse patterns and protected paths
 * keep working on repository-relative strings.
 *
 * An ABSENT offset means the roots coincide, which is every installation
 * that exists today and the behaviour of every runner below the version that
 * reports it. Anything malformed degrades to the same answer, deliberately:
 * a wrong offset silently addresses wrong files, and today's behaviour is
 * the only safe fallback.
 */

export type RootOffset =
  /** One directory is both roots. Every installation before this shipped. */
  | { kind: "same" }
  /** The vault is this many segments INSIDE the repository (`docs`). */
  | { kind: "vault-in-repo"; offset: string }
  /** The repository is this many segments INSIDE the vault (`project`). */
  | { kind: "repo-in-vault"; offset: string };

export const ROOTS_COINCIDE: RootOffset = { kind: "same" };

/**
 * A relative offset the plugin is willing to act on: no leading or trailing
 * slash, no empty segment, no `.` or `..`, nothing absolute, no backslash,
 * quote or control character (it becomes a profile's directory on the Termux
 * side, where a quote would break the file). The runner validates the same
 * shape (`valid_repo_offset`); this side exists because a malformed value
 * must fail into "the roots coincide" rather than into a wrong file, and so
 * that a folder the user types is refused here, with a reason, before it is
 * ever written into a claim.
 */
export function normalizeOffset(raw: string): string | null {
  const s = raw.trim().replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (s === "" || s.length > 512) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\"\x00-\x1f\x7f]/.test(s)) return null;
  const parts = s.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}

const validOffset = normalizeOffset;

/**
 * Read the offset out of the status fields. The runner reports at most one of
 * the two, because only one can be true; both together is a runner reporting
 * something impossible, and the safe reading of that is "no offset".
 */
export function parseRootOffset(fields: {
  vaultInRepo?: string;
  repoInVault?: string;
}): RootOffset {
  const vaultInRepo = validOffset(fields.vaultInRepo ?? "");
  const repoInVault = validOffset(fields.repoInVault ?? "");
  if (vaultInRepo !== null && repoInVault !== null) return ROOTS_COINCIDE;
  if (vaultInRepo !== null) return { kind: "vault-in-repo", offset: vaultInRepo };
  if (repoInVault !== null) return { kind: "repo-in-vault", offset: repoInVault };
  return ROOTS_COINCIDE;
}

/**
 * Strip `prefix/` from the front of `path`, on a SEGMENT boundary.
 *
 * The boundary is the reason this is a function and not a `startsWith`:
 * `project2/notes.md` begins with the string `project` and belongs to a
 * different directory entirely. Answering the prefix itself with `""` is the
 * root of the inner tree, which both callers need.
 */
function stripPrefix(path: string, prefix: string): string | null {
  if (path === prefix) return "";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length + 1);
  return null;
}

/** Normalise a path from either side: no leading/trailing slash, no `./`. */
function clean(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

/**
 * The vault-relative path Obsidian's adapter understands, or `null` when the
 * file lies outside the vault and Obsidian cannot address it at all.
 *
 * `null` is an answer, not a failure: with the vault inside the repository,
 * the repository legitimately holds files the vault has no name for. They are
 * still visible in the panels, still diffable and still stageable, because
 * all of that goes through the runner. Only opening and writing them from
 * Obsidian is impossible, and the callers say so instead of guessing.
 */
export function toVault(offset: RootOffset, repoPath: string): string | null {
  const p = clean(repoPath);
  switch (offset.kind) {
    case "same":
      return p;
    case "repo-in-vault":
      return p === "" ? offset.offset : `${offset.offset}/${p}`;
    case "vault-in-repo":
      return stripPrefix(p, offset.offset);
  }
}

/**
 * The repository-relative path git understands, or `null` when the file lies
 * outside the repository.
 *
 * The two directions are not mirror images. The spec's original sketch had
 * this returning a plain string, which is true only while the repository
 * contains the vault; with the repository INSIDE the vault, a note beside it
 * is a vault file that git has never heard of, and a caller that treats that
 * as a repository path asks the runner about a file outside the work tree.
 */
export function toRepo(offset: RootOffset, vaultPath: string): string | null {
  const p = clean(vaultPath);
  switch (offset.kind) {
    case "same":
      return p;
    case "vault-in-repo":
      return p === "" ? offset.offset : `${offset.offset}/${p}`;
    case "repo-in-vault":
      return stripPrefix(p, offset.offset);
  }
}

/** Obsidian's trash is always `.trash` at the VAULT root, on every platform. */
export const VAULT_TRASH_DIR = ".trash";

/**
 * The `.git/info/exclude` line that keeps Obsidian's trash out of git, or
 * `null` when the trash is not inside the repository and no line is needed.
 *
 * Why this exists at all: `.trash` is excluded nowhere in this project, and
 * staging is `git add -A`. Anything that lands there — a note the user
 * deleted in Obsidian, an untracked file this plugin moved out of the way,
 * or a file the sparse repair moved out of a PROTECTED path — is picked up
 * by the next commit. The protected-path case is the bad one: sparse hides
 * those files precisely so they never travel, and the trash carries them
 * straight back in. A user whose own `.gitignore` covers `.trash` never sees
 * any of it, which is why it went unnoticed.
 *
 * The exclude file rather than `.gitignore`: it is per clone, never
 * committed, and never a tracked file, so this stays a decision about this
 * device and cannot arrive on another one as a change.
 */
export function trashExcludePattern(offset: RootOffset): string | null {
  const p = toRepo(offset, VAULT_TRASH_DIR);
  return p === null ? null : `${p}/`;
}

/** Human wording for a panel header or a check window; empty when they coincide. */
export function describeRootOffset(offset: RootOffset): string {
  switch (offset.kind) {
    case "same":
      return "";
    case "vault-in-repo":
      return `The vault is ${offset.offset}/ inside the repository.`;
    case "repo-in-vault":
      return `The repository is ${offset.offset}/ inside the vault.`;
  }
}
