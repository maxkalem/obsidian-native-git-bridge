/** Auto-pairing: the Termux installer drops runtime/pairing.json; the plugin
 * imports the token on startup and deletes the file. */
export interface PairingFile {
  token: string;
  repoPath?: string;
  createdAt?: string;
}

const TOKEN_RE = /^[A-Za-z0-9]{16,128}$/;

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
  if (typeof r.createdAt === "string") out.createdAt = r.createdAt;
  return out;
}
