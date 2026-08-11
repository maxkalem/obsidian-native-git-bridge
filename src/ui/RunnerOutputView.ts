import { ItemView, Platform, setIcon, WorkspaceLeaf } from "obsidian";

export const NGB_OUTPUT_VIEW = "native-git-bridge-output";
/** One icon for the panel AND anything that opens it. */
export const NGB_OUTPUT_ICON = "terminal";

/** One earlier operation's stream, for the collapsed history section. */
export interface RunnerOutputPast {
  id: string;
  action: string;
  text: string;
}

/**
 * Everything the panel shows, gathered in one pass by the plugin.
 *
 * A snapshot rather than a set of getters: the panel refreshes once a second and
 * three of these fields come from reading files on shared storage. Asking for
 * them one at a time would spread one refresh over several ticks and let the
 * elapsed counter disagree with the stream beside it.
 */
export interface RunnerOutputSnapshot {
  /** The action being watched, or null when nothing is in flight. */
  action: string | null;
  /**
   * The exact state text the other panels' strips are showing, composed by the
   * one ticker that owns it. Displayed verbatim: two panels wording one state
   * differently is how a reader concludes they describe two different things.
   */
  stateText: string | null;
  requestId: string | null;
  /** Whole seconds since the request was submitted. */
  elapsedSeconds: number;
  /** The budget this request was given, so a wait can be read against it. */
  timeoutSeconds: number;
  /** Collapsed, redacted progress stream; "" when the runner has written none. */
  stream: string;
  /** Requests written and not yet processed, including this one. */
  queued: number;
  /** The companion confirmed it started Termux for THIS request. */
  companionAcked: boolean;
  /** How the previous operation ended, for a panel opened after the fact. */
  lastVerdict: string | null;
  /** Tail of `runtime/runner.log` (runner-log tab). */
  runnerLog: string;
  /** Streams of earlier operations, newest first (earlier-operations tab). */
  past: RunnerOutputPast[];
  /** The plugin's own operation log, formatted (operation-log tab). */
  opLog: string;
}

/** Which log the panel is showing; `current` is the operation in flight. */
export type RunnerOutputTab = "current" | "past" | "runner" | "oplog";

export interface RunnerOutputActions {
  /**
   * `want` says which tab's data to gather. Only the selected one is read: the
   * runner log is a file read on shared storage, once a second, for a tab
   * nobody may be looking at.
   */
  snapshot(want: { runnerLog: boolean; past: boolean; opLog: boolean }): Promise<RunnerOutputSnapshot>;
  /** Cancel the operation in flight (same command as the status panel's). */
  cancel(): void;
  /** Open (or focus) the status panel, mirroring its own cross-link. */
  openStatusPanel(): void;
  /** Open (or focus) the repository history panel. */
  openHistoryPanel(): void;
  /** Wrap long lines in the console field (shared preference, own toggle). */
  wrapLines(): boolean;
  toggleWrapLines(): Promise<void>;
}

/**
 * What Termux is saying, while it says it.
 *
 * The panel exists because of one user complaint: there was no way to see what
 * was happening. A clone, a sync or an object repair can run for minutes, and
 * everything the plugin showed of that was a number counting seconds. The runner
 * writes git's stderr to `runtime/progress/<id>.txt` as it goes; this reads it.
 *
 * Two decisions shape the whole thing:
 *
 * **The plugin gathers, the panel draws.** Every field arrives in one snapshot
 * (see above). This file knows nothing about the runtime directory.
 *
 * **A log pane follows its tail unless the reader has moved.** Scrolled to the
 * bottom, it stays there as lines arrive; scrolled up to read something, it
 * stays where it was put. A pane that jumps back down every second cannot be
 * read at all, and one that never follows makes the newest line the hardest to
 * see.
 */
