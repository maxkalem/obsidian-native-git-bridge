import { beforeEach, describe, expect, it } from "vitest";
import { __findByClass, __resetObsidianMock, __setPlatformAndroid } from "./mocks/obsidian";
import { CommitMessageModal } from "../src/ui/gitModals";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/**
 * The single action button of an input modal. It used to move to the top-left
 * corner on mobile (so the keyboard could not cover it), which put the one
 * button of these modals in a different place than every other modal's. Now
 * the button stays at the bottom of the window on every platform, and on
 * mobile the WINDOW is pinned to the top half of the screen instead
 * (`ngb-modal-keyboard-safe`); the pinning itself is CSS and needs the
 * device, but the class and the button's place in the tree are decidable
 * here.
 */
describe("input-modal action placement", () => {
  beforeEach(() => {
    __resetObsidianMock();
    // onOpen defers focusing the textarea through window.setTimeout, and this
    // suite runs without the orchestration harness's window stub.
    (globalThis as Any).window = {
      setTimeout: (fn: Any, ms: Any) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: Any) => clearTimeout(id),
    };
  });

  const openCommitModal = () => {
    const m = new CommitMessageModal(
      {} as Any,
      { title: "Commit", placeholder: "message", submitLabel: "Commit" },
      () => undefined
    );
    m.onOpen();
    return m as Any;
  };

  it("keeps the button at the bottom of the content on mobile, and marks the modal keyboard-safe", () => {
    __setPlatformAndroid(true);
    const m = openCommitModal();
    expect(m.modalEl.hasClass("ngb-modal-keyboard-safe")).toBe(true);
    // The button lives inside the content's button row, not glued onto the
    // modal element itself the way the top-left variant was.
    expect(__findByClass(m.contentEl, "ngb-modal-action")).toBeTruthy();
    expect(__findByClass(m.contentEl, "ngb-buttons")).toBeTruthy();
    expect(__findByClass(m.modalEl, "ngb-modal-action-top")).toBeNull();
  });

  it("desktop gets the same bottom button and NO keyboard pinning", () => {
    __setPlatformAndroid(false);
    const m = openCommitModal();
    expect(m.modalEl.hasClass("ngb-modal-keyboard-safe")).toBe(false);
    expect(__findByClass(m.contentEl, "ngb-modal-action")).toBeTruthy();
  });
});
