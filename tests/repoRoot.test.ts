import { describe, expect, it } from "vitest";
import {
  describeRootOffset,
  normalizeOffset,
  parseRootOffset,
  ROOTS_COINCIDE,
  toRepo,
  toVault,
  trashExcludePattern,
  VAULT_TRASH_DIR,
  type RootOffset,
} from "../src/git/repoRoot";

/**
 * The conversion between git's paths and Obsidian's. Everything here is the
 * spec's own test list, plus the cases that make the two directions stop
 * being mirror images. A wrong answer from any of these is a write to the
 * wrong file that reports success, which is why the module is pure and this
 * file exists before the call sites were touched.
 */

const SAME = ROOTS_COINCIDE;
const VAULT_IN_REPO: RootOffset = { kind: "vault-in-repo", offset: "docs" };
const REPO_IN_VAULT: RootOffset = { kind: "repo-in-vault", offset: "project" };

describe("parseRootOffset", () => {
  it("absent means the roots coincide — every installation shipped so far", () => {
    expect(parseRootOffset({})).toEqual(SAME);
    expect(parseRootOffset({ vaultInRepo: "", repoInVault: "" })).toEqual(SAME);
    expect(parseRootOffset({ vaultInRepo: "   " })).toEqual(SAME);
  });

  it("reads either arrangement", () => {
    expect(parseRootOffset({ vaultInRepo: "docs" })).toEqual(VAULT_IN_REPO);
    expect(parseRootOffset({ repoInVault: "project" })).toEqual(REPO_IN_VAULT);
    expect(parseRootOffset({ vaultInRepo: "a/b/c" })).toEqual({
      kind: "vault-in-repo",
      offset: "a/b/c",
    });
  });

  it("trims the slashes a shell path picks up", () => {
    expect(parseRootOffset({ vaultInRepo: "/docs/" })).toEqual(VAULT_IN_REPO);
    expect(parseRootOffset({ repoInVault: "project/" })).toEqual(REPO_IN_VAULT);
  });

  it("degrades anything malformed to today's behaviour, never to a wrong path", () => {
    // A wrong offset addresses the wrong file and reports success. "The roots
    // coincide" is the only safe reading of a value that cannot be trusted.
    for (const bad of ["..", "../up", "docs/..", "a//b", "."]) {
      expect(parseRootOffset({ vaultInRepo: bad }), bad).toEqual(SAME);
    }
  });

  it("refuses to guess when the runner reports both", () => {
    // Only one can be true. Both means the runner said something impossible.
    expect(parseRootOffset({ vaultInRepo: "docs", repoInVault: "project" })).toEqual(SAME);
  });
});

