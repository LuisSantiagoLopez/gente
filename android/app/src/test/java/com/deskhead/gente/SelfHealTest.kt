package com.deskhead.gente

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.deskhead.gente.agent.ApprovalCenter
import com.deskhead.gente.agent.ChatEngine
import com.deskhead.gente.agent.SelfHeal
import com.deskhead.gente.agent.Settings
import com.deskhead.gente.data.GenteDatabase
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.EgressSink
import com.deskhead.gente.sync.LinkCrypto
import com.deskhead.gente.sync.LinkService
import com.deskhead.gente.sync.RelayClient
import com.deskhead.gente.ui.components.HealText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The four self-heal failures from the shared catalog, each injected for real against a fake cloud. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [36])
class SelfHealTest {
    private val server = MockWebServer()
    private val cloud = FakeCloud()
    private lateinit var db: GenteDatabase
    private val app get() = ApplicationProvider.getApplicationContext<Application>()
    private var reauthWorks = true
    private var share = false

    @Before fun up() { server.dispatcher = cloud; server.start(); db = GenteDatabase.inMemory(app); runBlocking { Settings(app).clear() } }
    @After fun down() { server.close(); db.close() }

    private fun base() = server.url("/").toString().trimEnd('/')
    private fun heal() = SelfHeal(db.dao(), "1.0.0", { "install-1" }, { share }, base(), okhttp3.OkHttpClient())
    private fun repairs() = runBlocking { db.dao().allEvents() }.filter { it.kind == "repair" }.mapNotNull { SelfHeal.parse(it.detail) }

    private fun setup(h: SelfHeal, slowMs: Long = SelfHeal.SLOW_REPLY_MS): Triple<ChatEngine, LinkService, CloudApi> {
        val api = CloudApi(base(), EgressSink { }, { "t" },
            reauth = { reauthWorks },
            onSignInHeal = { fixed, ms ->
                if (fixed) h.record(com.deskhead.gente.agent.Failure.SIGN_IN_EXPIRED, com.deskhead.gente.agent.Outcome.FIXED, com.deskhead.gente.agent.Step.REFRESH_SIGN_IN, ms)
                else h.record(com.deskhead.gente.agent.Failure.SIGN_IN_EXPIRED, com.deskhead.gente.agent.Outcome.NEEDS_PERSON)
            })
        val approvals = ApprovalCenter(db.dao())
        val link = LinkService(db.dao(), FakeVault(), RelayClient(base(), api.http) { "t" }, approvals, "Pixel", heal = h)
        val engine = ChatEngine(db.dao(), api, link, approvals, Settings(app), { true }, app.filesDir, CoroutineScope(SupervisorJob() + Dispatchers.IO), heal = h, slowReplyMs = slowMs)
        cloud.toolFirst = false
        return Triple(engine, link, api)
    }

    @Test fun signInExpiredIsRenewedAndTheChatStillWorks() = runBlocking {
        val (e) = setup(heal())
        cloud.unauthorizedOnce = true
        val c = e.newChat(); withTimeout(10_000) { e.send(c, "hello").join() }
        assertEquals("Sunny and warm.", db.dao().messagesNow(c).last().text)
        val r = repairs().single()
        assertEquals("sign-in-expired" to "fixed", r.failureId to r.outcome)
        assertEquals("refresh-sign-in", r.fixedBy)
        assertTrue(HealText.sentence(app, r, 0).contains("your sign-in ran out, so I renewed your sign-in"))
    }

    @Test fun signInThatCannotBeRenewedAsksThePerson() = runBlocking {
        val (e) = setup(heal())
        reauthWorks = false; cloud.unauthorizedOnce = true
        val c = e.newChat(); withTimeout(10_000) { e.send(c, "hello").join() }
        val r = repairs().single()
        assertEquals("needs-person", r.outcome)
        assertTrue(HealText.sentence(app, r, 0).contains("Please sign in to Gente again. Your chats are safe."))
    }

