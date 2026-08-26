import { describe, expect, it } from "vitest";
import { identitySetupCommand, safeDirectoryCommand } from "../src/git/termuxCommands";

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
