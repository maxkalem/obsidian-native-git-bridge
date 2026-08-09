/**
 * Which untracked entries a delete at a given scope will touch.
 *
 * Pure, and its own module, because the answer is used twice and the two uses
 * must not drift: the confirmation shows this list, and the deletion iterates
 * it. Git reports a fully untracked directory as one `dir/` entry rather than
 * as its contents, and that is deliberately preserved here — one entry means
 * one trash move or one runner request, not one per file inside.
 */

/**
 * @param untracked entries exactly as git reported them, directories with a
 *   trailing slash.
 * @param scope a repository-relative file or folder, or `null`, `""` or `"."`
 *   for the whole group.
 */
export function untrackedTargets(untracked: string[], scope: string | null): string[] {
  if (scope === null || scope === "" || scope === ".") return [...untracked];
  const bare = scope.endsWith("/") ? scope.slice(0, -1) : scope;
  if (bare === "") return [...untracked];
  // Segment-wise, never a bare prefix: "Private/!inbox/1" must not match
  // "Private/!inbox/10/", and with 2415 files behind one of those entries the
  // difference is not academic.
  const under = `${bare}/`;
  const at = untracked.filter((u) => u === bare || u === under || u.startsWith(under));
  if (at.length > 0) return at;
  // Nothing matched, so the scope may be a single file INSIDE a directory git
  // collapsed to one entry. The panel lists those files (from
  // `untrackedChildren`), and deleting one of them has to delete exactly it,
  // not the directory it sits in. Without this the row's button found no
  // target and did nothing at all.
  if (untracked.some((u) => u.endsWith("/") && bare.startsWith(u))) return [bare];
  return [];
}
