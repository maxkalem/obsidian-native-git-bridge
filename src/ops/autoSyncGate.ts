/**
 * Whether a periodic sync has anything to send.
 *
 * A periodic sync is a Termux round trip — twenty-odd git processes and a
 * network fetch — every N minutes for as long as Obsidian is open. Most ticks
 * would find nothing: the user is reading, or everything is already on the
 * remote. So the tick is skipped unless the data the plugin ALREADY holds says
 * there is local work the remote does not have. Nothing here asks git; that is
 * the point.
 *
 * Three sources, any one of them enough:
 *
 * - edits Obsidian itself reported since the last successful sync (vault
 *   events: modify, create, delete, rename), outside the protected paths and
 *   inside the repository — the freshest signal, and the only one that sees a
 *   change made a moment ago;
 * - the last status snapshot showing uncommitted changes (staged, unstaged,
 *   untracked or conflicted);
 * - the last status snapshot showing the branch ahead of its upstream — a
 *   commit made earlier, here, that never reached the remote.
 *
 * No status yet is "unknown", not "nothing": the sync runs and finds out.
 * The user's rule (2026-09-04): the default is a sync every 15 minutes, but a
 * tick with nothing local to send is declined.
 */
export interface AutoSyncEvidence {
  /** Vault edits seen since the last successful sync. */
  editsSinceSync: boolean;
  /** Counts from the last status the plugin holds; null when none was read. */
  status: {
    ahead: number;
    staged: number;
    unstaged: number;
    untracked: number;
    conflicted: number;
  } | null;
}

export function localWorkPending(e: AutoSyncEvidence): boolean {
  if (e.editsSinceSync) return true;
  if (e.status === null) return true;
  const s = e.status;
  return s.ahead > 0 || s.staged > 0 || s.unstaged > 0 || s.untracked > 0 || s.conflicted > 0;
}
