package dev.openclaw.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UpdatePolicyTest {
    private fun release(ver: String, pre: Boolean = false): JSONObject {
        val base = "https://github.com/${UpdatePolicy.REPO}/releases/download/android-v$ver/"
        return JSONObject().put("tag_name", "android-v$ver").put("prerelease", pre).put("assets", JSONArray()
            .put(JSONObject().put("name", "OpenClaw-Android-$ver.apk").put("browser_download_url", base + "OpenClaw-Android-$ver.apk").put("size", 123))
            .put(JSONObject().put("name", "SHA256SUMS").put("browser_download_url", base + "SHA256SUMS")))
    }
    @Test fun selectsHighestStableAndroidOnlyAndRejectsDowngrades() {
        val rows = JSONArray().put(release("0.1.3")).put(release("0.1.10")).put(release("0.2.0", true))
            .put(release("9.0.0").put("tag_name", "v9.0.0"))
        assertEquals("0.1.10", UpdatePolicy.select(rows.toString(), "0.1.2")?.version)
        assertNull(UpdatePolicy.select(rows.toString(), "0.1.10"))
        assertFalse(UpdatePolicy.newer("9999999999999.0.0", "0.1.2"))
    }
    @Test fun rejectsForeignAndIncompleteAssets() {
        val row = release("0.1.3")
        row.getJSONArray("assets").getJSONObject(0).put("browser_download_url", "https://evil.example/update.apk")
        assertNull(UpdatePolicy.select(JSONArray().put(row).toString(), "0.1.2"))
        assertFalse(UpdatePolicy.assetUrl("http://github.com/${UpdatePolicy.REPO}/releases/download/android-v0.1.3/a", "android-v0.1.3"))
    }
    @Test fun checksumMustMatchExactFilename() {
        val hash = "a".repeat(64)
        assertEquals(hash, UpdatePolicy.checksum("$hash  app.apk\n", "app.apk"))
        try { UpdatePolicy.checksum("$hash  other.apk", "app.apk"); fail("Wrong file accepted") } catch (_: IllegalStateException) { }
    }

    private val endpoint = "https://updates.example.invalid/openclaw-desktop/android/latest.json"
    private fun manifest(): JSONObject = JSONObject().put("schemaVersion", 1).put("version", "0.1.4")
        .put("apkUrl", "https://updates.example.invalid/openclaw-desktop/android/releases/android-v0.1.4/OpenClaw-Android-0.1.4.apk")
        .put("size", 123).put("sha256", "a".repeat(64))
    @Test fun mirrorSelectsNewVersionAndRejectsDowngrades() {
        val next = UpdatePolicy.selectManifest(manifest().toString(), "0.1.3", endpoint)!!
        assertEquals("0.1.4", next.version)
        assertEquals("a".repeat(64), next.sha256)
        assertNull(UpdatePolicy.selectManifest(manifest().toString(), "0.1.4", endpoint))
        assertNull(UpdatePolicy.selectManifest(manifest().toString(), "0.2.0", endpoint))
    }
    @Test fun mirrorRejectsForeignOriginsAndMalformedMetadata() {
        val valid = manifest().getString("apkUrl")
        for (url in listOf(valid.replace("https:", "http:"), valid.replace("updates.example.invalid", "evil.example"), valid + "?token=x", valid.replace("/releases/", "/releases/../"), valid.replace("/releases/", "/other/"))) {
            assertFalse(UpdatePolicy.mirrorUrl(url, endpoint))
        }
        for (row in listOf(manifest().put("sha256", "bad"), manifest().put("size", 0), manifest().put("size", UpdatePolicy.MAX_APK + 1), manifest().put("schemaVersion", 2), manifest().put("apkUrl", valid.replace("0.1.4.apk", "0.1.3.apk")))) {
            try { UpdatePolicy.selectManifest(row.toString(), "0.1.3", endpoint); fail("Invalid manifest accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
