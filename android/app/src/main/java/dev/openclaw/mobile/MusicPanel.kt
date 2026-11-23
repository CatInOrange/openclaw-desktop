package dev.openclaw.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.core.content.FileProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import java.io.File

/** App-owned controls; no credentials or privileged messages enter remote Control UI. */
internal class MusicPanel(private val activity: Activity, toolbar: LinearLayout) {
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private val handler = Handler(Looper.getMainLooper())
    private val play = ToolbarIcon.button(activity, ToolbarIcon.Kind.PLAY, "播放") { send("toggle"); if (!MusicService.state.authenticated) show() }
    private val heart = ToolbarIcon.button(activity, ToolbarIcon.Kind.HEART, "喜欢当前歌曲") { send("like") }
    private var dialog: AlertDialog? = null
    private var panelStatus: TextView? = null
    private var qr: ImageView? = null
    private var qrValue = ""
    private var bitmap: Bitmap? = null
    private val listener: (MusicService.State) -> Unit = { state -> handler.post { render(state) } }
    init {
        toolbar.addView(play)
        toolbar.addView(heart)
        toolbar.addView(ToolbarIcon.button(activity, ToolbarIcon.Kind.NEXT, "下一首") { send("next") })
        toolbar.addView(ToolbarIcon.button(activity, ToolbarIcon.Kind.EXPAND, "打开音乐面板") { show() })
        render(MusicService.state)
    }
    private fun send(action: String, phone: String = "", code: String = "") { MusicService.send(activity, action, phone, code) }
    fun resume() { MusicService.listeners.add(listener); render(MusicService.state) }
    fun pause() { MusicService.listeners.remove(listener) }
    fun destroy() { pause(); dialog?.dismiss(); dialog = null; handler.removeCallbacksAndMessages(null) }
    private fun render(state: MusicService.State) {
        play.setImageDrawable(ToolbarIcon(activity, if (state.playing) ToolbarIcon.Kind.PAUSE else ToolbarIcon.Kind.PLAY))
        play.contentDescription = if (state.playing) "暂停" else "播放"
        play.isEnabled = !state.busy; play.alpha = if (state.busy) 0.4f else 1f
        heart.setImageDrawable(ToolbarIcon(activity, ToolbarIcon.Kind.HEART, state.liked))
        heart.contentDescription = if (state.liked) "取消喜欢当前歌曲" else "喜欢当前歌曲"
        heart.isEnabled = state.id != 0L && !state.busy; heart.alpha = if (heart.isEnabled) 1f else 0.4f
        panelStatus?.text = "${state.title}${if (state.artist.isNotEmpty()) " · ${state.artist}" else ""}\n${state.message}"
        if (state.qr != qrValue) {
            qrValue = state.qr
            bitmap = if (qrValue.isEmpty()) null else runCatching {
                val matrix = MultiFormatWriter().encode(qrValue, BarcodeFormat.QR_CODE, 480, 480)
                Bitmap.createBitmap(480, 480, Bitmap.Config.ARGB_8888).apply {
                    val pixels = IntArray(480 * 480) { index -> if (matrix[index % 480, index / 480]) Color.BLACK else Color.WHITE }
                    setPixels(pixels, 0, 480, 0, 0, 480, 480)
                }
            }.getOrNull()
        }
        qr?.setImageBitmap(bitmap); qr?.visibility = if (bitmap == null) View.GONE else View.VISIBLE
    }
    private fun show() {
        if (dialog?.isShowing == true) return
        val body = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 8, 24, 8) }
        panelStatus = TextView(activity).apply { textSize = 16f }; body.addView(panelStatus)
        body.addView(TextView(activity).apply { text = "网易云心动模式 · 后台和锁屏继续播放\n通知栏可停止；从最近任务划掉本应用会停止。\n登录不会自动播放。"; textSize = 12f })
        qr = ImageView(activity).apply { contentDescription = "网易云登录二维码"; adjustViewBounds = true }; body.addView(qr, LinearLayout.LayoutParams(-1, dp(220)))
        body.addView(Button(activity).apply { text = "获取 / 刷新登录二维码"; setOnClickListener { send("login") } })
        body.addView(Button(activity).apply { text = "分享二维码（可保存后在网易云扫一扫相册中尝试）"; textSize = 12f; setOnClickListener {
            val current = bitmap ?: return@setOnClickListener
            runCatching {
                val directory = File(activity.cacheDir, "music-share").apply { mkdirs() }
                directory.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 600000 }?.forEach { it.delete() }
                val file = File(directory, "${java.util.UUID.randomUUID()}.png")
                file.outputStream().use { current.compress(Bitmap.CompressFormat.PNG, 100, it) }
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
                activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "分享登录二维码"))
            }.onFailure { Toast.makeText(activity, "无法分享二维码", Toast.LENGTH_SHORT).show() }
        } })
        body.addView(TextView(activity).apply { text = "单机登录：短信验证码（+86 中国大陆）"; textSize = 13f })
        val phone = EditText(activity).apply { hint = "手机号"; inputType = InputType.TYPE_CLASS_PHONE; setSingleLine() }
        val code = EditText(activity).apply { hint = "短信验证码"; inputType = InputType.TYPE_CLASS_NUMBER; setSingleLine(); importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO }
        body.addView(phone); body.addView(code)
        body.addView(Button(activity).apply { text = "发送验证码"; setOnClickListener {
            if (!phone.text.toString().matches(Regex("[0-9]{6,15}"))) { phone.error = "请填写手机号"; return@setOnClickListener }
            send("sms", phone.text.toString()); isEnabled = false; text = "60 秒后可重发"
            handler.postDelayed({ isEnabled = true; text = "发送验证码" }, 60000)
        } })
        body.addView(Button(activity).apply { text = "验证码登录"; setOnClickListener { send("smsLogin", phone.text.toString(), code.text.toString()); code.text.clear() } })
        body.addView(Button(activity).apply { text = "退出网易云登录"; setOnClickListener { send("logout") } })
        body.addView(Button(activity).apply { text = "停止音乐"; setOnClickListener { send("stop") } })
        dialog = AlertDialog.Builder(activity).setTitle("心动音乐").setView(ScrollView(activity).apply { addView(body) }).setPositiveButton("收起", null).create().apply {
            setOnDismissListener { panelStatus = null; qr = null; dialog = null }
            window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            show(); window?.setGravity(Gravity.BOTTOM)
        }
        render(MusicService.state)
    }
}