export class RunnerOutputView extends ItemView {
  /** Text node of the stream, replaced in place so scrolling survives. */
  private streamEl: HTMLElement | null = null;
  private streamBox: HTMLElement | null = null;
  private headlineEl: HTMLElement | null = null;
  private factsEl: HTMLElement | null = null;
  private cancelBtn: HTMLElement | null = null;
  private refreshBtn: HTMLElement | null = null;
  private wrapBtn: HTMLElement | null = null;
  // Named to collide with NOTHING on the base classes: a field here was once
  // called `open`, it shadowed an untyped runtime member of Obsidian's view
  // chain, and the panel rendered black — constructor run, `onOpen` never
  // called. tsc cannot see that class of fault; prefix everything.
  private outTab: RunnerOutputTab = "current";
  private tabBtns = new Map<RunnerOutputTab, HTMLElement>();
  /** The panel body — the ONE scroller; the console field has none of its own. */
  private panelBodyEl: HTMLElement | null = null;
  private last: RunnerOutputSnapshot | null = null;
  /** True while a snapshot is being gathered, so ticks cannot overlap. */
  private polling = false;

  constructor(leaf: WorkspaceLeaf, private actions: RunnerOutputActions) {
    super(leaf);
  }

  getViewType(): string {
    return NGB_OUTPUT_VIEW;
  }
  getDisplayText(): string {
    return "Native Git output";
  }
  getIcon(): string {
    return NGB_OUTPUT_ICON;
  }

  async onOpen(): Promise<void> {
    try {
      this.renderShell();
      await this.tick();
      // `registerInterval` ties the timer to the view's lifetime, so a closed
      // panel cannot leave one ticking into a detached node.
      this.registerInterval(window.setInterval(() => void this.tick(), 1000));
    } catch (e) {
      // The one failure this panel must never have is a silent one: it was
      // reported from the device as a black pane three times before anything
      // said why. Whatever breaks the shell gets printed INTO the shell.
      const c = this.contentEl;
      c.empty();
      c.createEl("pre", {
        text: `The output panel could not draw itself: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      });
    }
  }

  /** One refresh: gather what the selected tab needs, update text in place. */
  async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const snap = await this.actions.snapshot({
        runnerLog: this.outTab === "runner",
        past: this.outTab === "past",
        opLog: this.outTab === "oplog",
      });
      this.last = snap;
      this.apply(snap);
    } catch (e) {
      // Say so instead of staying blank. Torn reads are already absorbed inside
      // the snapshot, so whatever reaches here is real — and a panel that
      // swallows it renders as an empty pane with no way to learn why. The next
      // tick overwrites this the moment a snapshot succeeds again.
      if (this.streamEl) {
        this.streamEl.setText(
          `Could not read the plugin's state: ${e instanceof Error ? e.message : String(e)}\n\nRetrying every second.`
        );
      }
    } finally {
      this.polling = false;
    }
  }

  private renderShell(): void {
    const c = this.contentEl;
    c.empty();
    // The status panel's classes, deliberately: three panels sitting in the same
    // sidebar must not each invent their own head and body metrics.
    c.addClass("ngb-status-view", "ngb-output-view");
    const headEl = c.createDiv({ cls: "ngb-sv-head" });
    const body = c.createDiv({ cls: "ngb-sv-body" });
    this.panelBodyEl = body;
    const footBar = c.createDiv({ cls: "ngb-sv-footbar" });
    const mobile = Platform.isPhone;

    const bar = (mobile ? footBar : headEl).createDiv({ cls: "ngb-sv-toolbar" });
    // The tabs, left of refresh. Each shows ONE log in the panel's single
    // console field. The live view has a button of its OWN: it used to be
    // reachable only by tapping the active tab a second time, and a user who
    // switched tabs while reading the idle view's newest stream had no visible
    // way back to it — an affordance nobody can discover is not one.
    this.tabBtns.clear();
    const tabBtn = (tab: RunnerOutputTab, icon: string, label: string) => {
      const b = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon ngb-out-tab" });
      b.setAttribute("aria-label", label);
      setIcon(b, icon);
      b.addEventListener("click", () => this.setTab(tab));
      this.tabBtns.set(tab, b);
    };
    tabBtn("current", "activity", "Live operation");
    tabBtn("past", "layers", "Earlier operations");
    tabBtn("runner", "scroll", "Termux runner log");
    tabBtn("oplog", "file-clock", "Plugin operation log");
    // The divider separates two kinds of control: the tabs choose WHAT the
    // console shows, everything right of the line acts on how it is shown.
    bar.createDiv({ cls: "ngb-out-tab-sep" });
    const wrapBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    wrapBtn.setAttribute("aria-label", "Wrap long lines");
    setIcon(wrapBtn, "wrap-text");
    wrapBtn.addEventListener("click", () => {
      // Await the preference write before reading it back: the highlight and
      // the class must be set from what was SAVED, not from what was hoped.
      void (async () => {
        await this.actions.toggleWrapLines();
        this.applyWrapState();
      })();
    });
    this.wrapBtn = wrapBtn;
    const refreshBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    refreshBtn.setAttribute("aria-label", "Read the output again now");
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => void this.tick());
    this.refreshBtn = refreshBtn;

