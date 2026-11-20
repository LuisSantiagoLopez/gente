package com.deskhead.gente

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.deskhead.gente.agent.ApprovalCenter
import com.deskhead.gente.data.ChatEntity
import com.deskhead.gente.data.GenteDatabase
import com.deskhead.gente.data.MessageEntity
import com.deskhead.gente.net.GenteJson
import com.deskhead.gente.net.WireMessage
import com.deskhead.gente.sync.LinkCrypto
import com.deskhead.gente.sync.LinkService
import com.deskhead.gente.sync.RelayClient
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The relay stores only ciphertext, and only the paired desktop can read it. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [36])
@OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
class RelayCiphertextTest {
    private val server = MockWebServer()
    private val cloud = FakeCloud()
    private lateinit var db: GenteDatabase
    @Before fun up() { server.dispatcher = cloud; server.start() }
    @After fun down() { server.close(); db.close() }

    private fun setup(): Triple<LinkService, LinkCrypto.Session, String> = runBlocking {
        db = GenteDatabase.inMemory(ApplicationProvider.getApplicationContext<Application>())
        val base = server.url("/").toString().trimEnd('/')
        val link = LinkService(db.dao(), FakeVault(), RelayClient(base, OkHttpClient()) { "t" }, ApprovalCenter(db.dao()), "Pixel")
        val (dPriv, dPub) = LinkCrypto.newKeyPair()
        val secret = LinkCrypto.newSecret()
        val phoneCode = link.pair(LinkCrypto.qrFor("desk-1", "Studio Mac", dPub, secret))
        // Desktop reads the hello (phone public key travels in the clear, as it must) and derives the same keys.
        val hello = LinkCrypto.decode(String(cloud.relayStore.values.single().single().second))
        val desktop = LinkCrypto.Session(dPriv, LinkCrypto.unb64(hello.epk!!), secret, iAmPhone = false)
        assertEquals(phoneCode, desktop.safetyCode)
        assertTrue(String(desktop.open(hello)).contains("hello"))
        Triple(link, desktop, LinkCrypto.channel(secret))
    }

    private fun desktopSends(desktop: LinkCrypto.Session, channel: String, seq: Long, json: String) {
        cloud.relayStore.getOrPut(channel) { mutableListOf() } += (1000 + seq) to LinkCrypto.encode(desktop.seal(json.toByteArray(), seq)).toByteArray()
    }

    @Test fun relayOnlyStoresCiphertext() = runBlocking {
        val (link, desktop, _) = setup()
        val dao = db.dao()
        val secretText = "Private plan: surprise party for Ana on Friday"
        dao.upsertChat(ChatEntity("c1", "Party", 1, 2))
        dao.upsertMessage(MessageEntity("u1", "c1", "user", secretText, 1))
        link.pushChat("c1")
        link.pushMemories()

        val raw = cloud.relayStore.values.flatten().map { it.second }
        assertTrue(raw.size >= 3)
        for (bytes in raw) {
            val s = String(bytes)
            assertFalse(s.contains("surprise")); assertFalse(s.contains("Ana")); assertFalse(s.contains("Party"))
            val env = GenteJson.parseToJsonElement(s).jsonObject
            // Only envelope fields, nothing readable.
            assertTrue(env.keys.all { it in setOf("v", "from", "seq", "n", "ct", "epk") })
        }
        // The desktop decrypts it.
        val sync = raw.map { LinkCrypto.decode(String(it)) }.first { it.seq == 2L }
        assertTrue(String(desktop.open(sync)).contains(secretText))
    }

    @Test fun tamperedOrReplayedEnvelopesAreRejected() = runBlocking {
        val (link, desktop, channel) = setup()
        val env = desktop.seal("""{"type":"approval.request","id":"a1","kind":"money","title":"Pay ${'$'}12 for a domain","detail":"x"}""".toByteArray(), 1)
        val flipped = env.copy(ct = LinkCrypto.b64(LinkCrypto.unb64(env.ct).also { it[0] = (it[0].toInt() xor 1).toByte() }))
        cloud.relayStore.getOrPut(channel) { mutableListOf() } += 500L to LinkCrypto.encode(flipped).toByteArray()
        link.pollOnce()
        assertEquals(null, db.dao().approval("a1")) // tampered: ignored
        cloud.relayStore.getValue(channel) += 501L to LinkCrypto.encode(env).toByteArray()
        link.pollOnce()
        assertNotNull(db.dao().approval("a1")) // genuine: shown on the phone
        db.dao().upsertApproval(db.dao().approval("a1")!!.copy(status = "approved"))
        cloud.relayStore.getValue(channel) += 502L to LinkCrypto.encode(env).toByteArray()
        link.pollOnce()
        assertEquals("approved", db.dao().approval("a1")!!.status) // replay: ignored
    }

    @Test fun desktopApprovalAnsweredFromPhoneAndPrivateModeStreams() = runBlocking {
        val (link, desktop, channel) = setup()
        desktopSends(desktop, channel, 1, """{"type":"approval.request","id":"a2","kind":"send_as_user","title":"Send the email to Sam","detail":"Hi Sam"}""")
        link.pollOnce()
        assertEquals("desktop", db.dao().approval("a2")!!.source)
        link.answerApproval("a2", true)
        val decision = cloud.relayStore.getValue(channel).map { LinkCrypto.decode(String(it.second)) }.last { it.from == "phone" }
        assertEquals("true", GenteJson.parseToJsonElement(String(desktop.open(decision))).jsonObject["approved"]!!.jsonPrimitive.content)

        // Private mode: the desktop's local model answers through the relay.
        val job = kotlinx.coroutines.GlobalScope.async {
            link.privateInfer(listOf(WireMessage("user", "hi"))).toList()
        }
        kotlinx.coroutines.delay(300)
        val req = cloud.relayStore.getValue(channel).map { LinkCrypto.decode(String(it.second)) }.last { it.from == "phone" }
        val reqId = GenteJson.parseToJsonElement(String(desktop.open(req))).jsonObject["reqId"]!!.jsonPrimitive.content
        desktopSends(desktop, channel, 2, """{"type":"private.delta","reqId":"$reqId","text":"Hello "}""")
        desktopSends(desktop, channel, 3, """{"type":"private.delta","reqId":"$reqId","text":"from your Mac"}""")
        desktopSends(desktop, channel, 4, """{"type":"private.done","reqId":"$reqId"}""")
        assertEquals("Hello from your Mac", job.await().joinToString(""))
    }
}
