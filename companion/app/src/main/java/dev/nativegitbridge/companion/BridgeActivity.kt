package dev.nativegitbridge.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/**
 * Thin, stateless transponder. All control lives in the Obsidian plugin:
 * the plugin writes the request file into the vault and opens
 * `nativegitbridge://run`; this activity only tells Termux to execute the
 * FIXED runner script once, then finishes. It carries no command content,
 * no tokens, no configuration, and keeps no state.
 */
class BridgeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent?.data
        when {
            uri == null || uri.scheme != "nativegitbridge" ->
                toast(R.string.err_unknown_action)
            uri.host == "run" -> forwardToTermux()
            else -> toast(R.string.err_unknown_action)
        }
        finish()
    }

    private fun forwardToTermux() {
        // Keys are the string constants documented in the Termux wiki
        // ("RUN_COMMAND Intent"); no dependency on termux-shared needed for
        // this fixed, minimal use.
        val runCommand = Intent().apply {
            setClassName("com.termux", "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra(
                "com.termux.RUN_COMMAND_PATH",
                "/data/data/com.termux/files/home/.config/native-git-bridge/runner.sh"
            )
            putExtra(
                "com.termux.RUN_COMMAND_WORKDIR",
                "/data/data/com.termux/files/home"
            )
            // Background task: no terminal session, no window, unaffected by
            // Android 10+ background-activity-start restrictions.
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        }
        try {
            val component = startService(runCommand)
            if (component == null) {
                toast(R.string.err_termux_missing)
            } else {
                toast(R.string.ok_forwarded)
            }
        } catch (e: SecurityException) {
            toast(R.string.err_permission)
        } catch (e: IllegalStateException) {
            // Extremely unlikely (we are foreground while handling VIEW),
            // but never crash the flow.
            toast(R.string.err_permission)
        }
    }

    private fun toast(resId: Int) {
        Toast.makeText(applicationContext, resId, Toast.LENGTH_LONG).show()
    }
}
