package dev.openclaw.mobile

import org.json.JSONArray
import java.net.URI

/** Only Android stable releases from our own repository can supply updates. */
object UpdatePolicy {
    const val REPO = "CatInOrange/openclaw-desktop"
    const val CERT = "d52b0f680879d78baedd77e91b3c12118fce36a606bd80d92773d5b5c34846c1"
    data class Release(val version: String, val apk: String, val sums: String, val name: String, val size: Long)
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
    const val MAX_APK = 250L * 1024 * 1024
    fun checksum(text: String, name: String): String {
        return text.lineSequence().map { it.trim().split(Regex("\\s+"), limit = 2) }
            .firstOrNull { it.size == 2 && it[1].removePrefix("*") == name && Regex("[a-fA-F0-9]{64}").matches(it[0]) }
            ?.first()?.lowercase() ?: error("发布缺少 APK 校验值")
    }
}
