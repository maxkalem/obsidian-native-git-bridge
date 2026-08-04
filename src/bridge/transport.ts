/**
 * Trigger transport: the companion app is the only supported mechanism.
 *
 * The plugin opens a custom-scheme URI; the companion app (which holds
 * com.termux.permission.RUN_COMMAND) forwards a RUN_COMMAND intent to Termux
 * that executes the fixed runner script. Only the request id travels in the
 * URI — never the pairing token, never command content.
 *
 * The Termux:Widget "tap a shortcut" variant was dropped: it required a manual
 * tap for every operation. The runner can still be launched by hand from
 * Termux (~/.config/native-git-bridge/runner.sh) if the companion app is
 * unavailable, which is documented as a recovery path only.
 */
export interface TriggerOutcome {
  kind: "intent";
}

export interface TriggerTransport {
  trigger(requestId: string): TriggerOutcome;
}

export class CompanionIntentTransport implements TriggerTransport {
  constructor(
    private uriTemplate: string,
    private openUri: (uri: string) => void
  ) {}

  trigger(requestId: string): TriggerOutcome {
    const safeId = encodeURIComponent(requestId);
    this.openUri(this.uriTemplate.replace("{id}", safeId));
    return { kind: "intent" };
  }
}
