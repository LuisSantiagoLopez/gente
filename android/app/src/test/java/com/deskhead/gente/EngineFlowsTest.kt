package com.deskhead.gente

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.deskhead.gente.agent.ApprovalCenter
import com.deskhead.gente.agent.ChatEngine
import com.deskhead.gente.agent.Notice
import com.deskhead.gente.agent.Settings
import com.deskhead.gente.data.GenteDatabase
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.EgressSink
import com.deskhead.gente.privacy.DataCenter
import com.deskhead.gente.sync.LinkService
import com.deskhead.gente.sync.RelayClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream

/** Tools, approvals, offline, account deletion, export and purchase verification, end to end. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [36])
class EngineFlowsTest {
    private val server = MockWebServer()
    private val cloud = FakeCloud()
    private lateinit var db: GenteDatabase
    private val app get() = ApplicationProvider.getApplicationContext<Application>()
    @Before fun up() { server.dispatcher = cloud; server.start(); db = GenteDatabase.inMemory(app) }
    @After fun down() { server.close(); db.close() }

    private fun engine(base: String = server.url("/").toString().trimEnd('/')): Triple<ChatEngine, ApprovalCenter, CloudApi> {
        val api = CloudApi(base, EgressSink { }, { "t" })
        val approvals = ApprovalCenter(db.dao())
        val link = LinkService(db.dao(), FakeVault(), RelayClient(base, api.http) { "t" }, approvals, "Pixel")
        return Triple(ChatEngine(db.dao(), api, link, approvals, Settings(app), { true }, app.filesDir, CoroutineScope(SupervisorJob() + Dispatchers.IO)), approvals, api)
    }

    @Test fun moneyToolWaitsForApprovalAndRunsOnYes() = runBlocking {
        cloud.toolName = "buy"; cloud.toolArgs = "{\\\"item\\\":\\\"domain gente.app\\\",\\\"amount\\\":\\\"12 USD\\\"}"
        val (e, approvals) = engine()
        val chat = e.newChat()
        val job = e.send(chat, "buy me the domain")
        val pending = withTimeout(10_000) { db.dao().pendingApprovals().first { it.isNotEmpty() } }.single()
        assertEquals("money", pending.kind)
        assertTrue(pending.title.contains("12 USD"))
        delay(200)
        assertTrue("nothing happens before the yes", job.isActive)
        approvals.decide(pending.id, true)
        withTimeout(10_000) { job.join() }
        val rows = db.dao().messagesNow(chat)
        assertTrue(rows.any { it.role == "tool" && it.text.startsWith("approved:") })
        assertEquals("done", rows.last { it.role == "assistant" }.status)
    }

    @Test fun declinedApprovalTellsTheModelNo() = runBlocking {
        cloud.toolName = "send_email"; cloud.toolArgs = "{\\\"to\\\":\\\"sam@x.com\\\",\\\"subject\\\":\\\"Hi\\\",\\\"body\\\":\\\"Hello\\\"}"
        val (e, approvals) = engine()
        val chat = e.newChat()
        val job = e.send(chat, "email sam")
        val p = withTimeout(10_000) { db.dao().pendingApprovals().first { it.isNotEmpty() } }.single()
        assertEquals("send_as_user", p.kind)
        approvals.decide(p.id, false)
        withTimeout(10_000) { job.join() }
        val second = cloud.requests.filter { it.first.startsWith("/v1/inference") }[1].second
        assertTrue(second.contains("The person said no"))
    }

    @Test fun offlineNeverShowsRawErrors() = runBlocking {
        val (e) = engine("http://127.0.0.1:9")
        val notice = async { e.notices.first() }
        val chat = e.newChat()
        withTimeout(15_000) { e.send(chat, "hello?").join() }
        assertEquals(Notice.Problem("offline"), withTimeout(5_000) { notice.await() })
        assertEquals("failed", db.dao().messagesNow(chat).last().status)
        assertEquals("hello?", db.dao().messagesNow(chat).first().text) // the question is kept on the phone
    }

    @Test fun accountDeletionReturnsReceiptAndLogsIt() = runBlocking {
        val (_, _, api) = engine()
        val r = DataCenter(db.dao(), api).deleteCloudAccount()
        assertEquals("rcpt_123", r.receiptId)
        assertEquals(listOf("google"), r.cancelInStore)
        assertTrue(cloud.requests.any { it.first == "/v1/me" && it.second.contains("\"confirm\":\"DELETE\"") })
        assertTrue(db.dao().events().first().any { it.kind == "receipt" && it.detail.contains("rcpt_123") })
    }

    @Test fun exportHasEverythingAndUsesNoNetwork() = runBlocking {
        val (e) = engine()
        cloud.toolFirst = false
        val chat = e.newChat()
        withTimeout(10_000) { e.send(chat, "remember my plan").join() }
        val before = cloud.requests.size
        val out = ByteArrayOutputStream()
        DataCenter(db.dao(), CloudApi("http://127.0.0.1:9", EgressSink { }, { null })).exportTo(out)
        val s = out.toString()
        assertTrue(s.contains("gente-export/v1") && s.contains("remember my plan") && s.contains("Sunny and warm."))
        assertEquals(before, cloud.requests.size)
    }

    @Test fun playPurchaseIsVerifiedByTheServer() = runBlocking {
        val (_, _, api) = engine()
        val r = api.verifyPlayPurchase("gente_pro", "tok-abc", "subs")
        assertTrue(r.ok)
        val body = cloud.requests.single { it.first == "/v1/billing/play/verify" }.second
        assertTrue(body.contains("\"packageName\":\"com.deskhead.gente\"") && body.contains("\"purchaseToken\":\"tok-abc\"") && body.contains("\"kind\":\"subs\""))
    }
}
