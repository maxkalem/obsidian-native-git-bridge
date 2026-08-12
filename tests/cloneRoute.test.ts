import { describe, expect, it } from "vitest";
import { cloneRoute, manualCloneCommand } from "../src/git/cloneRoute";

/**
 * The decision that keeps a clone away from a failure it cannot survive: the
 * runner never permits a prompt, so a clone that is KNOWN to have nothing to
 * authenticate with goes to the Termux terminal up front.
 */
describe("cloneRoute", () => {
  it("hands a fresh https clone to the terminal: a repository that does not exist has no credentials", () => {
    expect(
      cloneRoute({ url: "https://github.com/u/v.git", replaceExisting: false, credsConfigured: null })
    ).toBe("termux");
  });

  it("hands a re-clone to the terminal when status says no helper is configured", () => {
    expect(
      cloneRoute({ url: "https://github.com/u/v.git", replaceExisting: true, credsConfigured: false })
    ).toBe("termux");
  });

  it("keeps a re-clone on the companion route when a helper is configured", () => {
    expect(
      cloneRoute({ url: "https://github.com/u/v.git", replaceExisting: true, credsConfigured: true })
    ).toBe("companion");
  });

  it("treats unknown as 'try the ordinary route first', not as 'no credentials'", () => {
    // An older runner does not report the field; sending every such re-clone
    // to the terminal would punish exactly the installations that work.
    expect(
      cloneRoute({ url: "https://github.com/u/v.git", replaceExisting: true, credsConfigured: null })
    ).toBe("companion");
  });

  it("never routes ssh or file remotes to the terminal: keys and paths do not prompt", () => {
    for (const url of ["git@github.com:u/v.git", "ssh://git@host/v.git", "file:///sdcard/v"]) {
      expect(cloneRoute({ url, replaceExisting: false, credsConfigured: null }), url).toBe("companion");
      expect(cloneRoute({ url, replaceExisting: true, credsConfigured: false }), url).toBe("companion");
    }
  });
});

/**
 * The pasteable download command. Every piece is asserted because every piece
 * carries a decision: the wipe (an interrupted clone blocks its own retry),
 * --no-checkout (the runner's collision-safe finish owns the working tree),
 * the clone-time credential helper (typed once, saved in Termux), and the
 * `--` (a validated URL must still never be read as an option).
 */
describe("manualCloneCommand", () => {
  const base = {
    url: "https://github.com/u/v.git",
    vaultPath: "/storage/emulated/0/Documents/Kalem",
    configDir: ".obsidian",
    profileId: "p-0123456789abcdef",
  };
  const dir = "/storage/emulated/0/Documents/Kalem/.obsidian/plugins/native-git-bridge/runtime/clone-tmp/repo";

  it("builds the full command, quoted, wiping the scratch dir first", () => {
    expect(manualCloneCommand(base)).toBe(
      `rm -rf "${dir}" && git clone --no-checkout --progress ` +
        `-c credential.helper="store --file=$HOME/.config/native-git-bridge/creds/p-0123456789abcdef" ` +
        `-- "https://github.com/u/v.git" "${dir}"`
    );
  });

  it("carries the lightweight filter and the depth when asked", () => {
    const cmd = manualCloneCommand({ ...base, filter: "blob:none", depth: 100 });
    expect(cmd).toContain(" --filter=blob:none");
    expect(cmd).toContain(" --depth 100");
  });

  it("tolerates a trailing slash on the vault path", () => {
    expect(manualCloneCommand({ ...base, vaultPath: base.vaultPath + "/" })).toContain(`"${dir}"`);
  });

  it("returns null without an absolute Termux path or a profile id", () => {
    expect(manualCloneCommand({ ...base, vaultPath: "" })).toBeNull();
    expect(manualCloneCommand({ ...base, vaultPath: "relative/path" })).toBeNull();
    expect(manualCloneCommand({ ...base, profileId: "" })).toBeNull();
  });
});
