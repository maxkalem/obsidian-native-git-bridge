package dev.nativegitbridge.companion

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/** Shared, fixed forwarding logic: the ONLY thing this app ever asks Termux to run. */
object TermuxForwarder {
    const val PERMISSION = "com.termux.permission.RUN_COMMAND"
    const val TERMUX_PACKAGE = "com.termux"

    enum class Result(val messageRes: Int) {
        OK(R.string.ok_forwarded),
        NO_PERMISSION(R.string.err_permission),
        NO_TERMUX(R.string.err_termux_missing),
        /**
         * Termux is installed and the permission is granted, but its service
         * could not be started — typically because Termux was swiped away or
         * force-stopped (Android 8+ blocks starting a background service of a
         * stopped app). Reporting this as "no permission" was actively
         * misleading, so it is its own result: the fix is to open Termux once.
         */
        TERMUX_NOT_RUNNING(R.string.err_termux_not_running),
    }

    fun hasPermission(activity: Activity): Boolean =
        activity.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    fun isTermuxInstalled(activity: Activity): Boolean = try {
        activity.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
        true
    } catch (e: Exception) {
        false
    }

    /**
     * Forward the fixed runner invocation to Termux. When [resultReceiver] is
     * provided, Termux reports stdout/exitCode/errmsg back through it
     * (documented RUN_COMMAND pending-intent mechanism), which lets the setup
     * screen verify the whole chain and show real checkmarks.
     */
    fun forward(activity: Activity, resultReceiver: PendingIntent? = null): Result {
        if (!hasPermission(activity)) return Result.NO_PERMISSION
        val intent = Intent().apply {
            setClassName(TERMUX_PACKAGE, "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra(
                "com.termux.RUN_COMMAND_PATH",
                "/data/data/com.termux/files/home/.config/native-git-bridge/runner.sh"
            )
            putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home")
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            if (resultReceiver != null) {
                putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", resultReceiver)
            }
        }
        if (!isTermuxInstalled(activity)) return Result.NO_TERMUX
        return try {
            if (activity.startService(intent) == null) Result.NO_TERMUX else Result.OK
        } catch (e: SecurityException) {
            // A real permission problem (including allow-external-apps=false).
            Result.NO_PERMISSION
        } catch (e: IllegalStateException) {
            // Background-service restriction: Termux exists but is stopped.
            // startForegroundService is allowed here (RunCommandService calls
            // startForeground itself), so retry that way before giving up.
            if (Build.VERSION.SDK_INT >= 26) {
                try {
                    activity.startForegroundService(intent)
                    return Result.OK
                } catch (e2: Exception) {
                    return Result.TERMUX_NOT_RUNNING
                }
            }
            Result.TERMUX_NOT_RUNNING
        }
    }

    /** Bring Termux to the foreground (so a stopped Termux can accept commands). */
    fun launchTermux(activity: Activity): Boolean {
        val launch = activity.packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE) ?: return false
        activity.startActivity(launch)
        return true
    }

    fun mutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
}
