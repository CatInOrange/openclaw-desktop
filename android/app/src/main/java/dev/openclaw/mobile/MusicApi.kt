package dev.openclaw.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.IvParameterSpec

/** Narrow transport port of @neteasecloudmusicapienhanced/api 4.41.1. No proxy or unlock. */
internal object MusicCrypto {
    private fun aes(text: String, key: String, cbc: Boolean): ByteArray = Cipher.getInstance(if (cbc) "AES/CBC/PKCS5Padding" else "AES/ECB/PKCS5Padding").run {
        val secret = SecretKeySpec(key.toByteArray(), "AES")
        if (cbc) init(Cipher.ENCRYPT_MODE, secret, IvParameterSpec("0102030405060708".toByteArray())) else init(Cipher.ENCRYPT_MODE, secret)
        doFinal(text.toByteArray())
    }
    fun eapi(path: String, json: String): String {
        val digest = MessageDigest.getInstance("MD5").digest("nobody${path}use${json}md5forencrypt".toByteArray()).joinToString("") { "%02x".format(it) }
        return aes("$path-36cd479b6b5-$json-36cd479b6b5-$digest", "e82ckenh8dichen8", false).joinToString("") { "%02X".format(it) }
    }
    fun weapi(json: String, secret: String = randomSecret()): Map<String, String> {
        val first = Base64.getEncoder().encodeToString(aes(json, "0CoJUm6Qyw8W8jud", true))
        val params = Base64.getEncoder().encodeToString(aes(first, secret, true))
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode("MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB")))
        val rsa = Cipher.getInstance("RSA/ECB/NoPadding").run { init(Cipher.ENCRYPT_MODE, key); doFinal(secret.reversed().toByteArray()) }
        return mapOf("params" to params, "encSecKey" to rsa.joinToString("") { "%02x".format(it) })
    }
    private fun randomSecret(): String { val alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; val random = SecureRandom(); return (1..16).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("") }
}

internal class MusicApi {
    var cookie = ""
    fun call(path: String, data: JSONObject = JSONObject(), web: Boolean = false, authenticated: Boolean = true): JSONObject {
        val sentCookie = if (authenticated) cookie else ""
        val cookies = sentCookie.split(';').mapNotNull { val pair = it.trim().split('=', limit = 2); if (pair.size == 2) pair[0] to pair[1] else null }.toMap()
        val envelope: Map<String, String>
        val endpoint: String
        val header = JSONObject().put("os", "pc").put("appver", "3.1.17.204416").put("osver", "Microsoft-Windows-10-Professional-build-19045-64bit")
            .put("channel", "netease").put("__csrf", cookies["__csrf"] ?: "").put("requestId", "${System.currentTimeMillis()}_0001")
        listOf("MUSIC_U", "MUSIC_A", "NMTID").forEach { cookies[it]?.let { value -> header.put(it, value) } }
        if (web) {
            data.put("csrf_token", cookies["__csrf"] ?: "")
            envelope = MusicCrypto.weapi(data.toString()); endpoint = "https://music.163.com/weapi/" + path.removePrefix("/api/")
        } else {
            data.put("header", header)
            envelope = mapOf("params" to MusicCrypto.eapi(path, data.toString())); endpoint = "https://interfacepc.music.163.com/eapi/" + path.removePrefix("/api/")
        }
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false; connection.connectTimeout = 15000; connection.readTimeout = 20000
        connection.requestMethod = "POST"; connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        connection.setRequestProperty("Referer", "https://music.163.com/")
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36")
        connection.setRequestProperty("Cookie", if (web) sentCookie else header.keys().asSequence().joinToString("; ") { "$it=${encode(header.getString(it))}" })
        try {
            connection.outputStream.use { out -> out.write(envelope.entries.joinToString("&") { "${it.key}=${encode(it.value)}" }.toByteArray()) }
            val response = connection.responseCode
            require(response == 200) { "音乐网络请求失败，请稍后重试" }
            val result = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(65536)
                while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 8 * 1024 * 1024); output.write(buffer, 0, n) }
                val bytes = output.toByteArray()
                JSONObject(String(bytes, Charsets.UTF_8))
            }
            val set = connection.headerFields.entries.filter { it.key?.equals("set-cookie", true) == true }.flatMap { it.value }.map { it.substringBefore(';') }
            if (set.isNotEmpty()) result.put("sessionCookie", set.joinToString("; "))
            if (authenticated && result.optInt("code") in listOf(301, 302)) { cookie = ""; throw IllegalStateException("登录已过期，请重新登录") }
            return result
        } finally { connection.disconnect() }
    }
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
}
