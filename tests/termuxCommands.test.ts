import { describe, expect, it } from "vitest";
import {
  credentialsSetupCommand,
  dropGlobalCredHelperCommand,
  identitySetupCommand,
  safeDirectoryCommand,
} from "../src/git/termuxCommands";

/**
 * These commands are handed to a person, so every piece has to be right the
 * first time: a wrong path is pasted and run before anyone can check it. The
 * guards mirror manualCloneCommand's — no path, no command — and the values
 * git needs are typed at the terminal, never interpolated here (the user's
 * rule: neither the plugin nor the runner may learn the git name or email).
 */

const REPO = "/storage/emulated/0/Documents/Kalem";

describe("identitySetupCommand", () => {
  it("refuses an unknown or relative path — there is nothing honest to build", () => {
    expect(identitySetupCommand("")).toBeNull();
    expect(identitySetupCommand("   ")).toBeNull();
    expect(identitySetupCommand("Documents/Kalem")).toBeNull();
  });

  it("addresses the repository, asks at the terminal, and lists names back", () => {
    const cmd = identitySetupCommand(REPO);
    expect(cmd).not.toBeNull();
    // The path is quoted: vault paths carry spaces on real devices.
    expect(cmd).toContain(`cd "${REPO}"`);
    // read -p is what makes the typed values visible as they are typed.
    expect(cmd).toContain('read -p "user.name: "');
    expect(cmd).toContain('read -p "user.email: "');
    // LOCAL scope, both keys: the whole point is an identity a re-clone
    // cannot silently replace with the global one.
    expect(cmd).toContain("git config --local user.name");
    expect(cmd).toContain("git config --local user.email");
    // The closing listing is git answering visibly — names only, no values.
    expect(cmd).toContain("--name-only --get-regexp");
    // Nothing here prints a value: no --get without --name-only.
    expect(cmd).not.toMatch(/--get (user|credential)/);
  });

  it("pages nothing: the listing runs at a tty where a broken core.pager kills it", () => {
    // A real device had core.pager pointing at a missing program; the listing
    // then died with "unable to execute pager" AFTER the identity was written,
    // which read as the whole command failing. --no-pager is the defence.
    expect(identitySetupCommand(REPO)).toContain(
      "git --no-pager config --local --name-only --get-regexp"
    );
  });

  it("trims a trailing slash so the quoted path stays canonical", () => {
    expect(identitySetupCommand(`${REPO}/`)).toContain(`cd "${REPO}"`);
  });
});

describe("safeDirectoryCommand", () => {
  it("refuses an unknown or relative path", () => {
    expect(safeDirectoryCommand("")).toBeNull();
    expect(safeDirectoryCommand("Documents/Kalem")).toBeNull();
  });

  it("is exactly the one-line fix the runner's refusal names", () => {
    expect(safeDirectoryCommand(REPO)).toBe(
      `git config --global --add safe.directory "${REPO}"`
    );
  });
});

describe("dropGlobalCredHelperCommand", () => {
  const cmd = dropGlobalCredHelperCommand();

  it("unsets by name and never reads a value", () => {
    expect(cmd).toBe("git config --global --unset-all credential.helper");
    // A --get of any kind would print the helper's value into the terminal.
    expect(cmd).not.toContain("--get");
  });

  it("says nothing about itself: one action needs no echo", () => {
    // The user's rule (2026-08-28): an echo earns its place when a command
    // runs in several steps, takes long enough that silence reads as a hang,
    // or waits for the user to type. None of that is true here, and the
    // window that offered the removal carries "Check again" for the proof.
    expect(cmd).not.toContain("echo");
    expect(cmd).not.toContain(";");
    expect(cmd).not.toContain("&&");
  });

  it("is global-only: it addresses no repository and needs no path", () => {
    expect(cmd).not.toContain("cd ");
    expect(cmd).not.toContain("--local");
  });
});

describe("credentialsSetupCommand", () => {
  const PROFILE = "p-0123456789abcdef";
  const HTTPS = "https://github.com/maxkalem/obsidian-native-git-bridge.git";
  const base = { repoPathHint: REPO, profileId: PROFILE, remoteUrl: HTTPS };

  it("refuses an unknown or relative path", () => {
    expect(credentialsSetupCommand({ ...base, repoPathHint: "" })).toBeNull();
    expect(credentialsSetupCommand({ ...base, repoPathHint: "Documents/Kalem" })).toBeNull();
  });

  it("rewrites the helper, erases the dead entry, and ends at a prompt", () => {
    const cmd = credentialsSetupCommand(base) ?? "";
    expect(cmd).toContain(`cd "${REPO}"`);
    // The empty value first: the helper list accumulates across scopes and the
    // first helper that answers wins, so a global one would keep serving the
    // same dead token.
    expect(cmd).toContain("git config --local --add credential.helper ''");
    expect(cmd).toContain(
      `git config --local --add credential.helper "store --file=$HOME/.config/native-git-bridge/creds/${PROFILE}"`
    );
    // `;` after the unset: it exits 5 when the key was never there, which is
    // exactly the repository that needs the adds.
    expect(cmd).toContain("git config --local --unset-all credential.helper; ");
    // The reject is what makes git ask instead of reusing what it has.
    expect(cmd).toContain(`printf 'url=%s\\n\\n' "${HTTPS}" | git credential reject`);
    expect(cmd.endsWith("git fetch")).toBe(true);
  });

  it("is the fetch alone for ssh: no helper serves an ssh key", () => {
    const scp = credentialsSetupCommand({ ...base, remoteUrl: "git@github.com:maxkalem/x.git" });
    const ssh = credentialsSetupCommand({ ...base, remoteUrl: "ssh://git@github.com/maxkalem/x" });
    expect(scp).toBe(`cd "${REPO}" && git fetch`);
    expect(ssh).toBe(`cd "${REPO}" && git fetch`);
  });

  it("falls back to the fetch when the remote or the profile is not known", () => {
    expect(credentialsSetupCommand({ ...base, remoteUrl: "" })).toBe(`cd "${REPO}" && git fetch`);
    expect(credentialsSetupCommand({ ...base, profileId: "" })).toBe(`cd "${REPO}" && git fetch`);
    expect(credentialsSetupCommand({ ...base, profileId: "p-not-hex" })).toBe(
      `cd "${REPO}" && git fetch`
    );
  });

  it("never lets a remote URL out of git's hands and into the shell's", () => {
    // lastRemoteUrl comes from `git config`, not from a field this plugin
    // validated, so a URL carrying $(…), a backtick, a quote or a backslash
    // would be read by the shell. Such a URL loses the https branch instead of
    // being quoted more cleverly.
    for (const bad of [
      'https://github.com/a/"b".git',
      "https://github.com/a/$(id).git",
      "https://github.com/a/`id`.git",
      "https://github.com/a/b\\.git",
      "https://github.com/a/b .git",
    ]) {
      expect(credentialsSetupCommand({ ...base, remoteUrl: bad })).toBe(
        `cd "${REPO}" && git fetch`
      );
    }
  });

  it("carries no credential of its own — the token is typed in Termux", () => {
    const cmd = credentialsSetupCommand(base) ?? "";
    expect(cmd).not.toMatch(/password|token|--get credential/i);
  });

  it("trims a trailing slash so the quoted path stays canonical", () => {
    expect(credentialsSetupCommand({ ...base, repoPathHint: `${REPO}/` })).toContain(
      `cd "${REPO}"`
    );
  });
});
