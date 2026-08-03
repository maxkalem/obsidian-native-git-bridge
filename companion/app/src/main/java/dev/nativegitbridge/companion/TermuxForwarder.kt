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
        return try {
            if (activity.startService(intent) == null) Result.NO_TERMUX else Result.OK
        } catch (e: SecurityException) {
            Result.NO_PERMISSION
        } catch (e: IllegalStateException) {
            Result.NO_PERMISSION
        }
    }

    fun mutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
}
