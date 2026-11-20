package com.deskhead.gente

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.unit.dp

/**
 * TalkBack basics on whatever is on screen: every tappable thing has a label TalkBack can read,
 * and a touch target of at least 48 x 48 dp (Material and Play's pre-launch accessibility checks).
 */
fun ComposeTestRule.assertAccessible(screen: String) {
    val problems = mutableListOf<String>()
    fun hasLabel(n: SemanticsNode): Boolean =
        n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.isNotBlank() } ||
            n.config.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text.isNotBlank() } ||
            n.children.any(::hasLabel)
    fun walk(n: SemanticsNode) {
        val c = n.config
        val clickable = c.getOrNull(SemanticsActions.OnClick) != null
        if (clickable && c.getOrNull(SemanticsProperties.Disabled) == null && n.boundsInRoot.width > 0 && n.boundsInRoot.height > 0) {
            val label = (c.getOrNull(SemanticsProperties.ContentDescription).orEmpty() + c.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }).joinToString().trim()
            if (!hasLabel(n)) problems += "$screen: unlabeled button at ${n.boundsInRoot}"
            val d = density
            val w = with(d) { n.touchBoundsInRoot.width.toDp() }; val h = with(d) { n.touchBoundsInRoot.height.toDp() }
            if (w < 47.5.dp || h < 47.5.dp) problems += "$screen: small target ${w}x$h '$label'"
        }
        n.children.forEach(::walk)
    }
    onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes().forEach(::walk)
    if (problems.isNotEmpty()) throw AssertionError(problems.joinToString("\n"))
}
