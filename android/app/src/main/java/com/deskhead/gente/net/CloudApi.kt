package com.deskhead.gente.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Every failure the UI can see. Mapped to plain words by ErrorText; raw text never reaches the screen. */
class CloudException(val code: String, val status: Int) : Exception(code)

val GenteJson = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

@Serializable data class Plan(
    val id: String = "free",
    val status: String? = null,
    val cloud: Boolean = false,
    val monthlyOnlineHours: Double? = null,
    val messagesLimit: Int? = null,
    val messagesUsed: Int? = null,
)

@Serializable data class Balance(val planSeconds: Long = 0, val topupSeconds: Long = 0, val totalSeconds: Long = 0, val totalHours: Double = 0.0)
@Serializable data class SearchResult(val title: String = "", val url: String = "", val publishedDate: String? = null, val text: String? = null)
@Serializable data class SearchResponse(val results: List<SearchResult> = emptyList())
@Serializable data class Consume(val allowed: Boolean, val used: Int? = null, val limit: Int? = null)
@Serializable data class MediaJob(val jobId: String, val status: String, val chargedSeconds: Long? = null, val stub: Boolean = false, val files: List<MediaFile> = emptyList())
@Serializable data class MediaFile(val url: String, val contentType: String? = null)
@Serializable data class SessionStart(val sessionId: String, val leaseUntil: String? = null, val heartbeatEverySeconds: Int = 30, val connection: SessionConnection? = null)
@Serializable data class SessionConnection(val liveViewUrl: String? = null, val connectUrl: String? = null, val sandboxId: String? = null)
@Serializable data class AccountDeleted(val receiptId: String, val cancelInStore: List<String> = emptyList())
/** Signed (Ed25519 over digest) deletion receipt. Holds no personal data. */
@Serializable data class DeletionReceipt(val id: String, val objectType: String = "", val reason: String = "", val deletedAt: String = "", val digest: String = "", val signature: String = "")
@Serializable data class Receipts(val receipts: List<DeletionReceipt> = emptyList(), val publicKeyUrl: String? = null)
@Serializable data class CloudObject(val type: String, val id: String? = null, val holds: String? = null, val retention: String? = null, val expiresAt: String? = null)
@Serializable data class MyData(val objects: List<CloudObject> = emptyList())
@Serializable data class AccountToken(val googleObfuscatedAccountId: String? = null)
@Serializable data class PlanOffer(val id: String, val monthlyCents: Int? = null, val yearlyCents: Int? = null, val currency: String = "usd", val onlineHours: Int = 0)
@Serializable data class PlanOffers(val plans: List<PlanOffer> = emptyList())
@Serializable data class PlayVerify(val ok: Boolean = false, val planId: String? = null, val hoursAdded: Double? = null)

/** One chat message as the OpenAI-compatible API wants it. */
@Serializable data class WireMessage(
    val role: String,
    val content: String? = null,
    val tool_call_id: String? = null,
    val tool_calls: List<WireToolCall>? = null,
)
@Serializable data class WireToolCall(val id: String, val type: String = "function", val function: WireFunction)
@Serializable data class WireFunction(val name: String, val arguments: String)

sealed interface InferenceEvent {
    data class Text(val delta: String) : InferenceEvent
    data class ToolCall(val id: String, val name: String, val arguments: String) : InferenceEvent
    data class Done(val stub: Boolean) : InferenceEvent
}

/**
 * Client for Gente Cloud. Holds no vendor keys. Every call gets a fresh token.
 * Chat text is only ever put in the body of [streamChat], which goes to /v1/inference.
 */
