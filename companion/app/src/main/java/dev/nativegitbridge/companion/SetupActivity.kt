package dev.nativegitbridge.companion

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Setup checklist. Every step shows a live checkmark:
 *   1. Termux installed            — detected automatically
 *   2. Termux permission granted   — standard runtime permission dialog
 *   3. Termux configured           — verified by a real probe: the runner is
 *      executed and Termux reports the result back via PendingIntent
 * The probe re-runs automatically when you return to this screen, so the
 * checkmarks update by themselves after each step.
 */
class SetupActivity : Activity() {

    private lateinit var mark1: TextView
    private lateinit var mark2: TextView
    private lateinit var mark3: TextView
    private lateinit var detail: TextView
    private lateinit var grantButton: Button
    private lateinit var setupButton: Button
    private lateinit var testButton: Button

    private var probeInFlight = false
    private val handler = Handler()

    private val probeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            probeInFlight = false
            val bundle = intent.getBundleExtra("result")
            val exitCode = bundle?.getInt("exitCode", -1) ?: -1
            val err = bundle?.getInt("err", -1) ?: -1
            val errmsg = bundle?.getString("errmsg") ?: ""
            val ok = exitCode == 0 && errmsg.isEmpty()
            prefs().edit()
                .putBoolean(KEY_PROBE_OK, ok)
                .putString(KEY_PROBE_MSG, if (ok) "" else "errmsg=$errmsg err=$err exit=$exitCode")
                .apply()
            refresh()
        }
    }

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

        fun row(mark: TextView, button: Button?): LinearLayout {
            val r = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, pad / 2, 0, 0)
            }
            mark.textSize = 18f
            mark.minWidth = (32 * resources.displayMetrics.density).toInt()
            r.addView(mark)
            if (button != null) {
                r.addView(
                    button,
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                )
            }
            return r
        }

        // Step 1: Termux installed (no button; install happens outside).
        mark1 = TextView(this)
        val step1Label = TextView(this).apply { text = getString(R.string.check_termux) }
        val r1 = row(mark1, null); r1.addView(step1Label); root.addView(r1)

        // Step 2: permission.
        mark2 = TextView(this)
        grantButton = Button(this).apply {
            text = getString(R.string.btn_grant)
            setOnClickListener {
                requestPermissions(arrayOf(TermuxForwarder.PERMISSION), REQ_PERMISSION)
            }
        }
        root.addView(row(mark2, grantButton))

        // Step 3: Termux configured (copy command + open Termux; verified by probe).
        mark3 = TextView(this)
        setupButton = Button(this).apply {
            text = getString(R.string.btn_setup_termux)
            setOnClickListener {
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(
                    ClipData.newPlainText("git-bridge-setup", getString(R.string.setup_command))
                )
                Toast.makeText(this@SetupActivity, R.string.setup_command_copied, Toast.LENGTH_LONG)
                    .show()
                val launch =
                    packageManager.getLaunchIntentForPackage(TermuxForwarder.TERMUX_PACKAGE)
                if (launch != null) startActivity(launch)
                else Toast.makeText(
                    this@SetupActivity, R.string.err_termux_missing, Toast.LENGTH_LONG
                ).show()
            }
        }
        root.addView(row(mark3, setupButton))

        // Manual re-test.
        testButton = Button(this).apply {
            text = getString(R.string.btn_test)
            setOnClickListener { startProbe() }
        }
        root.addView(testButton)

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

        detail = TextView(this).apply {
            textSize = 12f
            setPadding(0, pad, 0, 0)
        }
        root.addView(detail)

        setContentView(ScrollView(this).apply { addView(root) })

        val filter = IntentFilter(ACTION_PROBE_RESULT)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(probeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(probeReceiver, filter)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(probeReceiver)
        } catch (e: Exception) {
            // not registered
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
        // Auto-verify: whenever the prerequisites hold, re-run the probe so the
        // third checkmark updates by itself after the user returns from Termux.
        if (TermuxForwarder.isTermuxInstalled(this) && TermuxForwarder.hasPermission(this)) {
            startProbe()
        }
    }

    private fun startProbe() {
        if (probeInFlight) return
        if (!TermuxForwarder.hasPermission(this)) {
            Toast.makeText(this, R.string.err_permission, Toast.LENGTH_LONG).show()
            return
        }
        val broadcast = Intent(ACTION_PROBE_RESULT).setPackage(packageName)
        val pi = PendingIntent.getBroadcast(
            this,
            (System.currentTimeMillis() % Int.MAX_VALUE).toInt(),
            broadcast,
            PendingIntent.FLAG_ONE_SHOT or TermuxForwarder.mutableFlag()
        )
        val result = TermuxForwarder.forward(this, pi)
        if (result != TermuxForwarder.Result.OK) {
            Toast.makeText(this, result.messageRes, Toast.LENGTH_LONG).show()
            return
        }
        probeInFlight = true
        mark3.text = HOURGLASS
        detail.text = getString(R.string.probe_running)
        // If Termux never answers (allow-external-apps off, app force-stopped),
        // record that after 15 s so the user is not left with a spinner.
        handler.postDelayed({
            if (probeInFlight) {
                probeInFlight = false
                prefs().edit()
                    .putBoolean(KEY_PROBE_OK, false)
                    .putString(KEY_PROBE_MSG, getString(R.string.probe_timeout))
                    .apply()
                refresh()
            }
        }, 15000)
    }

    private fun refresh() {
        val termuxOk = TermuxForwarder.isTermuxInstalled(this)
        val permissionOk = TermuxForwarder.hasPermission(this)
        val probeOk = prefs().getBoolean(KEY_PROBE_OK, false)
        val probeMsg = prefs().getString(KEY_PROBE_MSG, "") ?: ""

        mark1.text = if (termuxOk) CHECK else CROSS
        mark2.text = if (permissionOk) CHECK else CROSS
        mark3.text = if (probeOk) CHECK else if (probeInFlight) HOURGLASS else CROSS
        grantButton.isEnabled = !permissionOk
        grantButton.text = getString(
            if (permissionOk) R.string.btn_grant_done else R.string.btn_grant
        )
        setupButton.text = getString(
            if (probeOk) R.string.btn_setup_termux_done else R.string.btn_setup_termux
        )
        detail.text = when {
            probeOk -> getString(R.string.setup_ready)
            probeMsg.isNotEmpty() -> getString(R.string.setup_not_ready) + "\n" + probeMsg
            else -> getString(R.string.setup_help)
        }
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
            Toast.makeText(this, R.string.perm_denied_hint, Toast.LENGTH_LONG).show()
        }
    }

    private fun prefs() = getSharedPreferences("setup-state", MODE_PRIVATE)

    companion object {
        private const val REQ_PERMISSION = 42
        private const val ACTION_PROBE_RESULT = "dev.nativegitbridge.companion.PROBE_RESULT"
        private const val KEY_PROBE_OK = "probeOk"
        private const val KEY_PROBE_MSG = "probeMsg"
        private const val CHECK = "✅"      // ✅
        private const val CROSS = "⭕"      // ⭕ (step not done yet)
        private const val HOURGLASS = "⏳"  // ⏳
    }
}
