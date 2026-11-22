package dev.openclaw.mobile

import android.content.Context
import java.io.File
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

/** One persistent Gecko profile per Gateway origin; one runtime per process. */
object GeckoProfile {
    private var activeOrigin: String? = null
    private var runtime: GeckoRuntime? = null
    @Synchronized fun prepare(context: Context, origin: String): GeckoRuntime {
        check(activeOrigin == null || activeOrigin == origin) { "Gateway profile changes require a fresh process" }
        runtime?.let { return it }
        val directory = File(context.filesDir, "gecko/${GatewayPolicy.profile(origin)}").apply { mkdirs() }
        val settings = GeckoRuntimeSettings.Builder()
            .arguments(arrayOf("-profile", directory.absolutePath))
            .remoteDebuggingEnabled(BuildConfig.DEBUG)
            .consoleOutput(BuildConfig.DEBUG).build()
        return GeckoRuntime.create(context.applicationContext, settings).also { runtime = it; activeOrigin = origin }
    }
    @Synchronized fun isDifferent(origin: String): Boolean = activeOrigin != null && activeOrigin != origin
}
