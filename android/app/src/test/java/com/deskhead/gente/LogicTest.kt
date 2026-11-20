package com.deskhead.gente

import com.deskhead.gente.agent.ApprovalKind
import com.deskhead.gente.agent.ApprovalPolicy
import com.deskhead.gente.agent.ContextBuilder
import com.deskhead.gente.auth.Pkce
import com.deskhead.gente.data.MemoryEntity
import com.deskhead.gente.data.MessageEntity
import com.deskhead.gente.net.InferenceEvent
import com.deskhead.gente.net.Service
import com.deskhead.gente.net.SseToolAccumulator
import com.deskhead.gente.sync.LinkCrypto
import com.deskhead.gente.ui.components.ErrorText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalPolicyTest {
    @Test fun theFourKindsAlwaysAsk() {
        assertEquals(ApprovalKind.MONEY, ApprovalPolicy.classify("buy"))
        assertEquals(ApprovalKind.SEND_AS_USER, ApprovalPolicy.classify("send_email"))
        assertEquals(ApprovalKind.DELETE_DATA, ApprovalPolicy.classify("delete_my_data"))
        assertEquals(ApprovalKind.LEGAL, ApprovalPolicy.classify("accept_terms"))
    }
    @Test fun unknownRiskyToolsStillAsk() {
        assertEquals(ApprovalKind.MONEY, ApprovalPolicy.classify("stripe_checkout", """{"amount":"$20"}"""))
        assertEquals(ApprovalKind.SEND_AS_USER, ApprovalPolicy.classify("gmail_reply"))
        assertEquals(ApprovalKind.DELETE_DATA, ApprovalPolicy.classify("drive_trash_file"))
        assertEquals(ApprovalKind.LEGAL, ApprovalPolicy.classify("docusign_sign"))
    }
    @Test fun safeToolsDoNotAsk() {
        listOf("web_search", "remember", "create_image", "open_browser", "desktop_task").forEach {
            assertNull(it, ApprovalPolicy.classify(it, """{"query":"how to send money to buy terms"}"""))
        }
    }
}

class ContextBuilderTest {
    private fun m(i: Int, role: String, text: String) = MessageEntity("m$i", "c1", role, text, i.toLong())

    @Test fun systemPromptFirstAndFixed() {
        val a = ContextBuilder.build(listOf(m(1, "user", "hi")), emptyList())
        val b = ContextBuilder.build(listOf(m(1, "user", "something else")), emptyList())
        assertEquals("system", a[0].role)
        assertEquals(a[0].content, b[0].content)
    }
    @Test fun onlyRecentTurnsAndNoToolRows() {
        val history = (1..40).map { m(it, if (it % 2 == 0) "assistant" else "user", "turn $it") } + m(99, "tool", "search:x")
        val ctx = ContextBuilder.build(history, emptyList())
        assertEquals(ContextBuilder.MAX_TURNS, ctx.count { it.role != "system" })
        assertTrue(ctx.none { it.content == "search:x" })
        assertEquals("turn 40", ctx.last().content)
    }
    @Test fun onlyRelevantMemories() {
        val mems = listOf(MemoryEntity("a", "My dentist is Dr. Ruiz", 1), MemoryEntity("b", "I love hiking in Ajusco", 2))
        val ctx = ContextBuilder.build(listOf(m(1, "user", "Book my dentist for Monday")), mems)
        val sys2 = ctx[1].content!!
        assertTrue(sys2.contains("Dr. Ruiz"))
        assertTrue(!sys2.contains("hiking"))
        val none = ContextBuilder.build(listOf(m(1, "user", "hello")), mems)
        assertEquals(2, none.size) // system + the question, no memories
    }
}

class SseTest {
    @Test fun textAndToolCallsAreAssembled() {
        val p = SseToolAccumulator()
        val out = mutableListOf<InferenceEvent>()
        listOf(
            """data: {"choices":[{"delta":{"content":"Hel"}}]}""",
            "",
            """data: {"choices":[{"delta":{"content":"lo"}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c9","function":{"name":"web_search","arguments":"{\"qu"}}]}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ery\":\"x\"}"}}]}}]}""",
            ": keep-alive",
            "data: [DONE]",
        ).forEach { out += p.feed(it) }
        out += p.flushTools()
        assertEquals("Hello", out.filterIsInstance<InferenceEvent.Text>().joinToString("") { it.delta })
        val call = out.filterIsInstance<InferenceEvent.ToolCall>().single()
        assertEquals("web_search", call.name); assertEquals("""{"query":"x"}""", call.arguments); assertEquals("c9", call.id)
        assertTrue(p.done)
    }
}

