/**
 * Remote URL validation, the plugin's half.
 *
 * The runner validates the same URL again with the same rules — this side
 * exists so a typo is answered instantly instead of after a Termux round trip,
 * and so the reason can be spelled out while the user is still looking at the
 * field they typed it into.
 *
 * The rules are deliberately narrow:
 *  - `https://`, `ssh://`, `user@host:path` and `file:///absolute/path` only;
 *  - nothing may start with `-`, which git would read as an option;
 *  - printable ASCII, no spaces, no control characters;
 *  - **no credentials in the URL**. A `https://user:token@host/…` would be
 *    written into the request file inside the vault and into `.git/config`,
 *    and this plugin's rule is that no secret ever reaches the plugin side.
 *    Authentication belongs to a credential helper or an SSH key, in Termux.
 */

export const MAX_REMOTE_URL_LENGTH = 512;

export type RemoteUrlProblem =
  | "empty"
  | "too-long"
  | "option-like"
  | "not-printable-ascii"
  | "credentials"
  | "unsupported-scheme";

export interface RemoteUrlVerdict {
  ok: boolean;
  /** Trimmed URL; only meaningful when ok. */
  url: string;
  problem?: RemoteUrlProblem;
  /** Ready to show to the user. */
  reason?: string;
}

const REASONS: Record<RemoteUrlProblem, string> = {
  empty: "Enter the repository URL.",
  "too-long": `The URL is longer than ${MAX_REMOTE_URL_LENGTH} characters.`,
  "option-like":
    "A URL may not start with '-': git would read it as an option, not an address.",
  "not-printable-ascii":
    "The URL contains a space or a character that is not plain ASCII. Copy it again from your git host.",
  credentials:
    "This URL carries credentials before the '@'. Use the clean https://host/… form: credentials stay in Termux (asked for once and saved there), and this plugin never handles one. A token pasted as the username is still a token — a real vault lost its working setup to exactly that shape.",
  "unsupported-scheme":
    "Use https://host/owner/repo.git, ssh://host/path, git@host:owner/repo.git, or file:///absolute/path for a local copy. Plain http and git:// are not accepted.",
};

const PRINTABLE_ASCII = /^[!-~]+$/;
// Two shapes of credentials-in-the-URL, and the second is the one that got
// away. `user:password` is refused in every scheme. For https, ANY userinfo
// is refused: a personal access token is routinely pasted as the USERNAME
// with no password at all (`https://ghp_…@github.com/…`), and the pattern
// that required a colon walked straight past it — the same hole redact() and
// redact_url each had once. A real device then carried its token into
// `.git/config` through the clone prompt, and the installer's later cleanup
// of exactly that URL is how its working setup broke. A plain username hint
// is refused along with the token: the two are indistinguishable, and in
// this design credentials are entered once in Termux and saved there.
// `ssh://git@host/…` keeps its userinfo — the universal ssh user is not a
// secret, and ssh authenticates with a key.
const CREDENTIALS = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/;
const HTTPS_USERINFO = /^https:\/\/[^/@]+@/i;
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^ ]+$/;

export function validateRemoteUrl(raw: string): RemoteUrlVerdict {
  const url = raw.trim();
  const fail = (problem: RemoteUrlProblem): RemoteUrlVerdict => ({
    ok: false,
    url,
    problem,
    reason: REASONS[problem],
  });
  if (url === "") return fail("empty");
  if (url.length > MAX_REMOTE_URL_LENGTH) return fail("too-long");
  if (url.startsWith("-")) return fail("option-like");
  if (!PRINTABLE_ASCII.test(url)) return fail("not-printable-ascii");
  if (CREDENTIALS.test(url)) return fail("credentials");
  if (HTTPS_USERINFO.test(url)) return fail("credentials");
  if (url.startsWith("https://") || url.startsWith("ssh://") || url.startsWith("file:///")) {
    return { ok: true, url };
  }
  if (SCP_LIKE.test(url)) return { ok: true, url };
  return fail("unsupported-scheme");
}

/**
 * What to show instead of a URL that may carry a username. The runner redacts
 * `user:pass@` the same way; this covers the display side (settings, logs,
 * result windows) for URLs that were configured outside the plugin.
 */
export function redactRemoteUrl(url: string): string {
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]+@/, "$1***@");
}

/** Branch names accepted by the bootstrap actions (a safe subset of git's rules). */
export function isValidBranchName(name: string): boolean {
  if (name === "" || name.length > 100) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return false;
  if (name.includes("..") || name.includes("//")) return false;
  if (name.endsWith(".lock") || name.endsWith("/")) return false;
  return true;
}
