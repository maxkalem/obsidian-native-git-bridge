/**
 * Trigger transport: the companion app is the only supported mechanism.
 *
 * The plugin opens a custom-scheme URI; the companion app (which holds
 * com.termux.permission.RUN_COMMAND) forwards a RUN_COMMAND intent to Termux
 * that executes the fixed runner script. Only the request id travels in the
 * URI — never the pairing token, never command content.
 *
 * `quiet` is the one other thing the URI may say, and it is still intent
 * rather than content: it asks the companion to forward WITHOUT acknowledging
 * back to Obsidian and without a toast. It exists for the trigger fired as
 * Obsidian leaves the foreground — the companion's ack is a startActivity of
 * obsidian://, which would drag the app the user just left back onto the
 * screen (see the companion's BridgeActivity).
 *
 * The Termux:Widget "tap a shortcut" variant was dropped: it required a manual
 * tap for every operation. The runner can still be launched by hand from
 * Termux (~/.config/native-git-bridge/runner.sh) if the companion app is
 * unavailable, which is documented as a recovery path only.
 */
export interface TriggerOutcome {
  kind: "intent";
}

export interface TriggerOptions {
  /** Forward only: no ack back to Obsidian, no toast. */
  quiet?: boolean;
}

export interface TriggerTransport {
  trigger(requestId: string, options?: TriggerOptions): TriggerOutcome;
}

export class CompanionIntentTransport implements TriggerTransport {
  constructor(
    private uriTemplate: string,
    private openUri: (uri: string) => void
  ) {}

  trigger(requestId: string, options?: TriggerOptions): TriggerOutcome {
    const safeId = encodeURIComponent(requestId);
    let uri = this.uriTemplate.replace("{id}", safeId);
    if (options?.quiet) uri += (uri.includes("?") ? "&" : "?") + "quiet=1";
    this.openUri(uri);
    return { kind: "intent" };
  }
}
