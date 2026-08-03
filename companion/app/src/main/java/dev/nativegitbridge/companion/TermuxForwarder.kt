package dev.nativegitbridge.companion

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager

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

    fun forward(activity: Activity): Result {
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
        }
        return try {
            if (activity.startService(intent) == null) Result.NO_TERMUX else Result.OK
        } catch (e: SecurityException) {
            Result.NO_PERMISSION
        } catch (e: IllegalStateException) {
            Result.NO_PERMISSION
        }
    }
}
