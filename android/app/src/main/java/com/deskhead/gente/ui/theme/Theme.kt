package com.deskhead.gente.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.deskhead.gente.R

/** Brand tokens, copied from packages/ui-tokens/src/tokens.css so desktop, iOS and Android match. */
object GenteColors {
    // light
    val LightBackground = Color(0xFFFBF6EC)
    val LightDialog = Color(0xFFFFFFFF)
    val LightForeground = Color(0xFF1C1710)
    val LightCard = Color(0xFFF4ECDD)
    val LightPrimary = Color(0xFFE8951A) // marigold
    val LightOnPrimary = Color(0xFF1C1206)
    val LightChatUser = Color(0xFF1C1710)
    val LightOnChatUser = Color(0xFFFFFFFF)
    val LightMuted = Color(0xAD1C1710)
    val LightBorder = Color(0x1F1C1710)
    val LightDestructive = Color(0xFFC32A1F)
    val LightSuccess = Color(0xFF00783F)
    val LightLink = Color(0xFF94530A)

    // dark
    val DarkBackground = Color(0xFF14110D)
    val DarkDialog = Color(0xFF1C1813)
    val DarkForeground = Color(0xFFF7F0E4)
    val DarkCard = Color(0xFF231E17)
    val DarkPrimary = Color(0xFFF5A524)
    val DarkOnPrimary = Color(0xFF1A1206)
    val DarkChatUser = Color(0xFF3A2D18)
    val DarkOnChatUser = Color(0xFFF7F0E4)
    val DarkMuted = Color(0xA8F7F0E4)
    val DarkBorder = Color(0x1AF7F0E4)
    val DarkDestructive = Color(0xFFFF6B5E)
    val DarkSuccess = Color(0xFF3DBE7A)
    val DarkLink = Color(0xFFF7B955)

    val Ink = Color(0xFF1C1914) // the mark's dots
}

@Immutable
data class GenteExtras(
    val chatUser: Color,
    val onChatUser: Color,
    val muted: Color,
    val border: Color,
    val success: Color,
    val link: Color,
    val markInk: Color,
)

val LocalGenteExtras = staticCompositionLocalOf {
    GenteExtras(
        GenteColors.LightChatUser, GenteColors.LightOnChatUser, GenteColors.LightMuted,
        GenteColors.LightBorder, GenteColors.LightSuccess, GenteColors.LightLink, GenteColors.Ink,
    )
}

private val LightScheme = lightColorScheme(
    primary = GenteColors.LightPrimary,
    onPrimary = GenteColors.LightOnPrimary,
    primaryContainer = Color(0xFFFBE3BD),
    onPrimaryContainer = GenteColors.LightForeground,
    secondary = GenteColors.LightForeground,
    onSecondary = GenteColors.LightBackground,
    secondaryContainer = GenteColors.LightCard,
    onSecondaryContainer = GenteColors.LightForeground,
    background = GenteColors.LightBackground,
    onBackground = GenteColors.LightForeground,
    surface = GenteColors.LightBackground,
    onSurface = GenteColors.LightForeground,
    surfaceVariant = GenteColors.LightCard,
    onSurfaceVariant = GenteColors.LightMuted,
    surfaceContainerLowest = GenteColors.LightDialog,
    surfaceContainerLow = Color(0xFFF8F1E4),
    surfaceContainer = GenteColors.LightCard,
    surfaceContainerHigh = Color(0xFFEFE5D3),
    surfaceContainerHighest = Color(0xFFE9DEC9),
    outline = Color(0x521C1710),
    outlineVariant = GenteColors.LightBorder,
    error = GenteColors.LightDestructive,
    onError = Color.White,
)

private val DarkScheme = darkColorScheme(
    primary = GenteColors.DarkPrimary,
    onPrimary = GenteColors.DarkOnPrimary,
    primaryContainer = Color(0xFF4A3412),
    onPrimaryContainer = GenteColors.DarkForeground,
    secondary = GenteColors.DarkForeground,
    onSecondary = GenteColors.DarkBackground,
    secondaryContainer = GenteColors.DarkCard,
    onSecondaryContainer = GenteColors.DarkForeground,
    background = GenteColors.DarkBackground,
    onBackground = GenteColors.DarkForeground,
    surface = GenteColors.DarkBackground,
    onSurface = GenteColors.DarkForeground,
    surfaceVariant = GenteColors.DarkCard,
    onSurfaceVariant = GenteColors.DarkMuted,
    surfaceContainerLowest = Color(0xFF100D0A),
    surfaceContainerLow = GenteColors.DarkDialog,
    surfaceContainer = GenteColors.DarkCard,
    surfaceContainerHigh = Color(0xFF2A241C),
    surfaceContainerHighest = Color(0xFF332C22),
    outline = Color(0x52F7F0E4),
    outlineVariant = GenteColors.DarkBorder,
    error = GenteColors.DarkDestructive,
    onError = Color.White,
)

val Rounded = FontFamily(
    Font(R.font.nunito, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
    Font(R.font.nunito, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.nunito, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
    Font(R.font.nunito, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(700))),
    Font(R.font.nunito, FontWeight.ExtraBold, variationSettings = FontVariation.Settings(FontVariation.weight(800))),
)

private fun Typography.rounded(): Typography {
    fun TextStyle.r() = copy(fontFamily = Rounded)
    return copy(
        displayLarge = displayLarge.r(), displayMedium = displayMedium.r(), displaySmall = displaySmall.r(),
        headlineLarge = headlineLarge.r().copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp),
        headlineMedium = headlineMedium.r().copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.3).sp),
        headlineSmall = headlineSmall.r().copy(fontWeight = FontWeight.Bold),
        titleLarge = titleLarge.r().copy(fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.r().copy(fontWeight = FontWeight.Bold),
        titleSmall = titleSmall.r().copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = bodyLarge.r().copy(fontSize = 17.sp, lineHeight = 25.sp),
        bodyMedium = bodyMedium.r().copy(fontSize = 15.sp, lineHeight = 21.sp),
        bodySmall = bodySmall.r(),
        labelLarge = labelLarge.r().copy(fontWeight = FontWeight.Bold),
        labelMedium = labelMedium.r().copy(fontWeight = FontWeight.SemiBold),
        labelSmall = labelSmall.r().copy(fontWeight = FontWeight.SemiBold),
    )
}

val GenteShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun GenteTheme(
    dark: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false, // brand colors by default
    content: @Composable () -> Unit,
) {
    val ctx = LocalContext.current
    val scheme: ColorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> DarkScheme
        else -> LightScheme
    }
    val extras = if (dark) GenteExtras(
        GenteColors.DarkChatUser, GenteColors.DarkOnChatUser, GenteColors.DarkMuted,
        GenteColors.DarkBorder, GenteColors.DarkSuccess, GenteColors.DarkLink, GenteColors.DarkForeground,
    ) else GenteExtras(
        GenteColors.LightChatUser, GenteColors.LightOnChatUser, GenteColors.LightMuted,
        GenteColors.LightBorder, GenteColors.LightSuccess, GenteColors.LightLink, GenteColors.Ink,
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalGenteExtras provides extras) {
        MaterialExpressiveTheme(
            colorScheme = scheme,
            typography = Typography().rounded(),
            shapes = GenteShapes,
            motionScheme = MotionScheme.expressive(),
            content = content,
        )
    }
}