class CloudApi(
    private val base: String,
    egress: EgressSink,
    private val token: suspend () -> String?,
    clientBuilder: OkHttpClient.Builder = OkHttpClient.Builder(),
) {
    val http: OkHttpClient = clientBuilder
        .addInterceptor(EgressInterceptor(egress))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json".toMediaType()

    private suspend fun request(path: String, method: String = "GET", body: JsonElement? = null, auth: Boolean = true): Request {
        val b = Request.Builder().url(base + path)
        if (auth) {
            val t = token() ?: throw CloudException("missing_token", 401)
            b.header("Authorization", "Bearer $t")
        }
        b.header("User-Agent", "Gente-Android/1")
        val rb = body?.let { GenteJson.encodeToString(JsonElement.serializer(), it).toRequestBody(jsonType) }
        when (method) {
            "GET" -> b.get()
            "DELETE" -> if (rb != null) b.delete(rb) else b.delete()
            else -> b.method(method, rb ?: "{}".toRequestBody(jsonType))
        }
        return b.build()
    }

    private suspend fun call(path: String, method: String = "GET", body: JsonElement? = null, auth: Boolean = true): JsonElement =
        withContext(Dispatchers.IO) {
            val req = request(path, method, body, auth)
            val res = try { http.newCall(req).execute() } catch (e: IOException) { throw CloudException("offline", 0) }
            res.use { r ->
                val text = r.body.string()
                if (!r.isSuccessful) throw CloudException(errorCode(text, r.code), r.code)
                if (text.isBlank()) JsonObject(emptyMap()) else GenteJson.parseToJsonElement(text)
            }
        }

    private fun errorCode(body: String, status: Int): String =
        runCatching { GenteJson.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull }.getOrNull()
            ?: when (status) { 401 -> "invalid_token"; 402 -> "out_of_credit"; 429 -> "rate_limited"; in 500..599 -> "server"; else -> "unknown" }

    private inline fun <reified T> JsonElement.to(): T = GenteJson.decodeFromJsonElement(this)

    suspend fun health(): Boolean = runCatching { call("/v1/health", auth = false) }.isSuccess
    suspend fun plan(): Plan = call("/v1/me/plan").to()
    suspend fun balance(): Balance = call("/v1/balance").to()
    suspend fun consumeMessage(messageId: String): Consume = try {
        call("/v1/messages/consume", "POST", buildJsonObject { put("messageId", messageId); put("source", "app") }).to()
    } catch (e: CloudException) {
        if (e.status == 402) Consume(false) else throw e
    }

    suspend fun search(query: String, n: Int = 5): SearchResponse =
        call("/v1/proxy/search", "POST", buildJsonObject { put("query", query); put("numResults", n) }).to()

    suspend fun createImage(prompt: String): MediaJob =
        call("/v1/proxy/media", "POST", buildJsonObject { put("model", "flux-schnell"); put("prompt", prompt); put("imageSize", "square_hd") }).to()

    suspend fun mediaJob(id: String): MediaJob = call("/v1/proxy/media/$id").to()

    suspend fun startBrowser(maxSeconds: Int = 900): SessionStart =
        call("/v1/sessions", "POST", buildJsonObject { put("vendor", "browserbase"); put("taskKind", "browser"); put("maxSeconds", maxSeconds) }).to()
    suspend fun heartbeat(id: String) = call("/v1/sessions/$id/heartbeat", "POST")
    suspend fun stopSession(id: String) = call("/v1/sessions/$id/stop", "POST")

    suspend fun verifyPlayPurchase(productId: String, purchaseToken: String, kind: String): PlayVerify =
        call("/v1/billing/play/verify", "POST", buildJsonObject {
            put("packageName", "com.deskhead.gente"); put("productId", productId); put("purchaseToken", purchaseToken); put("kind", kind)
        }).to()

    /** Deletes the Gente Cloud account and everything the server has. Returns the receipt. */
    suspend fun deleteAccount(): AccountDeleted = call("/v1/me", "DELETE", buildJsonObject { put("confirm", "DELETE") }).to()
    suspend fun receipts(): Receipts = call("/v1/me/data/receipts").to()
    suspend fun myData(): MyData = call("/v1/me/data").to()
    suspend fun accountToken(): AccountToken = call("/v1/store/account-token").to()
    suspend fun playPlans(): PlanOffers = call("/v1/billing/plans?channel=play", auth = false).to()

    /** Report an AI reply. By default only the reason and a message id leave the phone. */
    suspend fun reportAiOutput(messageId: String, reason: String, sharedText: String?) =
        call("/v1/support/tickets", "POST", buildJsonObject {
            put("category", "ai_output_report")
            put("subject", "AI reply report: $reason")
            put("body", buildString {
                append("messageId=").append(messageId).append("\nreason=").append(reason)
                if (sharedText != null) append("\nshared_by_user=\n").append(sharedText)
            })
            put("appVersion", "android")
        })

    fun ttsRequest(text: String, language: String): Pair<String, ByteArray> =
        "$base/v1/proxy/tts" to GenteJson.encodeToString(JsonElement.serializer(), buildJsonObject { put("text", text); put("language", language) }).toByteArray()

    /**
     * Streams a reply from /v1/inference/chat/completions (OpenAI-compatible SSE).
     * The server answers with a stub (x-gente-fast-stub: 1) until the GPU server is live.
     */
    fun streamChat(messages: List<WireMessage>, tools: JsonArray?): Flow<InferenceEvent> = callbackFlow {
        val body = buildJsonObject {
            put("model", "swift-1.5-27b")
            put("stream", true)
            put("messages", GenteJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(WireMessage.serializer()), messages))
            if (tools != null) put("tools", tools)
        }
        val req = request("/v1/inference/chat/completions", "POST", body)
        val call = http.newCall(req)
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { close(CloudException("offline", 0)) }
            override fun onResponse(call: Call, response: Response) {
                response.use { r ->
                    if (!r.isSuccessful) { close(CloudException(errorCode(r.body.string(), r.code), r.code)); return }
                    val stub = r.header("x-gente-fast-stub") == "1"
                    val ct = r.header("content-type").orEmpty()
                    if (!ct.contains("event-stream")) {
                        // Non-streamed JSON (the stub may answer this way).
                        val o = GenteJson.parseToJsonElement(r.body.string()).jsonObject
                        val msg = o["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("message")?.jsonObject
                        msg?.get("content")?.jsonPrimitive?.contentOrNull?.let { trySend(InferenceEvent.Text(it)) }
                        trySend(InferenceEvent.Done(stub)); close(); return
                    }
                    val parser = SseToolAccumulator()
                    val src = r.body.source()
                    while (!src.exhausted()) {
                        val line = src.readUtf8Line() ?: break
                        parser.feed(line).forEach { trySend(it) }
                        if (parser.done) break
                    }
                    parser.flushTools().forEach { trySend(it) }
                    trySend(InferenceEvent.Done(stub))
                    close()
                }
            }
        })
        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)
}

