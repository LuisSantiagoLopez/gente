package com.deskhead.gente.ui.components

import androidx.annotation.StringRes
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.deskhead.gente.R
import com.deskhead.gente.agent.Ran
import com.deskhead.gente.ui.theme.GenteColors
import com.deskhead.gente.ui.theme.LocalGenteExtras
import kotlin.math.max
import kotlin.math.sin

/** The hand-drawn dots-in-a-circle mark, from brand/gente-mark.svg (24x24). */
private val MARK_PATHS = listOf(
    "M14.13 3.09 Q14.27 3.92 13.83 4.69 Q13.39 5.45 12.51 6.08 Q11.62 6.70 10.93 6.44 Q10.25 6.18 9.81 5.35 Q9.38 4.52 9.51 3.43 Q9.64 2.34 10.16 1.86 Q10.69 1.37 11.67 1.23 Q12.65 1.08 13.32 1.68 Q13.99 2.27 14.13 3.09 Z",
    "M20.15 5.87 Q20.26 6.40 19.71 7.27 Q19.17 8.14 18.72 8.26 Q18.28 8.39 17.49 8.12 Q16.71 7.84 16.34 7.16 Q15.98 6.47 15.90 5.78 Q15.82 5.08 16.62 4.60 Q17.43 4.12 17.99 4.13 Q18.56 4.13 19.30 4.74 Q20.04 5.34 20.15 5.87 Z",
    "M22.31 11.03 Q22.28 11.71 21.89 12.43 Q21.51 13.14 20.93 13.35 Q20.34 13.56 19.47 13.43 Q18.61 13.30 18.46 12.65 Q18.32 12.00 18.27 11.34 Q18.22 10.68 18.82 10.05 Q19.43 9.41 20.10 9.45 Q20.76 9.48 21.55 9.91 Q22.34 10.34 22.31 11.03 Z",
    "M19.54 16.86 Q19.93 17.55 19.60 18.31 Q19.27 19.07 18.36 19.44 Q17.45 19.80 16.95 19.49 Q16.45 19.17 16.08 18.59 Q15.72 18.00 15.83 17.10 Q15.95 16.21 16.21 15.72 Q16.46 15.23 17.24 15.27 Q18.01 15.32 18.58 15.74 Q19.15 16.17 19.54 16.86 Z",
    "M14.45 19.91 Q14.54 20.47 14.11 21.29 Q13.67 22.12 13.24 22.33 Q12.80 22.53 12.06 22.16 Q11.32 21.79 10.92 21.18 Q10.53 20.57 10.47 19.83 Q10.41 19.09 11.15 18.78 Q11.89 18.48 12.35 18.38 Q12.81 18.28 13.59 18.82 Q14.37 19.35 14.45 19.91 Z",
    "M8.20 16.81 Q8.45 17.54 7.88 18.19 Q7.30 18.85 6.73 19.14 Q6.15 19.43 5.34 19.20 Q4.53 18.97 4.35 18.39 Q4.17 17.80 4.13 17.10 Q4.10 16.40 4.66 15.95 Q5.22 15.50 6.06 15.52 Q6.89 15.54 7.43 15.81 Q7.96 16.08 8.20 16.81 Z",
    "M5.77 11.54 Q6.13 12.23 5.91 12.95 Q5.69 13.67 4.80 13.81 Q3.90 13.96 3.44 13.84 Q2.97 13.72 2.52 12.93 Q2.08 12.14 2.13 11.75 Q2.18 11.35 2.84 10.67 Q3.50 9.98 4.13 10.12 Q4.76 10.25 5.08 10.55 Q5.40 10.85 5.77 11.54 Z",
    "M8.11 5.73 Q8.18 6.31 7.86 7.09 Q7.54 7.88 7.11 8.17 Q6.68 8.46 5.80 8.22 Q4.93 7.99 4.68 7.21 Q4.43 6.44 4.40 5.66 Q4.36 4.87 4.96 4.46 Q5.55 4.05 6.27 4.21 Q7.00 4.37 7.53 4.76 Q8.05 5.15 8.11 5.73 Z",
)
private val MARK_CENTERS = listOf(
    Offset(11.8f, 3.8f), Offset(18.0f, 6.2f), Offset(20.3f, 11.4f), Offset(17.6f, 17.4f),
    Offset(12.4f, 20.4f), Offset(6.1f, 17.3f), Offset(4.1f, 12.0f), Offset(6.2f, 6.2f),
)