    @Test fun cloudModelUnavailableRetriesAndAnswers() = runBlocking {
        val (e) = setup(heal())
        cloud.inferenceFailures = 1
        val c = e.newChat(); withTimeout(15_000) { e.send(c, "hello").join() }
        assertEquals("Sunny and warm.", db.dao().messagesNow(c).last().text)
        val r = repairs().single()
        assertEquals(Triple("cloud-model-unavailable", "fixed", "retry-request"), Triple(r.failureId, r.outcome, r.fixedBy))
    }

    @Test fun cloudModelStillDownTellsThePersonCalmly() = runBlocking {
        val (e) = setup(heal())
        cloud.inferenceFailures = 5
        val c = e.newChat(); withTimeout(15_000) { e.send(c, "hello").join() }
        assertEquals("failed", db.dao().messagesNow(c).last().status)
        assertEquals("needs-person", repairs().single().outcome)
    }

    private suspend fun pairSilentDesktop(link: LinkService) {
        val (_, pub) = LinkCrypto.newKeyPair()
        link.pair(LinkCrypto.qrFor("desk-1", "Mac", pub, LinkCrypto.newSecret()))
        Settings(app).setLocation(com.deskhead.gente.agent.AiLocation.DESKTOP)
    }

    @Test fun slowComputerAnswersFromCloudOnlyWhenAllowed() = runBlocking {
        val (e, link) = setup(heal(), slowMs = 400)
        pairSilentDesktop(link)
        Settings(app).setSlowFallbackToCloud(true)
        val c = e.newChat(); withTimeout(15_000) { e.send(c, "hello").join() }
        val reply = db.dao().messagesNow(c).last()
        assertEquals("Sunny and warm.", reply.text)
        assertEquals("cloud", reply.ranOn) // the badge tells the truth about where it ran
        val r = repairs().single()
        assertEquals(Triple("slow-replies", "fixed", "answer-from-cloud"), Triple(r.failureId, r.outcome, r.fixedBy))
    }

    @Test fun slowComputerWithoutPermissionNeverGoesToCloud() = runBlocking {
        val (e, link) = setup(heal(), slowMs = 400)
        pairSilentDesktop(link)
        val c = e.newChat(); val job = e.send(c, "PRIVATE-CANARY")
        withTimeout(10_000) { while (repairs().isEmpty()) delay(100) }
        job.cancel()
        assertEquals("still-trying", repairs().single().outcome)
        assertFalse(cloud.requests.any { it.first.startsWith("/v1/inference") })
    }

    @Test fun relayDownIsRestartedAndRecordedWhenBack() = runBlocking {
        val (_, link) = setup(heal())
        val (_, pub) = LinkCrypto.newKeyPair()
        link.pair(LinkCrypto.qrFor("desk-1", "Mac", pub, LinkCrypto.newSecret()))
        cloud.relayGetFailures = 2
        repeat(3) { link.pollWithHeal() }
        val r = repairs().single()
        assertEquals(Triple("relay-down", "fixed", "restart-relay"), Triple(r.failureId, r.outcome, r.fixedBy))
    }

    @Test fun repairReportsGoOutOnlyWithAlwaysSendAndCarryNoContent() = runBlocking {
        val h = heal()
        h.record("relay-down", com.deskhead.gente.agent.Outcome.FIXED, "restart-relay", 1200)
        assertTrue(cloud.requests.none { it.first.endsWith("/diagnostics") })
        share = true
        h.record("sign-in-expired", com.deskhead.gente.agent.Outcome.FIXED, "refresh-sign-in", 300)
        val body = cloud.requests.single { it.first.endsWith("/diagnostics") }.second
        val o = com.deskhead.gente.net.GenteJson.parseToJsonElement(body) as kotlinx.serialization.json.JsonObject
        assertEquals(setOf("kind", "failureId", "outcome", "fixedBy", "ms", "version", "platform", "installId"), o.keys)
        assertTrue(body.contains("\"kind\":\"repair\"") && body.contains("\"platform\":\"android\""))
    }
}
