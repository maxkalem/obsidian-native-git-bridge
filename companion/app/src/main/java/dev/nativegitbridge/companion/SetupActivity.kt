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
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.provider.Settings
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Setup checklist styled after Obsidian (light/dark palette follows the system
 * theme via values-night resources).
 *
 * Steps are uniform card rows with a status circle (number -> checkmark);
 * actionable steps are tappable as a whole row. Utility actions that have no
 * checkmark semantics (re-test, app settings) are separate buttons below.
 */
class SetupActivity : Activity() {

    private class StepRow(
        val container: LinearLayout,
        val circle: TextView,
        val label: TextView,
        val number: String
    )

    private lateinit var step1: StepRow
    private lateinit var step2: StepRow
    private lateinit var step3: StepRow
    private lateinit var detail: TextView

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

    // ---- palette helpers -------------------------------------------------

    private fun c(id: Int): Int = resources.getColor(id, theme)
    private fun dp(v: Float): Int = (v * resources.displayMetrics.density).toInt()

    private fun roundedBg(fill: Int, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            cornerRadius = dp(12f).toFloat()
            setColor(fill)
            if (stroke != null) setStroke(dp(1f), stroke)
        }

    private fun circleBg(fill: Int?, stroke: Int?): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(fill ?: 0x00000000)
            if (stroke != null) setStroke(dp(2f), stroke)
        }

    // ---- UI construction -------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = dp(16f)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(c(R.color.text_normal))
        })
        root.addView(sectionHeader(R.string.setup_title))

        step1 = makeStepRow("1", null)
        step2 = makeStepRow("2") {
            requestPermissions(arrayOf(TermuxForwarder.PERMISSION), REQ_PERMISSION)
        }
        step3 = makeStepRow("3") {
            val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(
                ClipData.newPlainText("git-bridge-setup", getString(R.string.setup_command))
            )
            Toast.makeText(this, R.string.setup_command_copied, Toast.LENGTH_LONG).show()
            val launch = packageManager.getLaunchIntentForPackage(TermuxForwarder.TERMUX_PACKAGE)
            if (launch != null) startActivity(launch)
            else Toast.makeText(this, R.string.err_termux_missing, Toast.LENGTH_LONG).show()
        }
        root.addView(step1.container)
        root.addView(step2.container)
        root.addView(step3.container)

        detail = TextView(this).apply {
            textSize = 13f
            setTextColor(c(R.color.text_muted))
            setPadding(dp(4f), dp(12f), dp(4f), dp(12f))
        }
        root.addView(detail)

        root.addView(sectionHeader(R.string.section_actions))
        root.addView(actionButton(R.string.btn_test, primary = true) { startProbe() })
        root.addView(actionButton(R.string.btn_app_settings, primary = false) {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName")
                )
            )
        })

        setContentView(ScrollView(this).apply {
            addView(root)
            setBackgroundColor(c(R.color.bg))
        })

        val filter = IntentFilter(ACTION_PROBE_RESULT)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(probeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(probeReceiver, filter)
        }
    }

    private fun sectionHeader(textRes: Int): TextView = TextView(this).apply {
        text = getString(textRes)
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        isAllCaps = true
        setTextColor(c(R.color.text_muted))
        setPadding(dp(4f), dp(18f), dp(4f), dp(8f))
    }

    private fun makeStepRow(number: String, onClick: (() -> Unit)?): StepRow {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14f), dp(14f), dp(14f), dp(14f))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8f) }
        }
        val circle = TextView(this).apply {
            gravity = Gravity.CENTER
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(dp(28f), dp(28f)).apply {
                marginEnd = dp(12f)
            }
        }
        val label = TextView(this).apply {
            textSize = 15f
            setTextColor(c(R.color.text_normal))
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            )
        }
        row.addView(circle)
        row.addView(label)
        if (onClick != null) row.setOnClickListener { onClick() }
        return StepRow(row, circle, label, number)
    }

    private fun actionButton(textRes: Int, primary: Boolean, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = getString(textRes)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(14f), dp(13f), dp(14f), dp(13f))
            setTextColor(if (primary) c(R.color.on_accent) else c(R.color.text_normal))
            background =
                if (primary) roundedBg(c(R.color.accent))
                else roundedBg(c(R.color.bg_secondary), c(R.color.border))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8f) }
            setOnClickListener { onClick() }
        }

    // ---- state -----------------------------------------------------------

    private fun style(row: StepRow, done: Boolean, pendingText: Int, doneText: Int, busy: Boolean = false) {
        row.label.text = getString(if (done) doneText else pendingText)
        when {
            done -> {
                row.circle.text = "✓"
                row.circle.setTextColor(c(R.color.on_accent))
                row.circle.background = circleBg(c(R.color.success), null)
                row.container.background = roundedBg(c(R.color.bg_secondary), c(R.color.border))
                row.container.alpha = 0.75f
                row.container.isClickable = false
            }
            busy -> {
                row.circle.text = "…"
                row.circle.setTextColor(c(R.color.accent))
                row.circle.background = circleBg(null, c(R.color.accent))
                row.container.background = roundedBg(c(R.color.bg_secondary), c(R.color.accent))
                row.container.alpha = 1f
            }
            else -> {
                row.circle.text = row.number
                row.circle.setTextColor(c(R.color.accent))
                row.circle.background = circleBg(null, c(R.color.accent))
                row.container.background = roundedBg(c(R.color.bg_secondary), c(R.color.accent))
                row.container.alpha = 1f
                row.container.isClickable = true
            }
        }
    }

    private fun refresh() {
        val termuxOk = TermuxForwarder.isTermuxInstalled(this)
        val permissionOk = TermuxForwarder.hasPermission(this)
        val probeOk = prefs().getBoolean(KEY_PROBE_OK, false)
        val probeMsg = prefs().getString(KEY_PROBE_MSG, "") ?: ""

        style(step1, termuxOk, R.string.check_termux, R.string.check_termux)
        style(step2, permissionOk, R.string.btn_grant, R.string.btn_grant_done)
        style(step3, probeOk, R.string.btn_setup_termux, R.string.btn_setup_termux_done, probeInFlight)

        detail.text = when {
            probeOk -> getString(R.string.setup_ready)
            probeInFlight -> getString(R.string.probe_running)
            probeMsg.isNotEmpty() -> getString(R.string.setup_not_ready) + "\n" + probeMsg
            else -> getString(R.string.setup_help)
        }
    }

    // ---- probe (unchanged logic) ------------------------------------------

    override fun onResume() {
        super.onResume()
        refresh()
        if (TermuxForwarder.isTermuxInstalled(this) && TermuxForwarder.hasPermission(this)) {
            startProbe()
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
        refresh()
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
    }
}
