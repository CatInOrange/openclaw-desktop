package dev.openclaw.mobile

import android.content.Context
import android.content.res.Configuration
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.RippleDrawable
import android.widget.ImageButton
import android.widget.LinearLayout

/** Small vector glyphs with invisible 48dp touch targets; no platform button chrome. */
internal class ToolbarIcon(context: Context, private val kind: Kind, private val selected: Boolean = false) : Drawable() {
    enum class Kind { PLAY, PAUSE, HEART, NEXT, EXPAND, SETTINGS }
    private val dark = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = if (selected) Color.rgb(239, 96, 116) else if (dark) Color.rgb(225, 232, 237) else Color.rgb(44, 57, 67)
        strokeWidth = 1.8f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    override fun draw(canvas: Canvas) {
        val save = canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        paint.style = Paint.Style.STROKE
        when (kind) {
            Kind.PLAY -> { paint.style = Paint.Style.FILL; canvas.drawPath(Path().apply { moveTo(8f, 5f); lineTo(19f, 12f); lineTo(8f, 19f); close() }, paint) }
            Kind.PAUSE -> { paint.style = Paint.Style.FILL; canvas.drawRoundRect(6f, 5f, 10f, 19f, 0.7f, 0.7f, paint); canvas.drawRoundRect(14f, 5f, 18f, 19f, 0.7f, 0.7f, paint) }
            Kind.NEXT -> { paint.style = Paint.Style.FILL; canvas.drawPath(Path().apply { moveTo(5f, 5f); lineTo(16f, 12f); lineTo(5f, 19f); close() }, paint); canvas.drawRoundRect(17f, 5f, 20f, 19f, 0.6f, 0.6f, paint) }
            Kind.HEART -> {
                paint.style = if (selected) Paint.Style.FILL else Paint.Style.STROKE
                canvas.drawPath(Path().apply { moveTo(12f, 20f); cubicTo(9f, 17f, 3f, 13f, 3f, 8f); cubicTo(3f, 3f, 9f, 2f, 12f, 7f); cubicTo(15f, 2f, 21f, 3f, 21f, 8f); cubicTo(21f, 13f, 15f, 17f, 12f, 20f); close() }, paint)
            }
            Kind.EXPAND -> { canvas.drawPath(Path().apply { moveTo(6f, 9f); lineTo(12f, 15f); lineTo(18f, 9f) }, paint) }
            Kind.SETTINGS -> {
                canvas.drawCircle(12f, 12f, 6.5f, paint); canvas.drawCircle(12f, 12f, 2.2f, paint)
                repeat(8) { canvas.save(); canvas.rotate(it * 45f, 12f, 12f); canvas.drawLine(12f, 3f, 12f, 5.5f, paint); canvas.restore() }
            }
        }
        canvas.restoreToCount(save)
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter; invalidateSelf() }
    @Deprecated("Drawable opacity") override fun getOpacity() = PixelFormat.TRANSLUCENT
    companion object {
        fun button(context: Context, kind: Kind, label: String, click: () -> Unit): ImageButton {
            fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
            return ImageButton(context).apply {
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
                setPadding(dp(13), dp(13), dp(13), dp(13))
                setImageDrawable(ToolbarIcon(context, kind)); contentDescription = label
                // Transparent at rest; a bounded ripple provides touch feedback only.
                background = RippleDrawable(ColorStateList.valueOf(0x24808080), null, android.graphics.drawable.ColorDrawable(Color.WHITE))
                setOnClickListener { click() }
                tooltipText = label
            }
        }
    }
}
