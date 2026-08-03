package dev.nativegitbridge.companion

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * The visible face of the companion: shows setup status and asks for the
 * Termux permission with the standard Android runtime dialog — the user only
 * taps "Allow", like with any other app.
 */
class SetupActivity : Activity() {

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.setup_title)
            textSize = 20f
        })
        status = TextView(this).apply {
            textSize = 14f
            setPadding(0, pad, 0, pad)
        }
        root.addView(status)
        root.addView(Button(this).apply {
            text = getString(R.string.btn_grant)
            setOnClickListener {
                requestPermissions(arrayOf(TermuxForwarder.PERMISSION), REQ_PERMISSION)
            }
        })
        root.addView(Button(this).apply {
            text = getString(R.string.btn_setup_termux)
            setOnClickListener {
                val clipboard =
                    getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(
                    android.content.ClipData.newPlainText(
                        "git-bridge-setup",
                        getString(R.string.setup_command)
                    )
                )
                Toast.makeText(
                    this@SetupActivity,
                    R.string.setup_command_copied,
                    Toast.LENGTH_LONG
                ).show()
                val launch =
                    packageManager.getLaunchIntentForPackage(TermuxForwarder.TERMUX_PACKAGE)
                if (launch != null) startActivity(launch)
                else Toast.makeText(
                    this@SetupActivity,
                    R.string.err_termux_missing,
                    Toast.LENGTH_LONG
                ).show()
            }
        })
        root.addView(Button(this).apply {
            text = getString(R.string.btn_test)
            setOnClickListener {
                val result = TermuxForwarder.forward(this@SetupActivity)
                Toast.makeText(this@SetupActivity, result.messageRes, Toast.LENGTH_LONG).show()
            }
        })
        root.addView(Button(this).apply {
            text = getString(R.string.btn_app_settings)
            setOnClickListener {
                startActivity(
                    Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:$packageName")
                    )
                )
            }
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.setup_help)
            textSize = 12f
            setPadding(0, pad, 0, 0)
        })
        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val termuxOk = TermuxForwarder.isTermuxInstalled(this)
        val permissionOk = TermuxForwarder.hasPermission(this)
        val lines = mutableListOf<String>()
        lines += (if (termuxOk) "[OK] " else "[MISSING] ") + getString(R.string.check_termux)
        lines += (if (permissionOk) "[OK] " else "[MISSING] ") + getString(R.string.check_permission)
        lines += ""
        lines += getString(if (termuxOk && permissionOk) R.string.setup_ready else R.string.setup_not_ready)
        status.text = lines.joinToString("\n")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
        if (requestCode == REQ_PERMISSION &&
            (grantResults.isEmpty() || grantResults[0] != PackageManager.PERMISSION_GRANTED)
        ) {
            // Denied (possibly with "don't ask again"): the app-settings button
            // remains as the manual path.
            Toast.makeText(this, R.string.perm_denied_hint, Toast.LENGTH_LONG).show()
        }
    }

    companion object {
        private const val REQ_PERMISSION = 42
    }
}
