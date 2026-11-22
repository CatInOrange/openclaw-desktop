package dev.openclaw.mobile

import java.net.URI
import java.security.MessageDigest
import java.util.Locale

/** Platform-neutral URL policy. Saved entry URLs and in-page navigation differ. */
object GatewayPolicy {
    data class Address(val url: String, val origin: String, val host: String, val cleartext: Boolean)
    enum class Navigation { INTERNAL, EXTERNAL, BLOCKED }

    private data class WebAddress(val uri: URI, val scheme: String, val host: String, val port: Int) {
        val origin: String get() {
            val authority = if (host.contains(':')) "[$host]" else host
            val defaultPort = if (scheme == "https") 443 else 80
            return "$scheme://$authority" + if (port == defaultPort) "" else ":$port"
        }
    }
    private fun webAddress(value: String): WebAddress? = runCatching {
        if (value.isBlank() || value.any { it.isWhitespace() || it.code < 0x20 } || value.contains('\\')) return null
        val uri = URI(value)
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "https" && scheme != "http") return null
        if (uri.rawUserInfo != null || uri.isOpaque) return null
        val host = uri.host?.removeSurrounding("[", "]")?.lowercase(Locale.ROOT) ?: return null
        if (host.isEmpty() || host.endsWith('.') || host.contains('%')) return null
        val port = if (uri.port == -1) if (scheme == "https") 443 else 80 else uri.port
        if (port !in 1..65535) return null
        WebAddress(uri, scheme, host, port)
    }.getOrNull()

    fun normalize(input: String): Address {
        val value = input.trim()
        val web = webAddress(value) ?: throw IllegalArgumentException("请输入完整的 https:// Gateway 地址，或局域网 http:// 地址。")
        require(web.uri.rawQuery == null && web.uri.rawFragment == null) { "地址不能包含查询参数、Token 或 # 片段；请在 Control UI 内登录。" }
        require(web.scheme == "https" || isLocalHost(web.host)) { "公网 Gateway 请使用 HTTPS；HTTP 仅支持明确填写的局域网地址。" }
        var path = web.uri.normalize().rawPath.orEmpty()
        if (path.isEmpty()) path = "/"
        if (!path.endsWith('/')) path += "/"
        return Address(web.origin + path, web.origin, web.host, web.scheme == "http")
    }

    fun sameOrigin(a: String, b: String): Boolean {
        val one = webAddress(a) ?: return false
        val two = webAddress(b) ?: return false
        return one.origin == two.origin
    }

    fun navigation(url: String, gateway: String): Navigation {
        val target = webAddress(url) ?: return Navigation.BLOCKED
        return if (sameOrigin(url, gateway)) Navigation.INTERNAL else Navigation.EXTERNAL
    }

    fun safeExternal(url: String): Boolean = webAddress(url) != null

    fun profile(origin: String): String = "gateway_" + MessageDigest.getInstance("SHA-256")
        .digest(origin.toByteArray(Charsets.UTF_8)).take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun isLocalHost(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan")) return true
        if (host == "::1" || host.startsWith("fc") && host.contains(':') || host.startsWith("fd") && host.contains(':')) return true
        if (host.matches(Regex("^fe[89ab][0-9a-f]:[0-9a-f:]+$"))) return true
        val octets = host.split('.').map { it.toIntOrNull() }
        if (octets.size == 4 && octets.all { it != null && it in 0..255 }) {
            val a = octets[0]!!; val b = octets[1]!!
            return a == 10 || a == 127 || a == 192 && b == 168 || a == 172 && b in 16..31 || a == 169 && b == 254 || a == 100 && b in 64..127
        }
        return !host.contains('.') && !host.contains(':') && host.matches(Regex("^[a-z0-9-]+$"))
    }
}
