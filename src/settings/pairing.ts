import { normalizeOffset } from "../git/repoRoot";

/** Auto-pairing: the Termux installer drops runtime/pairing.json; the plugin
 * imports the token on startup and deletes the file. */
export interface PairingFile {
  token: string;
  repoPath?: string;
  /** Which profile (paired vault) the token belongs to; runner v10+. */
  profileId?: string;
  /**
   * Where the two roots sit relative to each other (ADR-003), so the plugin
   * knows the layout before its first status answer: the vault's place inside
   * the repository (installer route), or the repository's place inside the
   * vault (claim route). At most one is set; neither means they coincide.
   */
  vaultInRepo?: string;
  repoInVault?: string;
  createdAt?: string;
}

const TOKEN_RE = /^[A-Za-z0-9]{16,128}$/;
const PROFILE_RE = /^p-[0-9a-f]{8,32}$/;

export function parsePairingFile(text: string): PairingFile | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const r = obj as Record<string, unknown>;
  if (typeof r.token !== "string" || !TOKEN_RE.test(r.token)) return null;
  const out: PairingFile = { token: r.token };
  if (typeof r.repoPath === "string" && r.repoPath.length < 4096) out.repoPath = r.repoPath;
  if (typeof r.profileId === "string" && PROFILE_RE.test(r.profileId)) out.profileId = r.profileId;
  // A malformed offset is dropped rather than failing the whole file: the
  // token is what pairing is for, and an absent offset reads as "the roots
  // coincide", the safe answer.
  const vaultInRepo = typeof r.vaultInRepo === "string" ? normalizeOffset(r.vaultInRepo) : null;
  const repoInVault = typeof r.repoInVault === "string" ? normalizeOffset(r.repoInVault) : null;
  if (vaultInRepo !== null && repoInVault === null) out.vaultInRepo = vaultInRepo;
  if (repoInVault !== null && vaultInRepo === null) out.repoInVault = repoInVault;
  if (typeof r.createdAt === "string") out.createdAt = r.createdAt;
  return out;
}
