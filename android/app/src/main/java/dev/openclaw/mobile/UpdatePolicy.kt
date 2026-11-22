package dev.openclaw.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** Download origin is pinned to the build-injected update endpoint. APK identity is checked before install. */
object UpdatePolicy {
    const val REPO = "CatInOrange/openclaw-desktop"
    const val CERT = "d52b0f680879d78baedd77e91b3c12118fce36a606bd80d92773d5b5c34846c1"
    data class Release(val version: String, val apk: String, val sums: String, val name: String, val size: Long, val sha256: String? = null, val zipped: Boolean = false, val apkSize: Long = 0, val apkSha256: String? = null)
    fun version(value: String): List<Int>? { return Regex("^(\\d+)\\.(\\d+)\\.(\\d+)$").matchEntire(value)?.groupValues?.drop(1)?.map { it.toIntOrNull() ?: return null } }
    fun newer(candidate: String, current: String): Boolean {
        val a = version(candidate) ?: return false
        val b = version(current) ?: return false
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }
    fun assetUrl(value: String, tag: String): Boolean {
        val uri = runCatching { URI(value) }.getOrNull() ?: return false
        return uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 && uri.rawUserInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.startsWith("/$REPO/releases/download/$tag/")
    }
    fun select(json: String, current: String): Release? {
        val releases = JSONArray(json)
        var best: Release? = null
        for (i in 0 until releases.length()) {
            val row = releases.getJSONObject(i)
            if (row.optBoolean("draft") || row.optBoolean("prerelease")) continue
            val tag = row.optString("tag_name")
            if (!tag.startsWith("android-v")) continue
            val ver = tag.removePrefix("android-v")
            if (!newer(ver, best?.version ?: current)) continue
            val name = "OpenClaw-Android-$ver.apk"
            val assets = row.getJSONArray("assets")
            var apk: String? = null; var sums: String? = null; var size = 0L
            for (j in 0 until assets.length()) {
                val asset = assets.getJSONObject(j)
                val url = asset.getString("browser_download_url")
                if (!assetUrl(url, tag)) continue
                if (asset.getString("name") == name) { apk = url; size = asset.optLong("size") }
                if (asset.getString("name") == "SHA256SUMS") sums = url
            }
            if (apk != null && sums != null && size in 1..MAX_APK) best = Release(ver, apk, sums, name, size)
        }
        return best
    }
    fun mirrorUrl(value: String, manifestUrl: String): Boolean {
        val uri = runCatching { URI(value) }.getOrNull() ?: return false
        val base = runCatching { URI(manifestUrl) }.getOrNull() ?: return false
        return base.scheme == "https" && !base.host.isNullOrBlank() &&
            uri.scheme == "https" && uri.host == base.host && uri.port == -1 &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            uri.normalize().rawPath == uri.rawPath && uri.rawPath.startsWith(base.rawPath.substringBeforeLast('/') + "/releases/")
    }
    fun selectManifest(json: String, current: String, manifestUrl: String): Release? {
        val row = JSONObject(json)
        require(row.getInt("schemaVersion") == 1) { "不支持的更新清单" }
        val ver = row.getString("version")
        require(version(ver) != null) { "更新版本无效" }
        if (!newer(ver, current)) return null
        val name = "OpenClaw-Android-$ver.apk"
        val url = row.getString("apkUrl")
        val size = row.getLong("size")
        val sha = row.getString("sha256").lowercase()
        val zipped = row.optString("format") == "zip"
        val suffix = if (zipped) "$name.zip" else name
        require(mirrorUrl(url, manifestUrl) && URI(url).rawPath.endsWith("/$suffix")) { "更新下载来源无效" }
        require(size in 1..MAX_APK && Regex("[a-f0-9]{64}").matches(sha)) { "更新文件信息无效" }
        val apkSize = if (zipped) row.getLong("apkSize") else size
        val apkSha = if (zipped) row.getString("apkSha256").lowercase() else sha
        require(apkSize in 1..MAX_APK && Regex("[a-f0-9]{64}").matches(apkSha)) { "APK 信息无效" }
        return Release(ver, url, "", name, size, sha, zipped, apkSize, apkSha)
    }
    const val MAX_APK = 250L * 1024 * 1024
    fun checksum(text: String, name: String): String {
        return text.lineSequence().map { it.trim().split(Regex("\\s+"), limit = 2) }
            .firstOrNull { it.size == 2 && it[1].removePrefix("*") == name && Regex("[a-fA-F0-9]{64}").matches(it[0]) }
            ?.first()?.lowercase() ?: error("发布缺少 APK 校验值")
    }
}
