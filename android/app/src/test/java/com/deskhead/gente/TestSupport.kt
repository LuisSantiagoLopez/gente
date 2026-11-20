package com.deskhead.gente

import android.app.Application
import com.deskhead.gente.data.GenteDatabase
import com.deskhead.gente.security.Vault
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.RecordedRequest
import java.util.Collections

/** A stand-in for Android Keystore on the JVM: a fixed XOR, only for tests. */
class FakeVault : Vault {
    override val usesStrongBox = false
    override fun seal(plain: ByteArray) = plain.map { (it.toInt() xor 0x5A).toByte() }.toByteArray()
    override fun open(sealed: ByteArray) = seal(sealed)
    override fun databasePassphrase() = ByteArray(32)
    override fun destroyAll() {}
}

/** Robolectric app with an in-memory database and the fake vault. */
class TestApp : GenteApp() {
    override fun buildGraph(): AppGraph = AppGraph(this, FakeVault(), GenteDatabase.inMemory(this), cloudBase = "http://127.0.0.1:9")
}

/**
 * A fake Gente Cloud. Records every request body. The relay keeps envelopes exactly as
 * received, like the real ciphertext-only relay.
 */
class FakeCloud : Dispatcher() {
    val requests: MutableList<Pair<String, String>> = Collections.synchronizedList(mutableListOf())
    val relayStore: MutableMap<String, MutableList<Pair<Long, ByteArray>>> = Collections.synchronizedMap(mutableMapOf())
    private var seq = 0L
    var inferenceRound = 0
    var toolFirst = true
    var unauthorizedOnce = false
    var inferenceFailures = 0
    var relayGetFailures = 0
    var toolName = "web_search"
    var toolArgs = "{\\\"query\\\":\\\"weather today\\\"}"

    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.url.encodedPath
        val body = request.body?.utf8() ?: ""
        requests += path to body
        fun json(s: String, code: Int = 200) = MockResponse.Builder().code(code).addHeader("content-type", "application/json").body(s).build()
        if (unauthorizedOnce && path.startsWith("/v1/")) { unauthorizedOnce = false; return json("""{"error":"invalid_token"}""", 401) }
        return when {
            path.endsWith("/diagnostics") -> json("""{"ok":true}""", 201)
            path == "/v1/inference/chat/completions" && inferenceFailures > 0 -> { inferenceFailures--; json("""{"error":"model_unavailable"}""", 503) }
            path.startsWith("/v1/relay/") && request.method == "GET" && relayGetFailures > 0 -> { relayGetFailures--; json("""{"error":"server"}""", 500) }
            path == "/v1/messages/consume" -> json("""{"allowed":true,"used":1,"limit":10}""")
            path == "/v1/inference/chat/completions" -> {
                inferenceRound++
                val sse = if (toolFirst && inferenceRound % 2 == 1) {
                    listOf(
                        """{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"$toolName","arguments":""}}]}}]}""",
                        """{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"$toolArgs"}}]}}]}""",
                    )
                } else listOf("""{"choices":[{"delta":{"content":"Sunny and "}}]}""", """{"choices":[{"delta":{"content":"warm."}}]}""")
                MockResponse.Builder().addHeader("content-type", "text/event-stream").addHeader("x-gente-not-stored", "content=none")
                    .body(sse.joinToString("") { "data: $it\n\n" } + "data: [DONE]\n\n").build()
            }
            path == "/v1/proxy/search" -> json("""{"results":[{"title":"Weather","url":"https://example.com","text":"Sunny"}]}""")
            path == "/v1/me" && request.method == "DELETE" ->
                if (body.contains("\"confirm\":\"DELETE\"")) json("""{"receiptId":"rcpt_123","cancelInStore":["google"]}""") else json("""{"error":"invalid_input"}""", 422)
            path == "/v1/billing/play/verify" -> json("""{"ok":true,"planId":"pro"}""")
            path == "/v1/support/tickets" -> json("""{"id":"t1"}""", 201)
            path.startsWith("/v1/relay/") && request.method == "POST" -> {
                val ch = path.removePrefix("/v1/relay/")
                val s = synchronized(this) { ++seq }
                relayStore.getOrPut(ch) { mutableListOf() } += s to (request.body?.toByteArray() ?: ByteArray(0))
                json("""{"seq":$s}""", 201)
            }
            path.startsWith("/v1/relay/") && request.method == "GET" -> {
                val ch = path.removePrefix("/v1/relay/")
                val after = request.url.queryParameter("after")?.toLong() ?: 0
                val items = relayStore[ch].orEmpty().filter { it.first > after }
                json("""{"envelopes":[${items.joinToString(",") { """{"seq":${it.first},"envelope":"${java.util.Base64.getEncoder().encodeToString(it.second)}"}""" }}]}""")
            }
            else -> json("""{"error":"not_found"}""", 404)
        }
    }
}