    const strip = headEl.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    // Always created, never conditionally, so the row cannot reflow when only
    // the text is refreshed — the same rule the status panel's strip follows.
    const cancel = stripLeft.createEl("button", {
      cls: "clickable-icon ngb-sv-icon ngb-sv-icon-warn ngb-sv-cancel-slot",
    });
    cancel.setAttribute("aria-label", "Cancel current operation");
    setIcon(cancel, "x");
    cancel.addEventListener("click", () => this.actions.cancel());
    this.cancelBtn = cancel;
    this.headlineEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    // The same two cross-links every panel's corner carries: history and git.
    const histBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    histBtn.setAttribute("aria-label", "Repository history");
    setIcon(histBtn, "history");
    histBtn.addEventListener("click", () => this.actions.openHistoryPanel());
    const statusBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    statusBtn.setAttribute("aria-label", "Git panel");
    setIcon(statusBtn, "git-branch");
    statusBtn.addEventListener("click", () => this.actions.openStatusPanel());

    // 1. The stream. First and largest, because it is the answer to "what is it
    // doing" and everything else on this panel is context for it.
    this.streamBox = body.createEl("pre", { cls: "ngb-out-stream" });
    this.streamEl = this.streamBox.createEl("code");
    // Never blank, not even for the first second: a panel with nothing in it
    // cannot be told apart from a panel that failed to open.
    this.streamEl.setText("Reading…");
    this.headlineEl?.setText("…");

