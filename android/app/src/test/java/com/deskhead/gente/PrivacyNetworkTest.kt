package com.deskhead.gente

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.deskhead.gente.agent.ApprovalCenter
import com.deskhead.gente.agent.ChatEngine
import com.deskhead.gente.agent.Settings
import com.deskhead.gente.data.GenteDatabase
import com.deskhead.gente.data.MemoryEntity
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.EgressRecord
import com.deskhead.gente.net.EgressSink
import com.deskhead.gente.sync.LinkCrypto
import com.deskhead.gente.sync.LinkService
import com.deskhead.gente.sync.RelayClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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
import java.util.Collections

/**
 * The core privacy promise, checked on the wire:
 * chat text may appear ONLY in requests to /v1/inference. Every other request (free-message
 * counter, web search, the relay to the desktop, AI-output reports, sign-in) must not carry it.
 * The test fails if the canary shows up anywhere else, in plain text or base64.
 */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [36])
class PrivacyNetworkTest {
    private val canary = "CANARY-7f3a my bank PIN is 4401 and my sister Ana lives at 12 Elm St"
    private val server = MockWebServer()
    private val cloud = FakeCloud()
    private val egress = Collections.synchronizedList(mutableListOf<EgressRecord>())
    private lateinit var db: GenteDatabase

    @Before fun setUp() { server.dispatcher = cloud; server.start() }
    @After fun tearDown() { server.close(); db.close() }

    private fun assertNoLeak(others: List<Pair<String, String>>) {
        val b64 = java.util.Base64.getEncoder().encodeToString("CANARY-7f3a".toByteArray()).dropLast(2)
        for ((path, body) in others) {
            assertFalse("chat text leaked to $path", body.contains("CANARY") || body.contains("4401") || body.contains("Elm St"))
            assertFalse("chat text leaked (base64) to $path", body.contains(b64))
        }
    }

    /** Negative test: the checker really catches a leak (here, chat text sent as a search query). */
    @Test fun checkerCatchesALeak() = runBlocking {
        db = GenteDatabase.inMemory(ApplicationProvider.getApplicationContext<Application>())
        val api = CloudApi(server.url("/").toString().trimEnd('/'), EgressSink { }, { "t" })
        api.search(canary)
        val others = cloud.requests.filterNot { it.first.startsWith("/v1/inference") }
        val caught = runCatching { assertNoLeak(others) }.exceptionOrNull()
        assertTrue("leak must be caught", caught is AssertionError && caught.message!!.contains("/v1/proxy/search"))
    }

    @Test fun chatTextOnlyEverGoesToInference() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        db = GenteDatabase.inMemory(app)
        val dao = db.dao()
        val base = server.url("/").toString().trimEnd('/')
        val api = CloudApi(base, EgressSink { egress += it }, { "test-token" })
        val approvals = ApprovalCenter(dao)
        val link = LinkService(dao, FakeVault(), RelayClient(base, api.http) { "test-token" }, approvals, "Pixel")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val engine = ChatEngine(dao, api, link, approvals, Settings(app), signedIn = { true }, filesDir = app.filesDir, scope = scope)

        // Pair with a simulated desktop so sync and handoff really go through the relay.
        val (dPriv, dPub) = LinkCrypto.newKeyPair()
        val secret = LinkCrypto.newSecret()
        link.pair(LinkCrypto.qrFor("desk-1", "Studio Mac", dPub, secret))
        dao.upsertMemory(MemoryEntity("m1", "Ana is my sister and likes bank holidays", 1))

        val chatId = engine.newChat()
        withTimeout(20_000) { engine.send(chatId, canary).join() }

        val reply = dao.messagesNow(chatId).last { it.role == "assistant" }
        assertEquals("Sunny and warm.", reply.text)
        assertEquals("cloud", reply.ranOn)

        link.pushChat(chatId) // E2E sync of the chat that holds the canary
        link.pushMemories()
        link.handoff(chatId)
        api.reportAiOutput(reply.id, "offensive", sharedText = null) // default report shares no text

        val inference = cloud.requests.filter { it.first.startsWith("/v1/inference") }
        val others = cloud.requests.filterNot { it.first.startsWith("/v1/inference") }
        assertTrue("canary must reach inference", inference.any { it.second.contains("CANARY-7f3a") })
        assertTrue("relay was used", others.any { it.first.startsWith("/v1/relay") })
        assertTrue("search was used", others.any { it.first == "/v1/proxy/search" })
        assertNoLeak(others)
        // Only the context of this one chat went to inference: the memory about Ana matched, nothing else.
        assertTrue(inference.first().second.contains("Ana is my sister"))

        // The desktop can read what the relay holds; the relay itself only has ciphertext.
        val desktop = LinkCrypto.Session(dPriv, LinkCrypto.unb64(link.firstDevice()!!.let { String(FakeVault().open(it.sealedKeys)) }.let { k -> com.deskhead.gente.net.GenteJson.decodeFromString(LinkCrypto.Keys.serializer(), k).phonePub }), secret, iAmPhone = false)
        val stored = cloud.relayStore.values.flatten().map { String(it.second) }
        assertTrue(stored.isNotEmpty())
        assertTrue(stored.any { String(desktop.open(LinkCrypto.decode(it))).contains("CANARY-7f3a") })

        // The "What left your phone" log has no content, only service, size and status.
        val chatCarriers = egress.filter { it.service.carriesChat }.map { it.path }.toSet()
        assertEquals(setOf("/v1/inference/chat/completions"), chatCarriers)
        assertTrue(egress.none { it.toString().contains("CANARY") })
    }
}
