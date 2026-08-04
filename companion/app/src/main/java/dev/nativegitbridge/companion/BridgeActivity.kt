package dev.nativegitbridge.companion

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast

/**
 * Invisible transponder for nativegitbridge://run. All control lives in the
 * Obsidian plugin; this activity only triggers the fixed runner script in
 * Termux. If the Termux permission has not been granted yet, it opens the
 * SetupActivity, which requests it with the standard Android dialog.
 */
class BridgeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent?.data
        when {
            uri == null || uri.scheme != "nativegitbridge" ->
                toast(R.string.err_unknown_action)
            // The plugin opens this when operations time out or the round trip
            // is broken: the checklist shows exactly which link failed. The
            // ack is sent FIRST so the setup screen lands on top of Obsidian.
            uri.host == "setup" -> {
                ackObsidian("setup")
                startActivity(Intent(this, SetupActivity::class.java))
            }
            uri.host != "run" ->
                toast(R.string.err_unknown_action)
            !TermuxForwarder.hasPermission(this) -> {
                ackObsidian("run-no-permission")
                toast(R.string.err_no_permission_opening_setup)
                startActivity(Intent(this, SetupActivity::class.java))
            }
            else -> {
                ackObsidian("run")
                toast(TermuxForwarder.forward(this).messageRes)
            }
        }
        finish()
    }

    /**
     * Deterministic liveness signal back to the plugin: without it, an
     * unhandled nativegitbridge:// URI is swallowed silently and the plugin
     * cannot distinguish "companion missing" from "runner broken". Best
     * effort - if Obsidian is not installed there is nobody to notify.
     */
    private fun ackObsidian(src: String) {
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("obsidian://native-git-bridge-ack?src=$src"))
            )
        } catch (e: Exception) {
            // No handler for obsidian:// - nothing to ack.
        }
    }

    private fun toast(resId: Int) {
        Toast.makeText(applicationContext, resId, Toast.LENGTH_LONG).show()
    }
}
