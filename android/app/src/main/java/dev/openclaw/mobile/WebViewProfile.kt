package dev.openclaw.mobile

import android.webkit.WebView

/** WebView storage profiles are process-scoped; set before ANY provider access. */
object WebViewProfile {
    private var activeOrigin: String? = null
    @Synchronized fun prepare(origin: String) {
        if (activeOrigin == null) {
            WebView.setDataDirectorySuffix(GatewayPolicy.profile(origin))
            activeOrigin = origin
        } else {
            check(activeOrigin == origin) { "Gateway profile changes require a fresh application process" }
        }
    }
    @Synchronized fun isDifferent(origin: String): Boolean = activeOrigin != null && activeOrigin != origin
}
