package dev.openclaw.mobile

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import java.util.concurrent.atomic.AtomicBoolean

/** Local video only. No controls/skip targets; deadlines recover from codec errors. */
class BootVideo(context: Context, private val sound: Boolean, private val done: () -> Unit) : FrameLayout(context), TextureView.SurfaceTextureListener {
    private val texture = TextureView(context)
    private var player: MediaPlayer? = null
    private var surface: Surface? = null
    private var completed = false
    private var prepared = false
    private var foreground = true
    private val deadline = Runnable { finishVideo() }
    private val firstFrame = Runnable { finishVideo() }
    init {
        setBackgroundColor(Color.BLACK)
        isClickable = true
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        addView(texture, LayoutParams(-1, -1))
        texture.surfaceTextureListener = this
        postDelayed(deadline, 18000)
        postDelayed(firstFrame, 5000)
    }
    override fun onSurfaceTextureAvailable(value: SurfaceTexture, width: Int, height: Int) {
        if (completed) return
        try {
            surface = Surface(value)
            val media = MediaPlayer()
            player = media
            media.setSurface(surface)
            context.resources.openRawResourceFd(R.raw.boot).use { media.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            media.setVolume(if (sound) 1f else 0f, if (sound) 1f else 0f)
            media.setOnPreparedListener { prepared = true; if (foreground) it.start() }
            media.setOnInfoListener { _, what, _ ->
                if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) removeCallbacks(firstFrame)
                false
            }
            media.setOnVideoSizeChangedListener { _, w, h ->
                if (w > 0 && h > 0) {
                    val scale = maxOf(width.toFloat() / w, height.toFloat() / h)
                    texture.layoutParams = LayoutParams((w * scale).toInt(), (h * scale).toInt(), android.view.Gravity.CENTER)
                }
            }
            media.setOnCompletionListener { finishVideo() }
            media.setOnErrorListener { _, _, _ -> finishVideo(); true }
            media.prepareAsync()
        } catch (_: Exception) { finishVideo() }
    }
    fun setForeground(active: Boolean) {
        foreground = active
        if (!prepared || completed) return
        runCatching { if (active) player?.start() else player?.pause() }.onFailure { finishVideo() }
    }
    fun finishVideo() {
        if (completed) return
        completed = true
        removeCallbacks(deadline); removeCallbacks(firstFrame)
        runCatching { player?.release() }; player = null
        surface?.release(); surface = null
        visibility = View.GONE
        done()
    }
    override fun onSurfaceTextureSizeChanged(value: SurfaceTexture, width: Int, height: Int) = Unit
    override fun onSurfaceTextureUpdated(value: SurfaceTexture) = Unit
    override fun onSurfaceTextureDestroyed(value: SurfaceTexture): Boolean { finishVideo(); return true }
    companion object {
        private val played = AtomicBoolean(false)
        fun claim(): Boolean = played.compareAndSet(false, true)
    }
}
