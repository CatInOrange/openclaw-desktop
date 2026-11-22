package dev.openclaw.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.Collections
import java.util.concurrent.Executors

/** Android-native connection shell. Remote content never receives a native JS bridge. */
class MainActivity : Activity() {
    private val preferences by lazy { getSharedPreferences("connection", MODE_PRIVATE) }
    private lateinit var root: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var overlay: LinearLayout
    private lateinit var statusTitle: TextView
    private lateinit var statusText: TextView
    private lateinit var retryButton: Button
    private lateinit var progress: ProgressBar
    private lateinit var subtitle: TextView
    private var browser: WebView? = null
    @Volatile private var gateway: GatewayPolicy.Address? = null
    private var lastInternalUrl: String? = null
    private var mainFrameFailed = false
    private var settingsDialog: AlertDialog? = null
    private var pendingFile: ValueCallback<Array<Uri>>? = null
    private val selectedContent = Collections.synchronizedSet(mutableSetOf<String>())
    private val documentExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNativeUi()
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { navigateBack() }
        }
        val saved = preferences.getString("gateway", null)
        val address = saved?.let { runCatching { GatewayPolicy.normalize(it) }.getOrNull() }
        if (address == null) {
            showStatus("连接你的 OpenClaw", "填写手机可以访问的 Gateway 地址。聊天、登录与设备配对仍在原版 Control UI 中进行。", false)
            showSettings()
        } else {
            connect(address, savedInstanceState)
        }
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
    private fun night() = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    private fun background() = if (night()) Color.rgb(18, 25, 33) else Color.rgb(247, 249, 251)
    private fun foreground() = if (night()) Color.rgb(233, 237, 243) else Color.rgb(31, 42, 52)
    private fun text(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(foreground()) }

    private fun createNativeUi() {
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.setSystemBarsAppearance(
                if (night()) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                if (night()) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(background()) }
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        val toolbar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(14), 0, dp(8), 0) }
        toolbar.addView(ImageView(this).apply { setImageResource(R.mipmap.ic_launcher); contentDescription = "OpenClaw" }, LinearLayout.LayoutParams(dp(28), dp(28)))
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), 0, 0, 0) }
        titles.addView(text("OpenClaw", 17f))
        subtitle = text("移动连接版", 10f).apply { alpha = 0.65f; maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
        titles.addView(subtitle)
        toolbar.addView(titles, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(Button(this).apply { text = "设置"; textSize = 13f; setOnClickListener { showSettings() } }, LinearLayout.LayoutParams(dp(68), dp(46)))
        root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = View.GONE }
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        overlay = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(30), dp(24), dp(30), dp(24)); setBackgroundColor(background()) }
        statusTitle = text("", 22f).apply { gravity = Gravity.CENTER }
        statusText = text("", 14f).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, dp(18)); setLineSpacing(dp(3).toFloat(), 1f) }
        retryButton = Button(this).apply { text = "重试连接"; setOnClickListener { retry() } }
        overlay.addView(statusTitle)
        overlay.addView(statusText)
        overlay.addView(retryButton)
        overlay.addView(Button(this).apply { text = "连接设置"; setOnClickListener { showSettings() } })
        content.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        root.requestApplyInsets()
    }

    private fun showStatus(title: String, message: String, retry: Boolean = true) {
        mainFrameFailed = true
        statusTitle.text = title
        statusText.text = message
        retryButton.visibility = if (retry && browser != null) View.VISIBLE else View.GONE
        overlay.visibility = View.VISIBLE
        overlay.bringToFront()
        browser?.visibility = View.INVISIBLE
        progress.visibility = View.GONE
    }

    private fun beginPage(url: String?) {
        val address = gateway ?: return
        if (url == null || url == "about:blank" || url.startsWith("chrome-error:")) return
        if (GatewayPolicy.navigation(url, address.url) != GatewayPolicy.Navigation.INTERNAL) {
            browser?.stopLoading()
            showStatus("跳转已阻止", "页面尝试离开当前 Gateway。请通过设置明确切换服务器。")
            return
        }
        pendingFile?.onReceiveValue(null)
        pendingFile = null
        selectedContent.clear()
        browser?.settings?.allowContentAccess = false
        lastInternalUrl = url
        mainFrameFailed = false
        overlay.visibility = View.GONE
        browser?.visibility = View.VISIBLE
        progress.visibility = View.VISIBLE
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun connect(address: GatewayPolicy.Address, savedState: Bundle? = null) {
        gateway = address
        subtitle.text = address.host
        WebViewProfile.prepare(address.origin)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val web = WebView(this)
        browser = web
        web.setBackgroundColor(background())
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = true
        }
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url.toString()
                val current = gateway ?: return true
                return when (GatewayPolicy.navigation(target, current.url)) {
                    GatewayPolicy.Navigation.INTERNAL -> false
                    GatewayPolicy.Navigation.EXTERNAL -> {
                        if (request.isForMainFrame && request.hasGesture()) openExternal(target)
                        else if (request.isForMainFrame) showStatus("跳转已阻止", "当前页面跳转到了其他服务器。外部网站需主动点击打开，切换 Gateway 请使用设置。")
                        true
                    }
                    GatewayPolicy.Navigation.BLOCKED -> { if (request.isForMainFrame) toast("不支持此类型的链接"); true }
                }
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                val scheme = uri.scheme?.lowercase()
                if (scheme == "file" || scheme == "intent" || scheme == "javascript") return blockedResource()
                if (scheme == "content") return if (selectedContent.contains(uri.toString())) null else blockedResource()
                val current = gateway ?: return blockedResource()
                if (request.isForMainFrame && GatewayPolicy.navigation(uri.toString(), current.url) != GatewayPolicy.Navigation.INTERNAL) return blockedResource()
                if (scheme == "http" && !GatewayPolicy.sameOrigin(uri.toString(), current.url)) return blockedResource()
                // Browser cookies are not port-scoped: never send them to another
                // port/scheme of the Gateway host as an embedded resource.
                if (scheme == "https" || scheme == "http") {
                    val host = runCatching { URI(uri.toString()).host?.removeSurrounding("[", "]")?.lowercase() }.getOrNull()
                    if (host == current.host && !GatewayPolicy.sameOrigin(uri.toString(), current.url)) return blockedResource()
                }
                return null
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { beginPage(url) }
            override fun onPageFinished(view: WebView, url: String?) {
                progress.visibility = View.GONE
                if (!mainFrameFailed && url != null && gateway?.let { GatewayPolicy.sameOrigin(url, it.url) } == true) {
                    overlay.visibility = View.GONE
                    web.visibility = View.VISIBLE
                    CookieManager.getInstance().flush()
                }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showStatus("无法连接 Gateway", "请检查手机网络与服务器地址，然后重试。（错误 ${error.errorCode}）")
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame) showStatus("服务器返回错误", "Gateway 返回 HTTP ${errorResponse.statusCode}，请检查地址或稍后重试。")
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                showStatus("证书验证失败", "连接已取消。请修复服务器证书，或使用受信任的 HTTPS 入口；此应用不会忽略证书错误。")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                if (!mainFrameFailed) progress.visibility = if (newProgress < 100) View.VISIBLE else View.GONE
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
                toast("此连接版暂不提供摄像头或麦克风访问")
            }
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) { callback.invoke(origin, false, false) }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                pendingFile?.onReceiveValue(null)
                pendingFile = null
                if (mainFrameFailed || gateway?.let { GatewayPolicy.sameOrigin(view.url.orEmpty(), it.url) } != true || params.mode !in listOf(WebChromeClient.FileChooserParams.MODE_OPEN, WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)) {
                    callback.onReceiveValue(null)
                    return true
                }
                val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }
                    .filter { it.matches(Regex("^[a-zA-Z0-9!#$&^_.+*-]+/[a-zA-Z0-9!#$&^_.+*-]+$")) }.distinct().take(12)
                val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (types.size == 1) types[0] else "*/*"
                    if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                pendingFile = callback
                try { startActivityForResult(picker, FILE_PICKER) }
                catch (_: ActivityNotFoundException) { pendingFile = null; callback.onReceiveValue(null); toast("未找到系统文件选择器") }
                return true
            }
        }
        web.setDownloadListener { url, _, _, _, _ ->
            if (GatewayPolicy.safeExternal(url)) {
                AlertDialog.Builder(this).setTitle("在系统浏览器下载？")
                    .setMessage("浏览器不会收到本应用的登录凭据，可能需要单独登录。")
                    .setPositiveButton("打开浏览器") { _, _ -> openExternal(url) }
                    .setNegativeButton("取消", null).show()
            } else toast("当前版本不支持此类临时下载链接")
        }
        content.addView(web, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val restored = savedState?.takeIf { it.getString("browserOrigin") == address.origin }?.getBundle("browser")?.let { web.restoreState(it) } != null
        if (!restored) web.loadUrl(address.url)
        else { mainFrameFailed = false; overlay.visibility = View.GONE; web.visibility = View.VISIBLE }
    }

    private fun blockedResource() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private fun retry() {
        val address = gateway ?: return showSettings()
        val target = lastInternalUrl?.takeIf { GatewayPolicy.sameOrigin(it, address.url) } ?: address.url
        browser?.loadUrl(target)
    }

    private fun openExternal(url: String) {
        if (!GatewayPolicy.safeExternal(url)) return toast("不支持此类型的链接")
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (_: ActivityNotFoundException) { toast("未找到可打开链接的浏览器") }
    }

    private fun showSettings() {
        if (settingsDialog?.isShowing == true) return
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(8), dp(22), 0) }
        body.addView(text("填写手机可访问的 Gateway 地址。电脑的 localhost / 127.0.0.1 不代表那台电脑。", 13f))
        val input = EditText(this).apply {
            hint = "https://claw.example.com/"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(preferences.getString("gateway", ""))
            setSelectAllOnFocus(true)
        }
        body.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
        body.addView(text("请勿把 Token 放在地址中。登录与配对在 Control UI 内进行。不同服务器使用独立登录空间；切换服务器需退出后重新打开，旧登录保留。", 12f).apply { alpha = 0.75f })
        val dialog = AlertDialog.Builder(this).setTitle("连接设置").setView(body).setPositiveButton("连接", null).setNegativeButton("取消", null).create()
        settingsDialog = dialog
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val address = try { GatewayPolicy.normalize(input.text.toString()) } catch (error: IllegalArgumentException) { input.error = error.message; return@setOnClickListener }
                val apply = applyConnection@ {
                    if (WebViewProfile.isDifferent(address.origin)) confirmProfileSwitch(address, dialog)
                    else {
                        if (!preferences.edit().putString("gateway", address.url).commit()) {
                            toast("连接设置保存失败，请重试")
                            return@applyConnection
                        }
                        dialog.dismiss()
                        if (browser == null) connect(address)
                        else { gateway = address; subtitle.text = address.host; lastInternalUrl = address.url; browser?.loadUrl(address.url) }
                    }
                }
                if (address.cleartext) AlertDialog.Builder(this).setTitle("连接局域网 HTTP？")
                    .setMessage("此连接没有 HTTPS 保护，设备认证所需的 WebCrypto 也可能受限。仅在你信任的局域网使用；推荐 HTTPS。")
                    .setPositiveButton("继续连接") { _, _ -> apply() }.setNegativeButton("取消", null).show()
                else apply()
            }
        }
        dialog.setOnDismissListener { if (settingsDialog === dialog) settingsDialog = null }
        dialog.show()
    }

    private fun confirmProfileSwitch(address: GatewayPolicy.Address, settings: AlertDialog) {
        AlertDialog.Builder(this).setTitle("切换独立登录空间")
            .setMessage("需重新打开应用以切换服务器。现有服务器的登录会保留，不会带到新服务器。保存后请再次点击 OpenClaw 图标。")
            .setPositiveButton("保存并退出") { _, _ ->
                // commit is intentional: the process will end immediately afterwards.
                if (!preferences.edit().putString("gateway", address.url).commit()) {
                    toast("连接设置保存失败，请重试")
                    return@setPositiveButton
                }
                CookieManager.getInstance().flush()
                settings.dismiss()
                pendingFile?.onReceiveValue(null)
                pendingFile = null
                browser?.stopLoading()
                finishAndRemoveTask()
                val self = Process.myPid()
                Handler(Looper.getMainLooper()).postDelayed({ Process.killProcess(self) }, 200)
            }.setNegativeButton("取消", null).show()
    }

    @Deprecated("Uses platform Activity result API to avoid a full UI framework dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != FILE_PICKER) return
        val callback = pendingFile ?: return
        if (resultCode != RESULT_OK) { pendingFile = null; callback.onReceiveValue(null); return }
        val candidates = buildList<Uri> {
            data?.clipData?.let { clip -> for (i in 0 until minOf(clip.itemCount, 10)) clip.getItemAt(i).uri?.let { add(it) } }
            data?.data?.let { add(it) }
        }.distinct().take(10)
        documentExecutor.execute {
            val readable = candidates.filter { uri ->
                uri.scheme == "content" && uri.authority != null && uri.toString().length < 8192 && runCatching {
                    contentResolver.openAssetFileDescriptor(uri, "r")?.use { true } ?: false
                }.getOrDefault(false)
            }
            runOnUiThread {
                if (pendingFile !== callback) return@runOnUiThread
                pendingFile = null
                if (isFinishing || isDestroyed || readable.isEmpty()) callback.onReceiveValue(null)
                else {
                    selectedContent.addAll(readable.map(Uri::toString))
                    browser?.settings?.allowContentAccess = true
                    callback.onReceiveValue(readable.toTypedArray())
                }
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        root.requestApplyInsets()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        browser?.let { web ->
            val browserState = Bundle()
            web.saveState(browserState)
            outState.putBundle("browser", browserState)
            outState.putString("browserOrigin", gateway?.origin)
        }
        super.onSaveInstanceState(outState)
    }
    override fun onPause() {
        browser?.onPause()
        if (browser != null) CookieManager.getInstance().flush()
        super.onPause()
    }
    override fun onResume() { super.onResume(); browser?.onResume() }
    @Deprecated("Platform back navigation retains WebView history")
    override fun onBackPressed() { navigateBack() }
    private fun navigateBack() {
        val web = browser
        if (web?.canGoBack() == true) web.goBack() else finish()
    }
    override fun onDestroy() {
        pendingFile?.onReceiveValue(null)
        pendingFile = null
        selectedContent.clear()
        documentExecutor.shutdownNow()
        settingsDialog?.dismiss()
        browser?.let { web -> (web.parent as? ViewGroup)?.removeView(web); web.stopLoading(); web.destroy() }
        browser = null
        super.onDestroy()
    }
    private fun toast(message: String) { runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() } }
    companion object { private const val FILE_PICKER = 4101 }
}