/** True when the person turned animations off (Settings, Accessibility, Remove animations). */
@Composable
fun reduceMotion(): Boolean {
    val cr = androidx.compose.ui.platform.LocalContext.current.contentResolver
    return remember { android.provider.Settings.Global.getFloat(cr, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/**
 * Gente's mark. When [thinking], the dots breathe one after another around the circle,
 * like people taking turns. Flat colors, no gradients.
 */
@Composable
fun GenteMark(modifier: Modifier = Modifier, size: Dp = 28.dp, thinking: Boolean = false, ink: Color = LocalGenteExtras.current.markInk) {
    val paths: List<Path> = remember { MARK_PATHS.map { PathParser().parsePathString(it).toPath() } }
    val animate = thinking && !reduceMotion()
    val t = if (animate) {
        val inf = rememberInfiniteTransition(label = "mark")
        inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "phase").value
    } else 0f
    Canvas(modifier.size(size).semantics { contentDescription = "Gente" }) {
        val s = this.size.minDimension / 24f
        scale(s, s, pivot = Offset.Zero) {
            paths.forEachIndexed { i, p ->
                val c = MARK_CENTERS[i]
                val wave = if (animate) (sin(((t - i / 8f) * 2 * Math.PI)).toFloat() * 0.5f + 0.5f) else 0f
                val k = 1f + wave * 0.22f
                translate(c.x * (1 - k), c.y * (1 - k)) {
                    scale(k, k, pivot = Offset.Zero) {
                        drawPath(p, if (i == 0) GenteColors.LightPrimary else ink.copy(alpha = if (thinking) 0.55f + wave * 0.45f else 1f))
                    }
                }
            }
        }
    }
}

/**
 * Streaming text that reveals smoothly. New characters glide in with a short fade at the tail
 * instead of popping, at a speed that catches up when the network sends a big chunk.
 */
@Composable
fun StreamingText(text: String, streaming: Boolean, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    var shown by remember { mutableIntStateOf(if (streaming) 0 else text.length) }
    LaunchedEffect(text, streaming) {
        if (!streaming && shown == 0) shown = text.length
        while (shown < text.length) {
            withFrameNanos { }
            val gap = text.length - shown
            shown = (shown + max(1, gap / 6)).coerceAtMost(text.length)
        }
        if (shown > text.length) shown = text.length
    }
    val fade = 18
    val solid = (shown - fade).coerceAtLeast(0)
    val annotated = remember(text, shown, color) {
        buildAnnotatedString {
            append(text.substring(0, solid))
            for (i in solid until shown.coerceAtMost(text.length)) {
                val a = 1f - (i - solid + 1).toFloat() / (fade + 1)
                withStyle(SpanStyle(color = color.copy(alpha = 0.25f + 0.75f * a))) { append(text[i]) }
            }
        }
    }
    Text(annotated, style = style, color = color, modifier = modifier)
}

/** "Answered on our servers, not stored" and friends. */
@Composable
fun PrivacyBadge(ranOn: String?, modifier: Modifier = Modifier) {
    val (icon, res) = when (ranOn) {
        Ran.DESKTOP -> Icons.Outlined.Computer to R.string.badge_desktop
        Ran.DEMO -> Icons.Outlined.PhoneAndroid to R.string.badge_demo
        Ran.CLOUD_PREVIEW -> Icons.Outlined.Cloud to R.string.badge_cloud_preview
        "phone" -> Icons.Outlined.PhoneAndroid to R.string.badge_phone
        else -> Icons.Outlined.Cloud to R.string.badge_cloud
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Lock, null, Modifier.size(12.dp), tint = LocalGenteExtras.current.muted)
        Spacer(Modifier.width(3.dp))
        Icon(icon, null, Modifier.size(13.dp), tint = LocalGenteExtras.current.muted)
        Spacer(Modifier.width(6.dp))
        Text(stringResource(res), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
    }
}

@Composable
fun Pill(text: String, modifier: Modifier = Modifier, container: Color = MaterialTheme.colorScheme.surfaceContainer, content: Color = MaterialTheme.colorScheme.onSurface) {
    Surface(modifier, shape = CircleShape, color = container, contentColor = content) {
        Text(text, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium)
    }
}

/** A short hand-drawn underline under a word. The 10% hand-made touch. */
@Composable
fun Squiggle(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary) {
    val p = if (reduceMotion()) 0.5f else {
        val inf = rememberInfiniteTransition(label = "sq")
        inf.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "p").value
    }
    Canvas(modifier) {
        val w = size.width; val h = size.height
        val path = Path().apply {
            moveTo(0f, h * 0.6f)
            cubicTo(w * 0.25f, h * (0.2f + p * 0.1f), w * 0.5f, h * 0.95f, w * 0.75f, h * 0.45f)
            quadraticTo(w * 0.9f, h * 0.2f, w, h * 0.5f)
        }
        drawPath(path, color, style = androidx.compose.ui.graphics.drawscope.Stroke(width = h * 0.28f, cap = androidx.compose.ui.graphics.StrokeCap.Round))
    }
}

object ErrorText {
    @StringRes
    fun of(code: String): Int = when (code) {
        "offline" -> R.string.err_offline
        "missing_token", "invalid_token" -> R.string.err_sign_in
        "out_of_credit" -> R.string.err_no_credit
        "rate_limited", "too_many_sessions" -> R.string.err_busy
        "relay_not_ready", "relay_failed", "desktop_timeout" -> R.string.err_relay
        "no_desktop" -> R.string.err_no_desktop
        "bad_qr" -> R.string.err_bad_qr
        "stt_unavailable", "stt_failed" -> R.string.err_stt
        "billing_unavailable", "billing_failed" -> R.string.err_billing
        "server", "billing_not_configured" -> R.string.err_server
        else -> R.string.err_generic
    }
}