    // 2. Whether the request even reached Termux. Silence in the stream means
    // one of two very different things, and this is what tells them apart.
    // Shown only on the live tab; the log tabs are the console field alone.
    this.factsEl = body.createDiv({ cls: "ngb-out-facts" });
    this.applyTabState();
    this.applyWrapState();
  }

  /** The wrap toggle's highlight and the console's class, from the saved pref. */
  private applyWrapState(): void {
    const on = this.actions.wrapLines();
    this.wrapBtn?.toggleClass("ngb-sv-icon-active", on);
    this.wrapBtn?.setAttribute("aria-pressed", on ? "true" : "false");
    this.streamBox?.toggleClass("ngb-out-wrap", on);
  }

  /**
   * Back to the live-operation tab. Called by whatever OPENS the panel: the
   * view survives in the workspace, so without this a tab selected an hour ago
   * is what a fresh "show me what is happening" tap would land on.
   */
  showLive(): void {
    if (this.outTab === "current") return;
    this.outTab = "current";
    this.applyTabState();
  }

  /**
   * Select a tab. Tapping the active one still returns to the live view (the
   * pre-Live-button habit keeps working), and the Live tab itself is idempotent
   * because "current" is what a deselection falls back to anyway.
   */
  private setTab(tab: RunnerOutputTab): void {
    this.outTab = this.outTab === tab ? "current" : tab;
    this.applyTabState();
    // Fetched on selection rather than on every tick: reading `runner.log`
    // costs a file read on shared storage, and an unselected tab must not pay
    // for it. The last snapshot has nothing for a tab that was not selected
    // when it was taken, so ask for a new one.
    void this.tick();
  }

  private applyTabState(): void {
    for (const [tab, btn] of this.tabBtns) {
      btn.toggleClass("ngb-out-tab-on", this.outTab === tab);
      btn.setAttribute("aria-pressed", this.outTab === tab ? "true" : "false");
    }
    if (this.factsEl) {
      if (this.outTab === "current") this.factsEl.show();
      else this.factsEl.hide();
    }
  }

  private apply(s: RunnerOutputSnapshot): void {
    const running = s.action !== null;
    if (this.cancelBtn) {
      // Hidden rather than disabled: nothing to cancel is not the same as a
      // button that refuses.
      if (running) this.cancelBtn.show();
      else this.cancelBtn.hide();
    }
    this.refreshBtn?.toggleClass("ngb-anim-spin", running);
    if (this.headlineEl) {
      this.headlineEl.toggleClass("ngb-sv-progress-idle", !running);
      // VERBATIM the text the other panels' strips are showing, composed by
      // the one ticker that owns it; this panel never words the state itself.
      // The budget lives in the facts below.
      this.headlineEl.setText(
        s.stateText ?? (running ? `${s.action}… ${s.elapsedSeconds}s` : "Idle")
      );
    }

    if (this.streamEl && this.streamBox) {
      const text = this.contentFor(s, running);
      if (this.streamEl.textContent !== text) {
        // Whether to follow the tail is decided BEFORE the text changes, from
        // where the reader had put the pane. The scroller is the panel BODY:
        // the console field deliberately has no vertical scroller of its own.
        const box = this.panelBodyEl ?? this.streamBox;
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        this.streamEl.setText(text);
        if (atBottom) box.scrollTop = box.scrollHeight;
      }
    }

    if (this.factsEl) {
      this.factsEl.empty();
      const row = (label: string, value: string, warn = false) => {
        const r = this.factsEl!.createDiv({ cls: "ngb-out-fact" });
        r.createSpan({ cls: "ngb-out-fact-label", text: label });
        const v = r.createSpan({ cls: "ngb-out-fact-value", text: value });
        if (warn) v.addClass("ngb-out-fact-warn");
      };
      if (running) {
        row("Request", s.requestId ?? "—");
        row("Budget", `${s.timeoutSeconds}s`);
        // The one fact that separates "Termux is working" from "nothing ever
        // started it", and the reason a wait used to be unreadable.
        row(
          "Companion",
          s.companionAcked ? "started Termux for this request" : "no acknowledgement yet",
          !s.companionAcked
        );
        row("Queued requests", String(s.queued), s.queued > 1);
        if (s.stream === "" && s.elapsedSeconds > 20) {
          row(
            "Nothing yet",
            "the runner may be waiting for its lock — see the runner log below",
            true
          );
        }
      } else if (s.lastVerdict !== null) {
        row("Last operation", s.lastVerdict);
      }
    }
  }

  /** What the console field shows, decided by the selected tab. */
  private contentFor(s: RunnerOutputSnapshot, running: boolean): string {
    if (this.outTab === "runner") {
      return s.runnerLog !== "" ? s.runnerLog : "The runner has not written a log to this vault yet.";
    }
    if (this.outTab === "oplog") {
      return s.opLog !== "" ? s.opLog : "The operation log is empty.";
    }
    if (this.outTab === "past") {
      if (s.past.length === 0) return "No earlier streams. They are kept for 24 hours.";
      return s.past.map((p) => `── ${p.action} · ${p.id} ──\n${p.text}`).join("\n\n");
    }
    return s.stream !== ""
      ? s.stream
      : running
        ? "Waiting for the runner to say something.\n\nA request that has only just been written shows nothing for a second or two. If this stays empty, the runner has not picked the request up — the facts below say whether it was even asked to."
        : "Nothing is running.\n\nThe last operation's output stays here until the next one starts.";
  }
}
