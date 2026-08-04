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

    companion object {
        /** Latest release page — the versioned companion APK is listed there. */
        const val APK_URL =
            "https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest"

        /** Official Termux site: lists the supported download sources. */
        const val TERMUX_SITE_URL = "https://termux.dev"

        /** Termux inside the F-Droid app (used only when F-Droid is installed). */
        const val TERMUX_FDROID_URL = "https://f-droid.org/packages/com.termux/"
        const val FDROID_PACKAGE = "org.fdroid.fdroid"
    }

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
                // Forward the display-only version metadata (numbers only).
                startActivity(
                    Intent(this, SetupActivity::class.java)
                        .putExtra(SetupActivity.EXTRA_PLUGIN_VERSION, uri.getQueryParameter("pv"))
                        .putExtra(SetupActivity.EXTRA_RUNNER_VERSION, uri.getQueryParameter("rv"))
                        .putExtra(SetupActivity.EXTRA_RUNNER_MIN, uri.getQueryParameter("rmin"))
                )
            }
            // One-tap fix path: bring Termux to the foreground so the user can
            // paste the install command. Falls back to the official site when
            // Termux is not installed at all.
            // Open the APK download in the real default browser. A download
            // started in Obsidian's Custom Tab is often lost when the tab
            // closes; a plain ACTION_VIEW from an app goes to the full browser.
            uri.host == "download-apk" -> {
                ackObsidian("download-apk")
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(APK_URL)))
            }
            // Help the user GET Termux. This app deliberately does not install
            // anything itself: that would need REQUEST_INSTALL_PACKAGES on an
            // app that already holds RUN_COMMAND, and Android would still show
            // its own confirmation. Opening F-Droid (or its web page in the
            // real browser) is the whole benefit without the permission.
            uri.host == "get-termux" -> {
                ackObsidian("get-termux")
                // With F-Droid installed, go straight to its Termux page (one
                // Install tap). Otherwise open the OFFICIAL SITE in the real
                // browser — termux.dev lists the supported download sources
                // itself, which is friendlier than dropping the user on a
                // repository page.
                val inFdroid = Intent(Intent.ACTION_VIEW, Uri.parse(TERMUX_FDROID_URL))
                    .setPackage(FDROID_PACKAGE)
                try {
                    startActivity(inFdroid)
                } catch (e: Exception) {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(TERMUX_SITE_URL)))
                }
            }
            uri.host == "open-termux" -> {
                ackObsidian("open-termux")
                val launch = packageManager.getLaunchIntentForPackage(TermuxForwarder.TERMUX_PACKAGE)
                if (launch != null) startActivity(launch)
                else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(TERMUX_SITE_URL)))
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
                val result = TermuxForwarder.forward(this)
                toast(result.messageRes)
                // Never leave the user with only a toast: every failure opens
                // something actionable.
                when (result) {
                    TermuxForwarder.Result.OK -> Unit
                    // Termux is stopped: bring it to the front so the very next
                    // trigger (or the retry in Obsidian) succeeds.
                    TermuxForwarder.Result.TERMUX_NOT_RUNNING -> TermuxForwarder.launchTermux(this)
                    // Permission / allow-external-apps / missing Termux: the
                    // checklist names the broken link precisely.
                    else -> startActivity(Intent(this, SetupActivity::class.java))
                }
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
        // `termux` tells the plugin whether Termux is installed — the WebView
        // cannot query other packages, but this app can (declared in <queries>).
        val termux = if (TermuxForwarder.isTermuxInstalled(this)) "1" else "0"
        val cv = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (e: Exception) {
            ""
        }
        try {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("obsidian://native-git-bridge-ack?src=$src&termux=$termux&cv=$cv")
                )
            )
        } catch (e: Exception) {
            // No handler for obsidian:// - nothing to ack.
        }
    }

    private fun toast(resId: Int) {
        Toast.makeText(applicationContext, resId, Toast.LENGTH_LONG).show()
    }
}
