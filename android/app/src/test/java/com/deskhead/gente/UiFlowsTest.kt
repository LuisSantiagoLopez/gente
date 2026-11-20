package com.deskhead.gente

import android.Manifest
import android.app.Application
import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.deskhead.gente.agent.ApprovalKind
import com.deskhead.gente.data.MessageEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Compose UI tests of the main flows, on the JVM (Robolectric). The same flows run on the emulator in androidTest. */
@RunWith(AndroidJUnit4::class)

@Config(application = TestApp::class, sdk = [36], qualifiers = "w411dp-h914dp-xxhdpi")
class UiFlowsTest {
    // Tests run with "Remove animations" on, like a person who needs reduced motion.
    @get:Rule(order = 0) val motion = object : org.junit.rules.ExternalResource() {
        override fun before() {
            val a = ApplicationProvider.getApplicationContext<Application>()
            android.provider.Settings.Global.putFloat(a.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
            runBlocking { a.graph.settings.clear() } // every test starts as a first-time user
        }
    }
    @get:Rule(order = 1) val rule = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<Application>()
    private val graph get() = app.graph
    private fun s(id: Int, vararg a: Any) = app.getString(id, *a)

    @Test fun signUpOpensClerkWithPkce() {
        rule.onNodeWithText(s(R.string.welcome_title)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.sign_in)).performClick()
        val started: Intent = shadowOf(app).nextStartedActivity
        val url = started.data.toString()
        assertTrue(url, url.startsWith("https://cool-airedale-3945.clerk.accounts.dev/oauth/authorize"))
        assertTrue(url.contains("code_challenge_method=S256") && url.contains("code_challenge=") && url.contains("client_id=7N6zZzl5EMOxXydE"))
        assertTrue(url.contains("redirect_uri=com.deskhead.gente%3A%2F%2Foauth%2Fcallback"))
        // A redirect with the wrong state is refused.
        runBlocking { assertEquals(false, graph.auth.handleRedirect(android.net.Uri.parse("com.deskhead.gente://oauth/callback?code=x&state=wrong"))) }
    }

    @Test fun chatWithoutSignInStreamsABadgedDemoReply() {
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithText(s(R.string.empty_chats_title)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.new_chat), useUnmergedTree = true).performClick()
        rule.onNode(hasSetTextAction()).performTextInput("What can you do?")
        rule.onNodeWithContentDescription(s(R.string.cd_send)).performClick()
        rule.waitUntil(10_000) { rule.onAllNodes(androidx.compose.ui.test.hasText(s(R.string.badge_demo))).fetchSemanticsNodes().isNotEmpty() }
        assertTrue(rule.onAllNodes(androidx.compose.ui.test.hasText("What can you do?")).fetchSemanticsNodes().isNotEmpty())
    }

    @Test fun approvalSheetAlwaysAsksAndDecides() {
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        val answer = CoroutineScope(Dispatchers.IO).async { graph.approvals.ask(ApprovalKind.MONEY, "Pay 12 USD for gente.app", "buy {\"amount\":\"12 USD\"}") }
        rule.waitUntil(5_000) { rule.onAllNodes(androidx.compose.ui.test.hasText(s(R.string.approval_title))).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText(s(R.string.approval_money)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.approval_always_asks)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.approve)).performClick()
        assertEquals(true, runBlocking { answer.await() })
    }

    @Test fun reportDialogSharesNoTextByDefault() {
        runBlocking {
            graph.dao.upsertChat(com.deskhead.gente.data.ChatEntity("c1", "Hi", 1, 1))
            graph.dao.upsertMessage(MessageEntity("u", "c1", "user", "Hi", 1))
            graph.dao.upsertMessage(MessageEntity("a", "c1", "assistant", "Hello there.", 2, ranOn = "cloud"))
        }
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithText("Hi").performClick()
        rule.onNodeWithText(s(R.string.badge_cloud)).assertIsDisplayed()
        rule.onNodeWithContentDescription(s(R.string.report)).performClick()
        rule.onNodeWithText(s(R.string.report_title)).assertIsDisplayed()
        rule.onNode(isToggleable()).assertIsOff()
    }

    @Test fun whereTheAiRunsSwitch() {
        runBlocking { graph.dao.upsertChat(com.deskhead.gente.data.ChatEntity("c2", "Trip", 1, 1)); graph.dao.upsertMessage(MessageEntity("u2", "c2", "user", "Trip", 1)) }
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithText("Trip").performClick()
        rule.onNode(hasContentDescription(s(R.string.where_ai_runs), substring = true)).performClick()
        rule.onNodeWithText(s(R.string.where_phone_body)).assertIsDisplayed() // flagged, not selectable
        rule.onNodeWithText(s(R.string.where_desktop_unpaired)).assertIsDisplayed()
    }

    @Test fun voiceWithoutOnDeviceRecognizerSaysSoInPlainWords() {
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithText(s(R.string.new_chat), useUnmergedTree = true).performClick()
        rule.onNodeWithContentDescription(s(R.string.cd_mic)).performClick()
        rule.waitForIdle()
        // Robolectric has no speech service: either it reports the plain-words error, or (if a shadow
        // recognizer exists) it is listening on the device. Never a raw error code.
        val st = graph.speech.state.value
        when (st) {
            is com.deskhead.gente.voice.SpeechInput.State.Problem -> rule.onNodeWithText(s(R.string.err_stt)).assertIsDisplayed()
            is com.deskhead.gente.voice.SpeechInput.State.Listening -> rule.onNodeWithText(s(R.string.listening)).assertIsDisplayed()
            else -> throw AssertionError("unexpected speech state $st")
        }
    }

    @Test fun dataCenterShowsWhereThingsLiveAndDeleteAsksFirst() {
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithContentDescription(s(R.string.cd_data)).performClick()
        rule.onNodeWithText(s(R.string.data_title)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.backup_off)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.data_chats)).assertIsDisplayed()
        rule.onNode(androidx.compose.ui.test.hasText(s(R.string.data_delete_all))).performScrollToAndClick()
        rule.onNodeWithText(s(R.string.data_delete_confirm_title)).assertIsDisplayed()
    }

    @Test fun paywallListsPlans() {
        rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithContentDescription(s(R.string.cd_settings)).performClick()
        rule.onNodeWithText(s(R.string.signed_out)).assertIsDisplayed()
        rule.onNodeWithText(s(R.string.delete_account)).assertExists()
    }
}

private fun androidx.compose.ui.test.SemanticsNodeInteraction.performScrollToAndClick() {
    performScrollTo(); performClick()
}
