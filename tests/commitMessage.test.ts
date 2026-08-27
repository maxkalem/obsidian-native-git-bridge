import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMIT_DATE_FORMAT,
  DEFAULT_COMMIT_TEMPLATE,
  formatCommitDate,
  pushRecentMessage,
  renderCommitTemplate,
} from "../src/git/commitMessage";

/**
 * Commit message templates (0.6.7, item 6). The model is obsidian-git's, by
 * the user's decision: {{date}} in device-local time, "YYYY-MM-DD HH:mm:ss"
 * by default, sync commits with the rendered template and never asks.
 */
describe("formatCommitDate", () => {
  // Months are 0-based in the constructor; this is 2026-08-07 09:05:03 local.
  const d = new Date(2026, 7, 7, 9, 5, 3);

  it("renders the obsidian-git default format with zero padding", () => {
    expect(formatCommitDate(DEFAULT_COMMIT_DATE_FORMAT, d)).toBe("2026-08-07 09:05:03");
  });

  it("supports the two-digit year without eating the four-digit token", () => {
    expect(formatCommitDate("YY YYYY", d)).toBe("26 2026");
    expect(formatCommitDate("YYYY-YY", d)).toBe("2026-26");
  });

  it("leaves unknown text alone", () => {
    expect(formatCommitDate("backup DD.MM.", d)).toBe("backup 07.08.");
  });
});

describe("renderCommitTemplate", () => {
  const d = new Date(2026, 7, 7, 9, 5, 3);

  it("replaces every {{date}}, and a template without one stays verbatim", () => {
    expect(renderCommitTemplate(DEFAULT_COMMIT_TEMPLATE, DEFAULT_COMMIT_DATE_FORMAT, d)).toBe(
      "Update 2026-08-07 09:05:03"
    );
    expect(renderCommitTemplate("{{date}} and {{date}}", "YYYY", d)).toBe("2026 and 2026");
    expect(renderCommitTemplate("plain words", DEFAULT_COMMIT_DATE_FORMAT, d)).toBe("plain words");
  });
});

describe("pushRecentMessage", () => {
  it("keeps the newest first, lifts duplicates instead of repeating them, and caps", () => {
    let r: string[] = [];
    r = pushRecentMessage(r, "one", 3);
    r = pushRecentMessage(r, "two", 3);
    r = pushRecentMessage(r, "three", 3);
    expect(r).toEqual(["three", "two", "one"]);
    // A repeat moves up rather than appearing twice.
    r = pushRecentMessage(r, "one", 3);
    expect(r).toEqual(["one", "three", "two"]);
    // The cap drops the oldest.
    r = pushRecentMessage(r, "four", 3);
    expect(r).toEqual(["four", "one", "three"]);
  });

  it("a cap of 0 keeps nothing (the recents switched off), and blanks are never stored", () => {
    expect(pushRecentMessage(["kept"], "new", 0)).toEqual([]);
    expect(pushRecentMessage(["kept"], "   ", 5)).toEqual(["kept"]);
  });
});
