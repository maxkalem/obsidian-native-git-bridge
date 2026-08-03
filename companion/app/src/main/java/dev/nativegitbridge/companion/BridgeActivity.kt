package dev.nativegitbridge.companion

import android.app.Activity
import android.content.Intent
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
            uri == null || uri.scheme != "nativegitbridge" || uri.host != "run" ->
                toast(R.string.err_unknown_action)
            !TermuxForwarder.hasPermission(this) -> {
                toast(R.string.err_no_permission_opening_setup)
                startActivity(Intent(this, SetupActivity::class.java))
            }
            else -> toast(TermuxForwarder.forward(this).messageRes)
        }
        finish()
    }

    private fun toast(resId: Int) {
        Toast.makeText(applicationContext, resId, Toast.LENGTH_LONG).show()
    }
}