/** Turns SSE lines into text deltas and complete tool calls. */
class SseToolAccumulator {
    private val ids = HashMap<Int, String>()
    private val names = HashMap<Int, String>()
    private val args = HashMap<Int, StringBuilder>()
    var done = false
        private set

    fun feed(line: String): List<InferenceEvent> {
        if (!line.startsWith("data:")) return emptyList()
        val data = line.removePrefix("data:").trim()
        if (data == "[DONE]") { done = true; return emptyList() }
        val o = runCatching { GenteJson.parseToJsonElement(data).jsonObject }.getOrNull() ?: return emptyList()
        val delta = o["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("delta")?.jsonObject ?: return emptyList()
        val out = mutableListOf<InferenceEvent>()
        delta["content"]?.let { if (it is JsonPrimitive) it.contentOrNull?.takeIf { s -> s.isNotEmpty() }?.let { s -> out += InferenceEvent.Text(s) } }
        (delta["tool_calls"] as? JsonArray)?.forEach { tc ->
            val t = tc.jsonObject
            val i = t["index"]?.jsonPrimitive?.intOrNull ?: 0
            t["id"]?.jsonPrimitive?.contentOrNull?.let { ids[i] = it }
            val f = t["function"]?.jsonObject
            f?.get("name")?.jsonPrimitive?.contentOrNull?.let { names[i] = it }
            f?.get("arguments")?.jsonPrimitive?.contentOrNull?.let { args.getOrPut(i) { StringBuilder() }.append(it) }
        }
        return out
    }

    fun flushTools(): List<InferenceEvent> = names.keys.sorted().map { i ->
        InferenceEvent.ToolCall(ids[i] ?: "call_$i", names.getValue(i), args[i]?.toString() ?: "{}")
    }.also { ids.clear(); names.clear(); args.clear() }
}

@Suppress("unused")
private fun JsonObject.intOr(key: String, def: Int) = this[key]?.jsonPrimitive?.int ?: def

internal fun toolSchema(name: String, description: String, props: Map<String, String>, required: List<String>): JsonObject = buildJsonObject {
    put("type", "function")
    put("function", buildJsonObject {
        put("name", name)
        put("description", description)
        put("parameters", buildJsonObject {
            put("type", "object")
            put("properties", buildJsonObject { props.forEach { (k, v) -> put(k, buildJsonObject { put("type", "string"); put("description", v) }) } })
            put("required", buildJsonArray { required.forEach { add(JsonPrimitive(it)) } })
        })
    })
}
