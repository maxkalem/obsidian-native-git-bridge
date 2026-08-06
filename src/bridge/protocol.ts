import { PROTOCOL_VERSION } from "../constants";
import type { BridgeAction, BridgeRequest, BridgeResult } from "../types";
import { isValidRequestId } from "../settings/pathValidation";

export function makeRequestId(now: Date, rand: string): string {
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `r-${ts}-${rand}`;
}

export function randomSuffix(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  // activeWindow is Obsidian's current-window global (popout-safe); in a
  // non-browser context (tests) it is absent, and Math.random is the fallback.
  const c = typeof activeWindow !== "undefined" ? activeWindow.crypto : undefined;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (const b of arr) s += alphabet[b % alphabet.length];
  return s;
}

export function createRequest(
  action: BridgeAction,
  args: Record<string, unknown>,
  token: string,
  timeoutSeconds: number,
  now: Date = new Date(),
  rand: string = randomSuffix(),
  profileId = ""
): BridgeRequest {
  const id = makeRequestId(now, rand);
  if (!isValidRequestId(id)) throw new Error(`Generated invalid request id: ${id}`);
  const req: BridgeRequest = {
    protocolVersion: PROTOCOL_VERSION,
    id,
    token,
    action,
    createdAt: now.toISOString(),
    timeoutSeconds,
    args,
  };
  // Only sent once this vault knows its profile: an empty field would look
  // like a claim to a profile named "" to a future runner.
  if (isValidProfileId(profileId)) req.profileId = profileId;
  return req;
}

/**
 * The opaque per-vault id the Termux runner generates. Validated on both sides
 * so a garbled value never reaches a request or a profile lookup.
 */
export function isValidProfileId(id: string): boolean {
  return /^p-[0-9a-f]{8,32}$/.test(id);
}

export function serializeRequest(req: BridgeRequest): string {
  return JSON.stringify(req, null, 2);
}

/**
 * Parse a result file's text. Returns null when the JSON is not (yet) complete —
 * the poller treats that as "keep waiting", which also tolerates non-atomic
 * writes on exotic Android storage.
 */
export function parseResult(text: string): BridgeResult | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isResultShape(obj)) return null;
  return obj;
}

export function isResultShape(o: unknown): o is BridgeResult {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.protocolVersion === "number" &&
    typeof r.id === "string" &&
    typeof r.action === "string" &&
    typeof r.ok === "boolean" &&
    typeof r.exitCode === "number"
  );
}
