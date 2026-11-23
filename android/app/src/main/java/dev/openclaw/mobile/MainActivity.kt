package dev.openclaw.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
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
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.widget.Switch
import android.widget.SeekBar
import org.json.JSONObject
import android.window.OnBackInvokedDispatcher
import java.util.concurrent.Executors
import java.io.File
import org.mozilla.geckoview.*

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
    private var bootVideo: BootVideo? = null
    private var foregroundActive = false
    private var wallpaperStatus = "等待页面扩展连接"
    private val appearance by lazy { getSharedPreferences("appearance", MODE_PRIVATE) }
    private var browser: GeckoView? = null
    private var session: GeckoSession? = null
    private var canGoBack = false
    @Volatile private var gateway: GatewayPolicy.Address? = null
    private var lastInternalUrl: String? = null
    private var mainFrameFailed = false
    private var settingsDialog: AlertDialog? = null
    private var pendingFile: GeckoSession.PromptDelegate.FilePrompt? = null
    private var pendingResult: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? = null
    private val documentExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (java.io.File(filesDir, "last-crash.txt").exists()) {
            startActivity(Intent(this, DiagnosticsActivity::class.java))
            finish()
            return
        }
        File(cacheDir, "attachments").listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24L * 60 * 60 * 1000 }?.forEach { it.delete() }
        createNativeUi()
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { navigateBack() }
        }
        if (BootVideo.claim() && appearance.getBoolean("boot", true)) {
            val container = FrameLayout(this)
            (root.parent as ViewGroup).removeView(root)
            container.addView(root, FrameLayout.LayoutParams(-1, -1))
            val clip = BootVideo(this, appearance.getBoolean("sound", true)) {
                bootVideo = null
                session?.setActive(foregroundActive)
                if (browser == null) showSettings()
            }
            bootVideo = clip
            container.addView(clip, FrameLayout.LayoutParams(-1, -1))
            setContentView(container)
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
        // Obtain the controller from the attached view, not PhoneWindow before
        // setContentView: some Android 12 implementations dereference a null decor.
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
                view.removeOnAttachStateChangeListener(this)
                if (Build.VERSION.SDK_INT >= 30) {
                    view.windowInsetsController?.setSystemBarsAppearance(
                        if (night()) 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    )
                }
                view.requestApplyInsets()
            }
            override fun onViewDetachedFromWindow(view: View) = Unit
        })
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
            session?.stop()
            showStatus("跳转已阻止", "页面尝试离开当前 Gateway。请通过设置明确切换服务器。")
            return
        }
        cancelFilePrompt()

        lastInternalUrl = url
        mainFrameFailed = false
        overlay.visibility = View.GONE
        browser?.visibility = View.VISIBLE
        progress.visibility = View.VISIBLE
    }

    private fun cancelFilePrompt() {
        val prompt = pendingFile
        pendingFile = null
        val result = pendingResult
        pendingResult = null
        if (prompt != null && result != null) runCatching { result.complete(prompt.dismiss()) }
    }

    private fun connect(address: GatewayPolicy.Address, savedState: Bundle? = null) {
        gateway = address
        subtitle.text = "${address.host} · Gecko 160"
        val runtime = GeckoProfile.prepare(this, address.origin)
        val web = GeckoView(this).apply { setViewBackend(GeckoView.BACKEND_TEXTURE_VIEW) }
        browser = web
        val gecko = GeckoSession()
        session = gecko
        gecko.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> {
                val current = gateway ?: return GeckoResult.fromValue(AllowOrDeny.DENY)
                return when (GatewayPolicy.navigation(request.uri, current.url)) {
                    GatewayPolicy.Navigation.INTERNAL -> GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    GatewayPolicy.Navigation.EXTERNAL -> {
                        if (request.hasUserGesture) openExternal(request.uri)
                        else showStatus("跳转已阻止", "页面尝试离开当前 Gateway。切换服务器请使用设置。")
                        GeckoResult.fromValue(AllowOrDeny.DENY)
                    }
                    GatewayPolicy.Navigation.BLOCKED -> GeckoResult.fromValue(AllowOrDeny.DENY)
                }
            }
            override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
                // No unmanaged popup sessions or native bridge for remote pages.
                return null
            }
            override fun onCanGoBack(session: GeckoSession, value: Boolean) { canGoBack = value }
                        override fun onLoadError(session: GeckoSession, uri: String?, error: WebRequestError): GeckoResult<String>? {
                showStatus("无法加载 Gateway", "请检查网络、地址和 HTTPS 证书后重试。（错误 ${error.code}）")
                return null
            }
        }
        gecko.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) { beginPage(url) }
            override fun onPageStop(session: GeckoSession, success: Boolean) {
                progress.visibility = View.GONE
                if (!success && !mainFrameFailed) showStatus("页面加载失败", "请检查网络与服务器后重试。")
            }
            override fun onProgressChange(session: GeckoSession, value: Int) {
                progress.progress = value
                if (!mainFrameFailed) progress.visibility = if (value < 100) View.VISIBLE else View.GONE
            }
        }
        gecko.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onCrash(session: GeckoSession) { showStatus("网页进程已退出", "请关闭应用后重新打开，登录数据保留。", false) }
            override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
                if (GatewayPolicy.safeExternal(response.uri)) AlertDialog.Builder(this@MainActivity)
                    .setTitle("在系统浏览器下载？").setMessage("浏览器使用独立登录，可能需要重新登录。")
                    .setPositiveButton("打开") { _, _ -> openExternal(response.uri) }.setNegativeButton("取消", null).show()
            }
        }
        gecko.permissionDelegate = object : GeckoSession.PermissionDelegate {
            override fun onContentPermissionRequest(session: GeckoSession, perm: GeckoSession.PermissionDelegate.ContentPermission): GeckoResult<Int> {
                // Blanket DENY also blocks the bundled, muted wallpaper video.
                val current = gateway
                val silentGatewayVideo = current != null &&
                    perm.permission == GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE &&
                    GatewayPolicy.sameOrigin(perm.uri, current.url)
                return GeckoResult.fromValue(if (silentGatewayVideo)
                    GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW
                else GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
            }
        }
        gecko.promptDelegate = object : GeckoSession.PromptDelegate {
            override fun onFilePrompt(session: GeckoSession, prompt: GeckoSession.PromptDelegate.FilePrompt): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
                cancelFilePrompt()
                if (mainFrameFailed || prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.FOLDER) return GeckoResult.fromValue(prompt.dismiss())
                val types = prompt.mimeTypes.orEmpty().flatMap { it.split(',') }.map { it.trim() }
                    .filter { it.matches(Regex("^[a-zA-Z0-9!#$&^_.+*-]+/[a-zA-Z0-9!#$&^_.+*-]+$")) }.distinct().take(12)
                val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (types.size == 1) types[0] else "*/*"
                    if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.MULTIPLE)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                pendingFile = prompt; pendingResult = result
                try { startActivityForResult(picker, FILE_PICKER) }
                catch (_: ActivityNotFoundException) { cancelFilePrompt(); toast("未找到系统文件选择器") }
                return result
            }
        }
        gecko.open(runtime)
        web.setSession(gecko)
        content.addView(web, 0, FrameLayout.LayoutParams(-1, -1))
        // Cookies/localStorage live in the engine profile, not this activity Bundle.
        val target = savedState?.getString("pageUrl")?.takeIf { GatewayPolicy.sameOrigin(it, address.url) } ?: address.url
        // Install before navigation so the very first page gets isolated styling.
        runtime.webExtensionController.ensureBuiltIn("resource://android/assets/appearance/", "appearance@openclaw.mobile").accept({ extension ->
            runOnUiThread {
            if (!isDestroyed && !isFinishing && extension != null) {
                gecko.webExtensionController.setMessageDelegate(extension, object : WebExtension.MessageDelegate {
                    override fun onMessage(nativeApp: String, message: Any, sender: WebExtension.MessageSender): GeckoResult<Any>? {
                        val current = gateway ?: return GeckoResult.fromValue<Any>(JSONObject().put("allowed", false).toString())
                        val allowed = nativeApp == "appearance" && sender.session === gecko && sender.isTopLevel &&
                            sender.environmentType == WebExtension.MessageSender.ENV_TYPE_CONTENT_SCRIPT &&
                            GatewayPolicy.sameOrigin(sender.url, current.url) &&
                            (message as? JSONObject)?.optString("type") == "settings"
                        if (allowed) {
                            val report = (message as? JSONObject)?.optJSONObject("status")
                            wallpaperStatus = if (report == null) "扩展已连接" else
                                "${report.optString("state").take(40)} · ${report.optString("error").take(40)} · ready=${report.optInt("ready")} · ${report.optInt("time")}s"
                        }
                        val response = JSONObject().put("allowed", allowed)
                        if (allowed) response.put("enabled", appearance.getBoolean("background", true))
                            .put("active", foregroundActive && bootVideo == null && !mainFrameFailed)
                            .put("strength", appearance.getInt("strength", 60).coerceIn(0, 100))
                            .put("glassTransparency", appearance.getInt("glass", 78).coerceIn(0, 100))
                        // EventDispatcher supports primitives/GeckoBundle, not JSONObject responses.
                        return GeckoResult.fromValue<Any>(response.toString())
                    }
                }, "appearance")
                // Upgrade existing profiles too: Gecko persists a previous DENY.
                // Do not clear cookies, login state, or unrelated permissions.
                runtime.storageController.getPermissions(address.url, false).accept({ permissions ->
                    permissions?.filter {
                        it.permission == GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE &&
                            GatewayPolicy.sameOrigin(it.uri, address.url)
                    }?.forEach {
                        runtime.storageController.setPermission(it, GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW)
                    }
                    runOnUiThread { if (!isDestroyed && !isFinishing) gecko.loadUri(target) }
                }, { _ ->
                    runOnUiThread { if (!isDestroyed && !isFinishing) gecko.loadUri(target) }
                })
            }
            }
        }, { _ ->
            wallpaperStatus = "扩展安装失败"
            runOnUiThread {
                if (!isDestroyed && !isFinishing) { toast("外观加载失败，已恢复原版界面"); gecko.loadUri(target) }
            }
        })
    }

    private fun retry() {
        val address = gateway ?: return showSettings()
        val target = lastInternalUrl?.takeIf { GatewayPolicy.sameOrigin(it, address.url) } ?: address.url
        session?.loadUri(target)
    }

    private fun openExternal(url: String) {
        if (!GatewayPolicy.safeExternal(url)) return toast("不支持此类型的链接")
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (_: ActivityNotFoundException) { toast("未找到可打开链接的浏览器") }
    }

    private fun showSettings() {
        if (bootVideo != null) return
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
        body.addView(Button(this).apply { text = "视频与外观"; setOnClickListener { showAppearance() } })
        body.addView(Button(this).apply { text = "检查应用更新 · ${BuildConfig.VERSION_NAME}"; setOnClickListener { startActivity(Intent(this@MainActivity, UpdateActivity::class.java)) } })
        val dialog = AlertDialog.Builder(this).setTitle("连接设置").setView(body).setPositiveButton("连接", null).setNegativeButton("取消", null).create()
        settingsDialog = dialog
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val address = try { GatewayPolicy.normalize(input.text.toString()) } catch (error: IllegalArgumentException) { input.error = error.message; return@setOnClickListener }
                val apply = applyConnection@ {
                    if (GeckoProfile.isDifferent(address.origin)) confirmProfileSwitch(address, dialog)
                    else {
                        if (!preferences.edit().putString("gateway", address.url).commit()) {
                            toast("连接设置保存失败，请重试")
                            return@applyConnection
                        }
                        dialog.dismiss()
                        if (browser == null) connect(address)
                        else { gateway = address; subtitle.text = address.host; lastInternalUrl = address.url; session?.loadUri(address.url) }
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

    private fun showAppearance() {
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(8), dp(24), dp(8)) }
        fun toggle(key: String, title: String) {
            body.addView(Switch(this).apply {
                text = title; isChecked = appearance.getBoolean(key, true)
                setPadding(0, dp(10), 0, dp(10))
                setOnCheckedChangeListener { _, checked -> appearance.edit().putBoolean(key, checked).apply() }
            })
        }
        fun slider(key: String, title: String, fallback: Int) {
            val label = text("$title · ${appearance.getInt(key, fallback)}%", 14f)
            body.addView(label)
            body.addView(SeekBar(this).apply {
                max = 100; progress = appearance.getInt(key, fallback)
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(bar: SeekBar, value: Int, user: Boolean) {
                        label.text = "$title · $value%"
                        if (user) appearance.edit().putInt(key, value).apply()
                    }
                    override fun onStartTrackingTouch(bar: SeekBar) = Unit
                    override fun onStopTrackingTouch(bar: SeekBar) = Unit
                })
            })
        }
        toggle("boot", "开机动画（下次启动生效）")
        toggle("sound", "开机声音（背景始终静音）")
        toggle("background", "动态背景")
        slider("strength", "背景强度", 60)
        slider("glass", "毛玻璃透明度", 78)
        val diagnostic = text("动态背景状态：$wallpaperStatus", 12f)
        body.addView(diagnostic)
        body.addView(Button(this).apply {
            text = "刷新背景状态"
            setOnClickListener { diagnostic.text = "动态背景状态：$wallpaperStatus" }
        })
        AlertDialog.Builder(this).setTitle("视频与外观").setView(body).setPositiveButton("完成", null).show()
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

                settings.dismiss()
                cancelFilePrompt()
                session?.stop()
                finishAndRemoveTask()
                val self = Process.myPid()
                Handler(Looper.getMainLooper()).postDelayed({ Process.killProcess(self) }, 200)
            }.setNegativeButton("取消", null).show()
    }

    @Deprecated("Uses platform Activity result API to avoid a full UI framework dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != FILE_PICKER) return
        val prompt = pendingFile ?: return
        val result = pendingResult ?: return
        if (resultCode != RESULT_OK) { cancelFilePrompt(); return }
        val candidates = buildList<Uri> {
            data?.clipData?.let { clip -> for (i in 0 until minOf(clip.itemCount, 10)) add(clip.getItemAt(i).uri) }
            data?.data?.let { add(it) }
        }.distinct().take(if (prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.SINGLE) 1 else 10)
        documentExecutor.execute {
            val copied = runCatching {
                val directory = File(cacheDir, "attachments").apply { mkdirs() }
                candidates.map { uri ->
                    require(uri.scheme == "content")
                    val name = contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    }?.replace(Regex("[^\\p{L}\\p{N}._-]"), "_")?.take(100) ?: "attachment"
                    val file = File(directory, "${java.util.UUID.randomUUID()}-$name")
                    try {
                        contentResolver.openInputStream(uri)!!.use { input -> file.outputStream().use { output ->
                            val buffer = ByteArray(65536); var size = 0L
                            while (true) { val n = input.read(buffer); if (n < 0) break; size += n; require(size <= 25L * 1024 * 1024) { "附件超过 25 MB" }; output.write(buffer, 0, n) }
                        } }
                    } catch (error: Exception) { file.delete(); throw error }
                    Uri.fromFile(file)
                }
            }
            runOnUiThread {
                if (pendingFile !== prompt) return@runOnUiThread
                pendingFile = null; pendingResult = null
                if (isFinishing || isDestroyed || copied.isFailure || copied.getOrNull().isNullOrEmpty()) {
                    result.complete(prompt.dismiss()); if (copied.isFailure) toast("无法读取附件，单个文件上限 25 MB")
                } else runCatching { result.complete(prompt.confirm(this, copied.getOrThrow().toTypedArray())) }
                    .onFailure { result.completeExceptionally(it) }
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::root.isInitialized) root.requestApplyInsets()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("pageUrl", lastInternalUrl)
        super.onSaveInstanceState(outState)
    }
    override fun onPause() { foregroundActive = false; bootVideo?.setForeground(false); session?.setActive(false); super.onPause() }
    override fun onResume() { super.onResume(); foregroundActive = true; bootVideo?.setForeground(true); session?.setActive(bootVideo == null) }
    @Deprecated("Platform back navigation retains browser history")
    override fun onBackPressed() { navigateBack() }
    private fun navigateBack() { if (bootVideo != null) return; if (canGoBack) session?.goBack() else finish() }
    override fun onDestroy() {
        foregroundActive = false
        bootVideo?.finishVideo()
        cancelFilePrompt()
        documentExecutor.shutdown()
        settingsDialog?.dismiss()
        browser?.releaseSession()
        session?.close()
        session = null; browser = null
        super.onDestroy()
    }
    private fun toast(message: String) { runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() } }
    companion object { private const val FILE_PICKER = 4101 }
}
