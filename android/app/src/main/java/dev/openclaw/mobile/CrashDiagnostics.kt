package dev.openclaw.mobile

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/** Local-only diagnostics. No exception messages, URLs, cookies or tokens are recorded. */
class OpenClawApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val original = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, failure ->
            runCatching {
                val report = buildString {
                    appendLine("OpenClaw ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    appendLine("${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE}; API ${Build.VERSION.SDK_INT}")
                    var cause: Throwable? = failure
                    repeat(8) {
                        val current = cause ?: return@repeat
                        appendLine(current.javaClass.name)
                        current.stackTrace.take(40).forEach { appendLine("  at $it") }
                        cause = current.cause
                    }
                }
                File(filesDir, "last-crash.txt").writeText(report)
            }
            if (original != null) original.uncaughtException(thread, failure)
            else { android.os.Process.killProcess(android.os.Process.myPid()); kotlin.system.exitProcess(10) }
        }
    }
}

/** Separate from the main window and WebView so a startup failure can be inspected. */
class DiagnosticsActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val file = File(filesDir, "last-crash.txt")
        val report = runCatching { file.readText() }.getOrDefault("无法读取本地崩溃记录")
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 32, 24, 24) }
        body.addView(TextView(this).apply { text = "上次运行异常退出"; textSize = 22f })
        body.addView(TextView(this).apply { text = "以下诊断仅保存在手机，不会自动上传。复制并发给玲珑定位；重试不会清除登录。" })
        body.addView(Button(this).apply {
            text = "复制诊断"
            setOnClickListener { (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("OpenClaw crash", report)) }
        })
        body.addView(Button(this).apply {
            text = "清除记录并重试"
            setOnClickListener {
                if (file.exists() && !file.delete()) return@setOnClickListener
                startActivity(Intent(this@DiagnosticsActivity, MainActivity::class.java)); finish()
            }
        })
        body.addView(Button(this).apply { text = "检查应用更新"; setOnClickListener { startActivity(Intent(this@DiagnosticsActivity, UpdateActivity::class.java)) } })
        body.addView(ScrollView(this).apply { addView(TextView(this@DiagnosticsActivity).apply { text = report; textSize = 12f; setTextIsSelectable(true) }) }, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(body)
    }
}