class PkceTest {
    @Test fun rfc7636Vector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        val v = Pkce.verifier()
        assertTrue(v.length in 43..128)
        assertNotEquals(v, Pkce.verifier())
    }
}

class ServiceAndErrorsTest {
    @Test fun onlyInferenceCarriesChat() {
        assertEquals(setOf(Service.AI), Service.entries.filter { it.carriesChat }.toSet())
        assertEquals(Service.AI, Service.of("gente-cloud.vercel.app", "/v1/inference/chat/completions"))
        assertEquals(Service.RELAY, Service.of("gente-cloud.vercel.app", "/v1/relay/abc"))
        assertEquals(Service.SIGN_IN, Service.of("cool-airedale-3945.clerk.accounts.dev", "/oauth/token"))
    }
    @Test fun everyServerErrorHasPlainWords() {
        val generic = ErrorText.of("never-seen")
        listOf("offline", "missing_token", "invalid_token", "out_of_credit", "rate_limited", "too_many_sessions", "relay_not_ready",
            "no_desktop", "bad_qr", "stt_unavailable", "billing_unavailable", "server", "billing_not_configured")
            .forEach { assertNotEquals(it, generic, ErrorText.of(it)) }
    }
}

class LinkCryptoTest {
    @Test fun qrRoundTripAndBothSidesAgree() {
        val (dPriv, dPub) = LinkCrypto.newKeyPair()
        val (pPriv, pPub) = LinkCrypto.newKeyPair()
        val s = LinkCrypto.newSecret()
        val offer = LinkCrypto.parseQr(LinkCrypto.qrFor("d1", "My Mac", dPub, s))!!
        assertEquals("My Mac", offer.name)
        val phone = LinkCrypto.Session(pPriv, offer.desktopPk, offer.secret, true)
        val desk = LinkCrypto.Session(dPriv, pPub, s, false)
        assertEquals(phone.safetyCode, desk.safetyCode)
        assertEquals(phone.channel, desk.channel)
        assertEquals("hi", String(desk.open(phone.seal("hi".toByteArray(), 7))))
        assertEquals("yo", String(phone.open(desk.seal("yo".toByteArray(), 1))))
    }
    @Test(expected = Exception::class) fun counterIsAuthenticated() {
        val (dPriv, dPub) = LinkCrypto.newKeyPair(); val (pPriv, pPub) = LinkCrypto.newKeyPair(); val s = LinkCrypto.newSecret()
        val phone = LinkCrypto.Session(pPriv, dPub, s, true); val desk = LinkCrypto.Session(dPriv, pPub, s, false)
        desk.open(phone.seal("x".toByteArray(), 3).copy(seq = 4))
    }
    @Test fun badQrIsRejected() {
        assertNull(LinkCrypto.parseQr("https://evil.example/link?v=1"))
        assertNull(LinkCrypto.parseQr("gente://link?v=2&id=x&pk=AAAA&s=BBBB"))
    }
}

class EgressCountTest {
    @Test fun countsBytesActuallyReceivedEvenWhenStreamed() {
        val server = mockwebserver3.MockWebServer()
        server.enqueue(mockwebserver3.MockResponse.Builder().chunkedBody("x".repeat(5000), 512).build())
        server.start()
        val got = mutableListOf<com.deskhead.gente.net.EgressRecord>()
        val c = okhttp3.OkHttpClient.Builder().addInterceptor(com.deskhead.gente.net.EgressInterceptor({ got += it })).build()
        c.newCall(okhttp3.Request.Builder().url(server.url("/v1/inference/chat/completions")).build()).execute().use { it.body.string() }
        server.close()
        assertEquals(1, got.size)
        assertEquals(5000L, got.single().bytesIn)
    }
}
