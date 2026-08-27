import { describe, expect, it } from "vitest";
import {
  isValidBranchName,
  redactRemoteUrl,
  remoteFileUrl,
  validateRemoteUrl,
  MAX_REMOTE_URL_LENGTH,
} from "../src/git/remoteUrl";

/**
 * The plugin's half of the remote-URL rules. The runner enforces the same ones
 * again; this side exists so a typo is answered without a Termux round trip.
 * Every rejection here must also be a rejection there — the e2e suite checks
 * the runner against the same cases.
 */
/**
 * Open item 8's rule, verbatim: a wrong link is worse than no link. The
 * mapper answers only for the two hosts whose URL shapes are published, and
 * refuses everything else instead of guessing.
 */
describe("remoteFileUrl", () => {
  const HASH = "0123abcd4567ef89";

  it("maps the four spellings of a github.com remote to the same blob URL", () => {
    const want = `https://github.com/me/vault/blob/${HASH}/Notes/a.md`;
    for (const remote of [
      "https://github.com/me/vault.git",
      "https://github.com/me/vault",
      "git@github.com:me/vault.git",
      // The runner redacts userinfo to ***@; the mapper drops it entirely,
      // so no URL handed to another app can carry even the marker.
      "https://***@github.com/me/vault.git",
    ]) {
      expect(remoteFileUrl(remote, "Notes/a.md", HASH), remote).toBe(want);
    }
  });

  it("maps gitlab.com with its own /-/blob/ shape", () => {
    expect(remoteFileUrl("https://gitlab.com/me/vault.git", "a.md", HASH)).toBe(
      `https://gitlab.com/me/vault/-/blob/${HASH}/a.md`
    );
  });

  it("encodes path segments without touching the slashes", () => {
    expect(remoteFileUrl("https://github.com/me/vault.git", "П/є ї.md", HASH)).toBe(
      `https://github.com/me/vault/blob/${HASH}/%D0%9F/%D1%94%20%D1%97.md`
    );
  });

  it("refuses what it cannot map, rather than guessing", () => {
    for (const remote of [
      "https://gitlab.example.com/group/vault.git", // self-hosted: shape unknown
      "https://github.com/me/group/vault.git", // deeper than owner/repo
      "ssh://git@github.com/me/vault.git", // ssh:// form not mapped (scp form is)
      "file:///storage/emulated/0/backup/vault.git",
      "",
    ]) {
      expect(remoteFileUrl(remote, "a.md", HASH), remote).toBeNull();
    }
    // A commit that is not a hash never builds a URL.
    expect(remoteFileUrl("https://github.com/me/vault.git", "a.md", "WORKTREE")).toBeNull();
  });
});

describe("validateRemoteUrl", () => {
  it("accepts the four forms a phone user actually has", () => {
    for (const url of [
      "https://github.com/me/vault.git",
      "https://gitlab.example.com:8443/group/sub/vault.git",
      "ssh://git@github.com/me/vault.git",
      "ssh://git@host:2222/srv/git/vault.git",
      "git@github.com:me/vault.git",
      "deploy@10.0.0.5:/srv/git/vault.git",
      "file:///storage/emulated/0/backup/vault.git",
    ]) {
      expect(validateRemoteUrl(url), url).toMatchObject({ ok: true, url });
    }
  });

  it("refuses a URL that carries a password", () => {
    // It would be written into the request file inside the vault and into
    // .git/config. Credentials live in Termux, never here.
    const v = validateRemoteUrl("https://user:ghp_secret@github.com/me/vault.git");
    expect(v.ok).toBe(false);
    expect(v.problem).toBe("credentials");
    expect(v.reason).toMatch(/credentials stay in Termux/i);
  });

  it("keeps ssh's userinfo but refuses ANY userinfo on https", () => {
    // ssh://git@host is the universal ssh user, not a secret. On https a
    // "username" is routinely a personal access token with no password at
    // all (https://ghp_…@github.com/…), which the colon-requiring rule used
    // to wave through — a real vault carried its token into .git/config that
    // way, and cleaning it up is what broke the device's working auth.
    expect(validateRemoteUrl("ssh://git@github.com/me/vault.git").ok).toBe(true);
    const v = validateRemoteUrl("https://ghp_token123@github.com/me/vault.git");
    expect(v.ok).toBe(false);
    expect(v.problem).toBe("credentials");
  });

  it("refuses anything git would read as an option", () => {
    for (const url of ["-oProxyCommand=id", "--upload-pack=id", "-"]) {
      expect(validateRemoteUrl(url).problem, url).toBe("option-like");
    }
  });

  it("refuses schemes that are not one of the four", () => {
    for (const url of [
      "http://example.com/x.git",
      "git://example.com/x.git",
      "ext::sh -c id",
      "file://relative/path",
      "/storage/emulated/0/vault.git",
      "example.com/x.git",
    ]) {
      expect(validateRemoteUrl(url).ok, url).toBe(false);
    }
  });

  it("refuses whitespace, control characters and non-ASCII", () => {
    expect(validateRemoteUrl("https://exa mple.com/x.git").problem).toBe("not-printable-ascii");
    expect(validateRemoteUrl("https://example.com/x.git").problem).toBe("not-printable-ascii");
    // Surrounding whitespace is trimmed, not rejected: pasting from a phone
    // keyboard adds a trailing newline more often than not.
    expect(validateRemoteUrl("https://example.com/x.git\n").ok).toBe(true);
    expect(validateRemoteUrl("https://пример.рф/x.git").problem).toBe("not-printable-ascii");
  });

  it("refuses an empty or oversized URL", () => {
    expect(validateRemoteUrl("   ").problem).toBe("empty");
    expect(validateRemoteUrl("https://e.com/" + "a".repeat(MAX_REMOTE_URL_LENGTH)).problem).toBe("too-long");
  });

  it("trims before judging", () => {
    expect(validateRemoteUrl("  https://github.com/me/vault.git  ")).toMatchObject({
      ok: true,
      url: "https://github.com/me/vault.git",
    });
  });
});

describe("redactRemoteUrl", () => {
  it("hides whatever sits before the host", () => {
    expect(redactRemoteUrl("https://token@github.com/me/v.git")).toBe("https://***@github.com/me/v.git");
    expect(redactRemoteUrl("https://u:p@github.com/me/v.git")).toBe("https://***@github.com/me/v.git");
  });
  it("leaves a plain URL alone", () => {
    expect(redactRemoteUrl("https://github.com/me/v.git")).toBe("https://github.com/me/v.git");
    expect(redactRemoteUrl("git@github.com:me/v.git")).toBe("git@github.com:me/v.git");
  });
});

describe("isValidBranchName", () => {
  it("accepts ordinary branch names", () => {
    for (const b of ["main", "master", "trunk", "feature/x", "v1.2-rc"]) {
      expect(isValidBranchName(b), b).toBe(true);
    }
  });
  it("rejects what git or an argv parser would object to", () => {
    for (const b of ["", "-b", "--upload-pack=id", "a..b", "a//b", "x.lock", "x/", "réf", "a b"]) {
      expect(isValidBranchName(b), b).toBe(false);
    }
  });
});
