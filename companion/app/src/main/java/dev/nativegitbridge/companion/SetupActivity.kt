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
    /** Raw Termux error, kept small and secondary (for bug reports only). */
    private lateinit var technical: TextView
    /** "Plugin x.y.z · Runner vN" line under the title. */
    private lateinit var versions: TextView
    /** Which of the three parts needs updating (empty when they agree). */
    private lateinit var mismatch: TextView
    /** Shown only when THIS app is the outdated part. */
    private lateinit var updateButton: TextView

    private var probeInFlight = false
    /** True when the current probe was started by the Test button: its outcome is toasted. */
    private var probeIsManual = false
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
            if (probeIsManual) {
                probeIsManual = false
                Toast.makeText(
                    this@SetupActivity,
                    if (ok) R.string.probe_ok_toast else R.string.probe_fail_toast,
                    Toast.LENGTH_LONG
                ).show()
            }
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

        // Title row: name on the left, THIS app's version top-right; the
        // plugin/runner versions go underneath. The companion cannot read the
        // vault, so those two arrive as URI parameters when Obsidian opens
        // this screen (display only) — otherwise they read "unknown".
        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(c(R.color.text_normal))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        titleRow.addView(TextView(this).apply {
            text = "v" + appVersion()
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(c(R.color.text_muted))
        })
        root.addView(titleRow)

        versions = TextView(this).apply {
            textSize = 12f
            setTextColor(c(R.color.text_muted))
            setPadding(0, dp(2f), 0, 0)
        }
        root.addView(versions)

        mismatch = TextView(this).apply {
            textSize = 13f
            setTextColor(c(R.color.danger))
            setPadding(0, dp(6f), 0, 0)
        }
        root.addView(mismatch)

        root.addView(sectionHeader(R.string.setup_title))

        step1 = makeStepRow("1", null)
        step2 = makeStepRow("2") {
            requestPermissions(arrayOf(TermuxForwarder.PERMISSION), REQ_PERMISSION)
        }
        step3 = makeStepRow("3") {
            val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            // Pinned to this app's version == the release version, so the
            // runner installed here matches the release the plugin came from.
            clipboard.setPrimaryClip(
                ClipData.newPlainText(
                    "git-bridge-setup",
                    getString(R.string.setup_command, appVersion())
                )
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

        technical = TextView(this).apply {
            textSize = 11f
            setTextColor(c(R.color.text_muted))
            alpha = 0.7f
            setPadding(dp(4f), 0, dp(4f), dp(8f))
        }
        root.addView(technical)

        root.addView(sectionHeader(R.string.section_actions))
        // Only shown when this app is the outdated part (see renderVersions).
        updateButton = actionButton(R.string.btn_update_companion, primary = true) {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BridgeActivity.APK_URL)))
            Toast.makeText(this, R.string.update_hint, Toast.LENGTH_LONG).show()
        }
        updateButton.visibility = android.view.View.GONE
        root.addView(updateButton)
        root.addView(actionButton(R.string.btn_test, primary = true) { startProbe(manual = true) })
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
            probeMsg.isNotEmpty() -> explainProbeFailure(probeMsg)
            else -> getString(R.string.setup_help)
        }
        technical.text = if (!probeOk && probeMsg.isNotEmpty()) probeMsg else ""
    }

    /**
     * Turn a raw Termux error into the single action that fixes it. Dumping
     * `errmsg=Error Code: 2 ...` next to "fix the [MISSING] items above" was
     * doubly unhelpful: the items above were green, and the real cause (one
     * property in termux.properties) was buried in the noise.
     */
    private fun explainProbeFailure(msg: String): String = when {
        msg.contains("allow-external-apps", ignoreCase = true) ->
            getString(R.string.fail_allow_external_apps)
        msg.contains("No such file", ignoreCase = true) ||
            msg.contains("runner.sh", ignoreCase = true) ->
            getString(R.string.fail_runner_missing)
        msg.contains("Permission", ignoreCase = true) ->
            getString(R.string.fail_permission)
        else -> getString(R.string.fail_generic)
    }

    // ---- probe (unchanged logic) ------------------------------------------

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        storeReportedVersions(intent)
        renderVersions()
    }

    override fun onResume() {
        super.onResume()
        storeReportedVersions(intent)
        renderVersions()
        refresh()
        if (TermuxForwarder.isTermuxInstalled(this) && TermuxForwarder.hasPermission(this)) {
            startProbe(manual = false)
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

    private fun startProbe(manual: Boolean) {
        if (probeInFlight) {
            if (manual) Toast.makeText(this, R.string.probe_already_running, Toast.LENGTH_SHORT).show()
            return
        }
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
        probeIsManual = manual
        if (manual) Toast.makeText(this, R.string.ok_forwarded, Toast.LENGTH_SHORT).show()
        refresh()
        handler.postDelayed({
            if (probeInFlight) {
                probeInFlight = false
                prefs().edit()
                    .putBoolean(KEY_PROBE_OK, false)
                    .putString(KEY_PROBE_MSG, getString(R.string.probe_timeout))
                    .apply()
                if (probeIsManual) {
                    probeIsManual = false
                    Toast.makeText(this@SetupActivity, R.string.probe_fail_toast, Toast.LENGTH_LONG).show()
                }
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

    private fun appVersion(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }

    /**
     * Remember the plugin/runner versions Obsidian passed in, so they still
     * show after the user leaves and comes back (e.g. via the launcher).
     */
    private fun storeReportedVersions(intent: Intent?) {
        val pv = intent?.getStringExtra(EXTRA_PLUGIN_VERSION)
        val rv = intent?.getStringExtra(EXTRA_RUNNER_VERSION)
        val rmin = intent?.getStringExtra(EXTRA_RUNNER_MIN)
        if (pv.isNullOrEmpty() && rv.isNullOrEmpty()) return
        prefs().edit()
            .putString(KEY_PLUGIN_VERSION, pv ?: "")
            .putString(KEY_RUNNER_VERSION, rv ?: "")
            .putString(KEY_RUNNER_MIN, rmin ?: "")
            .apply()
    }

    private fun renderVersions() {
        val pv = prefs().getString(KEY_PLUGIN_VERSION, "") ?: ""
        val rv = prefs().getString(KEY_RUNNER_VERSION, "") ?: ""
        val rmin = prefs().getString(KEY_RUNNER_MIN, "") ?: ""
        val pluginText = if (pv.isEmpty()) getString(R.string.ver_unknown) else pv
        val runnerNum = rv.toIntOrNull() ?: 0
        val runnerMin = rmin.toIntOrNull() ?: 0
        val runnerText = when {
            runnerNum == 0 -> getString(R.string.ver_unknown)
            runnerMin != 0 && runnerNum != runnerMin -> getString(R.string.ver_runner_stale, rv, rmin)
            else -> "v$rv"
        }
        versions.text = getString(R.string.ver_line, pluginText, runnerText)

        // The same three-way check the plugin does, repeated here because the
        // user may open this screen directly from the launcher and expects the
        // verdict where the numbers are shown.
        val cmp = if (pv.isEmpty()) 0 else compareVersions(pv, appVersion())
        // This app is the outdated part: offer the download right here. It can
        // open the real default browser, which Obsidian's in-app tab cannot do
        // reliably (its downloads are discarded when the tab closes).
        updateButton.visibility =
            if (cmp > 0) android.view.View.VISIBLE else android.view.View.GONE
        mismatch.text = when {
            cmp < 0 -> getString(R.string.ver_update_plugin, pv, appVersion())
            cmp > 0 -> getString(R.string.ver_update_companion, appVersion(), pv)
            runnerNum != 0 && runnerMin != 0 && runnerNum < runnerMin ->
                getString(R.string.ver_update_runner, rv, rmin)
            runnerNum != 0 && runnerMin != 0 && runnerNum > runnerMin ->
                getString(R.string.ver_update_plugin_for_runner, rv, rmin)
            else -> ""
        }
    }

    /** Compare dotted numeric versions; junk parts count as 0 (never invents a mismatch). */
    private fun compareVersions(a: String, b: String): Int {
        val pa = a.split(".")
        val pb = b.split(".")
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val na = pa.getOrNull(i)?.toIntOrNull() ?: 0
            val nb = pb.getOrNull(i)?.toIntOrNull() ?: 0
            if (na != nb) return if (na < nb) -1 else 1
        }
        return 0
    }

    companion object {
        private const val REQ_PERMISSION = 42
        private const val ACTION_PROBE_RESULT = "dev.nativegitbridge.companion.PROBE_RESULT"
        private const val KEY_PROBE_OK = "probeOk"
        private const val KEY_PROBE_MSG = "probeMsg"
        private const val KEY_PLUGIN_VERSION = "pluginVersion"
        private const val KEY_RUNNER_VERSION = "runnerVersion"
        private const val KEY_RUNNER_MIN = "runnerMin"

        /** Display-only metadata forwarded by BridgeActivity from the setup URI. */
        const val EXTRA_PLUGIN_VERSION = "pluginVersion"
        const val EXTRA_RUNNER_VERSION = "runnerVersion"
        const val EXTRA_RUNNER_MIN = "runnerMin"
    }
}
