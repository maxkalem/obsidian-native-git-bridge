import { redact } from "./OperationLog";

/**
 * Reading what the runner writes while it is still working.
 *
 * A long operation used to be silent on both sides. The runner captured git's
 * stderr into a private temporary file and read it only after git exited, so
 * for the fifteen minutes an object repair takes, the plugin had nothing to
 * show but its own count of elapsed seconds — three percent in and completely
 * wedged looked exactly the same.
 *
 * The runner now appends that stderr to `runtime/progress/<id>.txt`. This module
 * turns the file into something a person can read; the file itself is raw,
 * because collapsing it is the reader's job and the runner must not spend the
 * device's battery reformatting a stream nobody may ever look at.
 */

/**
 * What a terminal would have shown.
 *
 * git draws its meter by writing a chunk, then a carriage return, then the next
 * chunk over the top, with no newline until the very end. Printed literally
 * that is one enormous line containing every percentage it ever passed through.
 * Keeping only the text after the last `\r` on each line leaves the final state
 * of each step, which is what the meter was for.
 *
 * Trailing blanks go too: git pads a chunk with spaces so the next, shorter one
 * erases it completely. On a terminal that is invisible; in a file it is noise
 * at the end of every line.
 */
export function collapseProgress(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const chunks = line.split("\r");
      return (chunks[chunks.length - 1] ?? "").replace(/[ \t]+$/, "");
    })
    .join("\n");
}

/**
 * The single line worth putting next to the elapsed-seconds ticker: the newest
 * one that says anything.
 *
 * Redacted, and not as a formality. Progress output carries the remote URL —
 * `remote: Enumerating objects`, `From https://…@github.com/…` — and a token
 * lives in exactly that position for anyone using a PAT over https. This text
 * goes to the screen and into the shareable log bundle, so it passes the same
 * filter as every other line the plugin records.
 *
 * Long lines are cut rather than wrapped: the caller appends this to an
 * existing status line on a phone-width panel.
 */
export function lastProgressLine(raw: string, maxChars = 64): string | null {
  const lines = collapseProgress(raw)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  const clean = redact(last);
  return clean.length > maxChars ? clean.slice(0, maxChars - 1) + "…" : clean;
}

/**
 * The whole stream as it goes into a shared log bundle: collapsed, redacted,
 * and cut to a budget from the END, because the interesting part of a stream
 * that was still running when something went wrong is the part nearest the
 * failure.
 */
export function progressForBundle(raw: string, maxBytes = 8 * 1024): string {
  const text = redact(collapseProgress(raw)).replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= maxBytes) return text;
  const kept = text.slice(text.length - maxBytes);
  const from = kept.indexOf("\n");
  return `… (${text.length - maxBytes} earlier bytes omitted)\n${from >= 0 ? kept.slice(from + 1) : kept}`;
}
