import { restoreHunk, type DiffHunk } from "./hunks";
import { buildWholeFilePatch, needsNoNewlineMarker } from "./hunkPatch";

/**
 * Put one block back the way it was at a commit, in the file on disk.
 *
 * Two surfaces offer this — the file-history panel's hunks and a diff opened
 * from the commit history — and they must not each have their own version of
 * it. The steps are subtle enough that a second copy would drift: the patch has
 * to be built from the texts as they are RIGHT NOW, before the file is written,
 * because afterwards `current` no longer describes what is on disk and git has
 * nothing to match the removals against.
 *
 * The file is written first and staged second, deliberately. Restoring is the
 * point; staging is a convenience, and when it fails the restore still stands,
 * so the outcome says which of the two happened rather than claiming success.
 */

export type RestoreBlockOutcome =
  | { kind: "unreadable" }
  | { kind: "stale" }
  | { kind: "unchanged" }
  | { kind: "restored"; staged: boolean; reason?: "no-newline" | "stage-failed" };

export interface RestoreBlockIO {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /** Returns false when staging failed; the file is already written by then. */
  stagePatch(patch: string): Promise<boolean>;
}

export async function restoreBlockInFile(
  path: string,
  hunk: DiffHunk,
  io: RestoreBlockIO
): Promise<RestoreBlockOutcome> {
  const current = await io.readFile(path);
  if (current === null) return { kind: "unreadable" };

  const out = restoreHunk(current, hunk);
  if (!out.ok) return { kind: "stale" };
  if (!out.changed) return { kind: "unchanged" };

  // Built BEFORE the write, for the reason in the module comment.
  const patch =
    needsNoNewlineMarker(current) || needsNoNewlineMarker(out.text)
      ? null
      : buildWholeFilePatch(path, current, out.text);
  await io.writeFile(path, out.text);

  if (patch === null) {
    // A file with no trailing newline needs git's "\ No newline at end of file"
    // marker, and getting that wrong corrupts the last line. The restore has
    // already happened, so say what is left to do rather than undo it.
    return { kind: "restored", staged: false, reason: "no-newline" };
  }
  return (await io.stagePatch(patch))
    ? { kind: "restored", staged: true }
    : { kind: "restored", staged: false, reason: "stage-failed" };
}

/** What to tell the user, given an outcome and which commit it came from. */
export function describeRestore(outcome: RestoreBlockOutcome, shortHash: string): string {
  switch (outcome.kind) {
    case "unreadable":
      return "This file cannot be edited here (binary or unreadable).";
    case "stale":
      return "That block no longer matches the current file, so it was not touched. Restore the whole file version instead.";
    case "unchanged":
      return "This block already matches that commit.";
    case "restored":
      if (outcome.staged) return `Restored one block from ${shortHash} and staged it.`;
      return outcome.reason === "no-newline"
        ? `Restored one block from ${shortHash}. Stage it from the git panel.`
        : `Restored one block from ${shortHash}, but staging it failed.`;
  }
}
