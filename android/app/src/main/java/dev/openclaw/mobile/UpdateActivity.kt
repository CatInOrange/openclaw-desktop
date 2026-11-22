package dev.openclaw.mobile

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class UpdateActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var action: Button
    private val worker = Executors.newSingleThreadExecutor()
    private val apk by lazy { File(cacheDir, "updates/update.apk") }
    private var release: UpdatePolicy.Release? = null
    private var verified = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 64, 32, 32) }
        body.addView(TextView(this).apply { text = "应用更新"; textSize = 24f })
        status = TextView(this).apply { text = "当前版本 ${BuildConfig.VERSION_NAME}"; textSize = 16f }
        body.addView(status)
        action = Button(this).apply { text = "检查更新"; setOnClickListener { check() } }
        body.addView(action)
        body.addView(Button(this).apply { text = "返回"; setOnClickListener { finish() } })
        setContentView(body)
        check()
    }

    private fun ui(block: () -> Unit) { runOnUiThread { if (!isFinishing && !isDestroyed) block() } }
    private fun task(message: String, work: () -> Unit) {
        status.text = message; action.isEnabled = false
        worker.execute {
            try { work() } catch (error: Exception) {
                ui { status.text = "更新失败：${error.message ?: "请检查网络后重试"}"; action.text = "重试检查"; action.isEnabled = true; action.setOnClickListener { check() } }
            }
        }
    }
    private fun fetch(url: String, limit: Long, consume: (java.io.InputStream) -> Unit) {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 30000
        connection.setRequestProperty("User-Agent", "OpenClaw-Android/${BuildConfig.VERSION_NAME}")
        try {
            require(connection.responseCode == 200) { "服务器返回 ${connection.responseCode}" }
            require(connection.url.protocol == "https") { "下载连接不安全" }
            require(connection.contentLengthLong <= limit) { "下载文件过大" }
            connection.inputStream.use { input ->
                // Enforce size even for chunked responses.
                val bounded = object : java.io.FilterInputStream(input) {
                    var count = 0L
                    override fun read(): Int { val n = super.read(); if (n >= 0) count++; require(count <= limit); return n }
                    override fun read(b: ByteArray, off: Int, len: Int): Int { val n = `in`.read(b, off, len); if (n > 0) count += n; require(count <= limit); return n }
                }
                consume(bounded)
            }
        } finally { connection.disconnect() }
    }
    private fun text(url: String): String { var result = ""; fetch(url, 2L * 1024 * 1024) { result = it.bufferedReader().readText() }; return result }
    private fun check() {
        verified = false
        task("正在检查新版…") {
            val next = UpdatePolicy.select(text("https://api.github.com/repos/${UpdatePolicy.REPO}/releases?per_page=100"), BuildConfig.VERSION_NAME)
            release = next
            ui {
                status.text = if (next == null) "已是最新版本 ${BuildConfig.VERSION_NAME}" else "发现 ${next.version}（${next.size / 1024} KB）\n下载校验后，由系统确认覆盖安装；登录数据保留。下载时请留在本页。"
                action.isEnabled = true
                action.text = if (next == null) "重新检查" else "下载更新"
                action.setOnClickListener { if (next == null) check() else download(next) }
            }
        }
    }
    private fun download(next: UpdatePolicy.Release) {
        task("正在下载 ${next.version}…请留在本页") {
            apk.parentFile!!.mkdirs()
            verified = false
            try {
                val expected = UpdatePolicy.checksum(text(next.sums), next.name)
                fetch(next.apk, UpdatePolicy.MAX_APK) { input -> apk.outputStream().use { input.copyTo(it) } }
                require(apk.length() == next.size) { "APK 下载不完整" }
                val digest = apk.inputStream().use { input ->
                    val hash = MessageDigest.getInstance("SHA-256"); val buffer = ByteArray(65536)
                    while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) }
                    hash.digest().joinToString("") { "%02x".format(it) }
                }
                require(digest == expected) { "APK 校验不匹配" }
                verifyPackage(next)
                verified = true
                ui { status.text = "${next.version} 已下载，文件和发布签名校验通过。"; action.text = "安装更新"; action.isEnabled = true; action.setOnClickListener { install() } }
            } catch (error: Exception) { apk.delete(); throw error }
        }
    }
    @Suppress("DEPRECATION")
    private fun verifyPackage(next: UpdatePolicy.Release) {
        val info = packageManager.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: error("无法读取 APK")
        require(info.packageName == packageName && info.versionName == next.version && info.longVersionCode > BuildConfig.VERSION_CODE) { "APK 身份或版本不匹配" }
        val signers = info.signingInfo?.apkContentsSigners ?: error("APK 未签名")
        require(signers.size == 1 && MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray()).joinToString("") { "%02x".format(it) } == UpdatePolicy.CERT) { "APK 发布签名不匹配" }
    }
    private fun install() {
        try {
            check(verified && apk.exists()) { "请重新下载更新" }
            verifyPackage(release ?: error("请重新检查更新"))
            if (!packageManager.canRequestPackageInstalls()) {
                status.text = "请允许 OpenClaw 安装更新，返回后再次点击「安装更新」。"
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                return
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.updates", apk)
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (error: Exception) { status.text = "无法开始安装：${error.message}" }
    }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
}
