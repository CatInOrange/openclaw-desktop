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
}