describe("toVault / toRepo", () => {
  it("changes nothing while the roots coincide", () => {
    expect(toVault(SAME, "src/main.ts")).toBe("src/main.ts");
    expect(toRepo(SAME, "src/main.ts")).toBe("src/main.ts");
    expect(toVault(SAME, "")).toBe("");
    expect(toRepo(SAME, "")).toBe("");
  });

  it("vault inside the repository: prefixes one way, strips the other", () => {
    expect(toRepo(VAULT_IN_REPO, "notes/x.md")).toBe("docs/notes/x.md");
    expect(toVault(VAULT_IN_REPO, "docs/notes/x.md")).toBe("notes/x.md");
    // The vault root itself, from both sides.
    expect(toRepo(VAULT_IN_REPO, "")).toBe("docs");
    expect(toVault(VAULT_IN_REPO, "docs")).toBe("");
  });

  it("vault inside the repository: a file above the vault has NO vault path", () => {
    // This is the answer, not a failure. Such a file is still listed, diffed
    // and staged — all of that goes through the runner. Only Obsidian cannot
    // address it, and the callers have to say so instead of guessing.
    expect(toVault(VAULT_IN_REPO, "src/main.ts")).toBeNull();
    expect(toVault(VAULT_IN_REPO, "README.md")).toBeNull();
  });

  it("repository inside the vault: every repository file has a vault path", () => {
    expect(toVault(REPO_IN_VAULT, "notes/x.md")).toBe("project/notes/x.md");
    expect(toRepo(REPO_IN_VAULT, "project/notes/x.md")).toBe("notes/x.md");
    expect(toVault(REPO_IN_VAULT, "")).toBe("project");
    expect(toRepo(REPO_IN_VAULT, "project")).toBe("");
  });

  it("repository inside the vault: a note beside it has NO repository path", () => {
    // The spec sketched toRepo as returning a plain string, which holds only
    // while the repository contains the vault. Here a vault file outside the
    // work tree is something git has never heard of, and handing it to the
    // runner asks about a file outside the repository.
    expect(toRepo(REPO_IN_VAULT, "Inbox/today.md")).toBeNull();
  });

  it("matches on segment boundaries, not on string prefixes", () => {
    // `project2` begins with `project` and is a different directory.
    expect(toRepo(REPO_IN_VAULT, "project2/x.md")).toBeNull();
    expect(toVault(VAULT_IN_REPO, "docs2/x.md")).toBeNull();
    expect(toVault(VAULT_IN_REPO, "docsx")).toBeNull();
  });

  it("round-trips every repository path the vault can address", () => {
    // The spec's `toRepo(toVault(p)) === p`, stated for the paths where both
    // directions exist. A repository path the vault cannot address answers
    // null on the way out and is not part of the claim — that case is the
    // "no vault path" test above, not a round trip that lost something.
    const repoPaths = [
      "",
      "a.md",
      "a/b/c.md",
      "docs/a.md",
      "project/a.md",
      ".obsidian/plugins/x/main.js",
    ];
    for (const offset of [SAME, VAULT_IN_REPO, REPO_IN_VAULT]) {
      let seen = 0;
      for (const repoPath of repoPaths) {
        const vaultPath = toVault(offset, repoPath);
        if (vaultPath === null) continue;
        seen += 1;
        expect(toRepo(offset, vaultPath), `${offset.kind} ${repoPath}`).toBe(repoPath);
      }
      // Guard the guard: an offset that answered null to everything would
      // pass this loop without comparing anything.
      expect(seen, offset.kind).toBeGreaterThan(0);
    }
  });

  it("tolerates the spellings a path picks up on the way in", () => {
    expect(toRepo(SAME, "./a/b.md")).toBe("a/b.md");
    expect(toRepo(SAME, "/a/b.md")).toBe("a/b.md");
    expect(toVault(VAULT_IN_REPO, "docs/notes/")).toBe("notes");
  });
});

describe("trashExcludePattern", () => {
  it("names the trash where git would find it", () => {
    expect(trashExcludePattern(SAME)).toBe(`${VAULT_TRASH_DIR}/`);
    expect(trashExcludePattern(VAULT_IN_REPO)).toBe("docs/.trash/");
  });

  it("is null when the trash sits outside the repository", () => {
    // Obsidian's trash is at the VAULT root. With the repository inside the
    // vault, that is above the work tree and git can never see it, so there
    // is no line to write and writing one would be a lie about the layout.
    expect(trashExcludePattern(REPO_IN_VAULT)).toBeNull();
  });
});

describe("normalizeOffset", () => {
  it("accepts a folder or a nested folder, and cleans the slashes it picks up", () => {
    expect(normalizeOffset("project")).toBe("project");
    expect(normalizeOffset("Work/project")).toBe("Work/project");
    expect(normalizeOffset("  /Work/project/ ")).toBe("Work/project");
    expect(normalizeOffset("./project")).toBe("project");
    expect(normalizeOffset("Нотатки/проєкт")).toBe("Нотатки/проєкт");
  });

  it("refuses everything that could leave the vault or break the profile file", () => {
    for (const bad of ["", "   ", "..", "../x", "a/../b", "a/./b", "a//b", ".", "/", 'a"b', "a\\b", "a\nb", "a\u0007b"]) {
      expect(normalizeOffset(bad)).toBeNull();
    }
    expect(normalizeOffset("x".repeat(513))).toBeNull();
  });
});

describe("describeRootOffset", () => {
  it("says nothing when there is nothing to say", () => {
    expect(describeRootOffset(SAME)).toBe("");
  });

  it("names the arrangement in the direction the user chose it", () => {
    expect(describeRootOffset(VAULT_IN_REPO)).toContain("docs/");
    expect(describeRootOffset(REPO_IN_VAULT)).toContain("project/");
  });
});
