package com.deskhead.gente.sync

import com.deskhead.gente.agent.ApprovalCenter
import com.deskhead.gente.data.ChatEntity
import com.deskhead.gente.data.DataEventEntity
import com.deskhead.gente.data.GenteDao
import com.deskhead.gente.data.MemoryEntity
import com.deskhead.gente.data.MessageEntity
import com.deskhead.gente.data.PairedDeviceEntity
import com.deskhead.gente.net.CloudException
import com.deskhead.gente.net.GenteJson
import com.deskhead.gente.net.WireMessage
import com.deskhead.gente.security.Sealer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Talks to the ciphertext-only relay: POST /v1/relay/:channel and GET /v1/relay/:channel?after=n. */
class RelayClient(private val base: String, private val http: OkHttpClient, private val token: suspend () -> String?) {
    data class Item(val seq: Long, val env: LinkCrypto.Envelope)
    @Serializable data class Raw(val seq: Long, val envelope: String)
    @Serializable data class Page(val envelopes: List<Raw> = emptyList())

    suspend fun post(channel: String, env: LinkCrypto.Envelope) = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$base/v1/relay/$channel")
            .header("Authorization", "Bearer ${token() ?: throw CloudException("missing_token", 401)}")
            .post(LinkCrypto.encode(env).toRequestBody("application/json".toMediaType())).build()
        val ok = try { http.newCall(req).execute().use { it.isSuccessful to it.code } } catch (_: IOException) { throw CloudException("offline", 0) }
        if (!ok.first) throw CloudException(if (ok.second == 404) "relay_not_ready" else "relay_failed", ok.second)
    }

    suspend fun poll(channel: String, after: Long): List<Item> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$base/v1/relay/$channel?after=$after")
            .header("Authorization", "Bearer ${token() ?: throw CloudException("missing_token", 401)}").get().build()
        try {
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) throw CloudException(if (r.code == 404) "relay_not_ready" else "relay_failed", r.code)
                GenteJson.decodeFromString(Page.serializer(), r.body.string()).envelopes.mapNotNull { raw ->
                    runCatching { Item(raw.seq, LinkCrypto.decode(String(java.util.Base64.getDecoder().decode(raw.envelope)))) }.getOrNull()
                }
            }
        } catch (_: IOException) { throw CloudException("offline", 0) }
    }
}

sealed interface LinkEvent {
    data class Paired(val deviceId: String, val name: String) : LinkEvent
    data class OpenChat(val chatId: String) : LinkEvent
    data class TaskStatus(val taskId: String, val state: String, val text: String) : LinkEvent
}

@Serializable data class SyncedMessage(val id: String, val role: String, val text: String, val createdAt: Long, val ranOn: String? = null)

/**
 * Phone side of Gente Link: pairing, encrypted sync of chats/memory/projects, desktop tasks,
 * approvals from the phone, Private mode (desktop's local AI) and chat handoff.
 */
class LinkService(
    private val dao: GenteDao,
    private val sealer: Sealer,
    private val relay: RelayClient,
    private val approvals: ApprovalCenter,
    private val phoneName: String,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val lock = Mutex()
    private val _events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 32)
    val events: SharedFlow<LinkEvent> = _events
    private val _safety = MutableStateFlow<String?>(null)
    val safetyCode: StateFlow<String?> = _safety
    private val privateStreams = ConcurrentHashMap<String, Channel<String?>>()

    private fun keysOf(d: PairedDeviceEntity) = GenteJson.decodeFromString(LinkCrypto.Keys.serializer(), String(sealer.open(d.sealedKeys)))
    private fun session(k: LinkCrypto.Keys) = LinkCrypto.Session(LinkCrypto.unb64(k.phonePriv), LinkCrypto.unb64(k.desktopPk), LinkCrypto.unb64(k.secret), iAmPhone = true)

    /** Scan result -> hello sent. Returns the safety code to compare with the desktop screen. */
    suspend fun pair(qr: String): String {
        val offer = LinkCrypto.parseQr(qr) ?: throw CloudException("bad_qr", 0)
        val (priv, pub) = LinkCrypto.newKeyPair()
        val keys = LinkCrypto.Keys(LinkCrypto.b64(priv), LinkCrypto.b64(pub), LinkCrypto.b64(offer.desktopPk), LinkCrypto.b64(offer.secret))
        val s = session(keys)
        val hello = buildJsonObject { put("type", "hello"); put("phoneName", phoneName); put("at", clock()) }
        relay.post(s.channel, s.seal(hello.toString().toByteArray(), 1, epk = pub))
        dao.upsertDevice(
            PairedDeviceEntity(offer.desktopId, offer.name, s.channel, sealer.seal(GenteJson.encodeToString(LinkCrypto.Keys.serializer(), keys.copy(sendSeq = 1)).toByteArray()), clock(), clock()),
        )
        dao.logEvent(DataEventEntity(at = clock(), kind = "pair", detail = "Paired with ${offer.name}"))
        _safety.value = s.safetyCode
        return s.safetyCode
    }

    suspend fun unpair(deviceId: String) {
        runCatching { send(deviceId, buildJsonObject { put("type", "unpair") }) }
        dao.deleteDevice(deviceId)
        dao.logEvent(DataEventEntity(at = clock(), kind = "delete", detail = "Unpaired a computer"))
    }

    suspend fun firstDevice(): PairedDeviceEntity? = dao.devicesNow().firstOrNull()

    private suspend fun send(deviceId: String, msg: JsonObject) = lock.withLock {
        val d = dao.devicesNow().first { it.id == deviceId }
        val k = keysOf(d)
        val next = k.sendSeq + 1
        relay.post(d.channel, session(k).seal(msg.toString().toByteArray(), next))
        dao.upsertDevice(d.copy(sealedKeys = sealer.seal(GenteJson.encodeToString(LinkCrypto.Keys.serializer(), k.copy(sendSeq = next)).toByteArray())))
    }

    /** End-to-end encrypted sync of one chat with all its messages. */
    suspend fun pushChat(chatId: String) {
        val d = firstDevice() ?: return
        val c = dao.chat(chatId) ?: return
        val msgs = dao.messagesNow(chatId).map { SyncedMessage(it.id, it.role, it.text, it.createdAt, it.ranOn) }
        send(d.id, buildJsonObject {
            put("type", "sync.chat"); put("id", c.id); put("title", c.title); put("updatedAt", c.updatedAt)
            put("messages", GenteJson.encodeToJsonElement(ListSerializer(SyncedMessage.serializer()), msgs))
        })
        dao.logEvent(DataEventEntity(at = clock(), kind = "sync", detail = "Synced 1 chat (${msgs.size} messages), encrypted"))
    }

    suspend fun pushMemories() {
        val d = firstDevice() ?: return
        val mem = dao.allMemories()
        send(d.id, buildJsonObject {
            put("type", "sync.memory")
            put("items", kotlinx.serialization.json.JsonArray(mem.map { buildJsonObject { put("id", it.id); put("text", it.text); put("createdAt", it.createdAt) } }))
        })
        dao.logEvent(DataEventEntity(at = clock(), kind = "sync", detail = "Synced ${mem.size} memories, encrypted"))
    }

    suspend fun handoff(chatId: String) {
        val d = firstDevice() ?: throw CloudException("no_desktop", 0)
        pushChat(chatId)
        send(d.id, buildJsonObject { put("type", "handoff"); put("chatId", chatId) })
    }

    suspend fun startDesktopTask(text: String): String {
        val d = firstDevice() ?: throw CloudException("no_desktop", 0)
        val id = UUID.randomUUID().toString()
        send(d.id, buildJsonObject { put("type", "task.start"); put("taskId", id); put("text", text) })
        return id
    }

    suspend fun answerApproval(id: String, approved: Boolean) {
        val d = firstDevice() ?: return
        send(d.id, buildJsonObject { put("type", "approval.decision"); put("id", id); put("approved", approved) })
    }

    /** Private mode: the desktop's own model answers. Context goes through the relay encrypted. */
    fun privateInfer(messages: List<WireMessage>): Flow<String> = flow {
        val d = firstDevice() ?: throw CloudException("no_desktop", 0)
        val req = UUID.randomUUID().toString()
        val ch = Channel<String?>(Channel.UNLIMITED)
        privateStreams[req] = ch
        try {
            send(d.id, buildJsonObject {
                put("type", "private.infer"); put("reqId", req)
                put("messages", GenteJson.encodeToJsonElement(ListSerializer(WireMessage.serializer()), messages))
            })
            var idle = 0
            while (true) {
                val got = withTimeoutOrNull(700) { ch.receive() }
                if (got == null) {
                    pollOnce()
                    if (++idle > 120) throw CloudException("desktop_timeout", 0)
                    continue
                }
                idle = 0
                emit(got)
                // drain what is ready, stop on the end marker
                var end = false
                while (true) {
                    val r = ch.tryReceive()
                    if (!r.isSuccess) break
                    val v = r.getOrNull()
                    if (v == null) { end = true; break } else emit(v)
                }
                if (end) break
            }
        } finally { privateStreams.remove(req) }
    }

    /** Fetch and handle everything new from every paired desktop. */
    suspend fun pollOnce() {
        for (d in dao.devicesNow()) {
            val k = keysOf(d)
            val s = session(k)
            val items = relay.poll(d.channel, d.lastSeq)
            var last = d.lastSeq
            var recv = k.recvSeq
            for (it in items) {
                last = maxOf(last, it.seq)
                if (it.env.from == "phone") continue
                if (it.env.seq <= recv) continue // replay
                val plain = runCatching { s.open(it.env) }.getOrNull() ?: continue // tampered or foreign
                recv = it.env.seq
                handle(d, GenteJson.parseToJsonElement(String(plain)).jsonObject)
            }
            if (last != d.lastSeq || recv != k.recvSeq) {
                val fresh = dao.devicesNow().first { it.id == d.id }
                val fk = keysOf(fresh)
                dao.upsertDevice(fresh.copy(lastSeq = last, lastSeen = clock(), sealedKeys = sealer.seal(GenteJson.encodeToString(LinkCrypto.Keys.serializer(), fk.copy(recvSeq = recv)).toByteArray())))
            }
        }
    }

    private suspend fun handle(d: PairedDeviceEntity, m: JsonObject) {
        fun str(k: String) = m[k]?.jsonPrimitive?.contentOrNull.orEmpty()
        when (str("type")) {
            "hello_ack" -> _events.emit(LinkEvent.Paired(d.id, d.name))
            "sync.chat" -> {
                val id = str("id")
                dao.upsertChat(ChatEntity(id, str("title"), dao.chat(id)?.createdAt ?: clock(), m["updatedAt"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: clock()))
                m["messages"]?.let { GenteJson.decodeFromJsonElement(ListSerializer(SyncedMessage.serializer()), it) }?.forEach {
                    dao.upsertMessage(MessageEntity(it.id, id, it.role, it.text, it.createdAt, it.ranOn))
                }
                dao.logEvent(DataEventEntity(at = clock(), kind = "sync", detail = "Got 1 chat from ${d.name}, encrypted"))
            }
            "sync.memory" -> m["items"]?.let { it as? kotlinx.serialization.json.JsonArray }?.forEach { e ->
                val o = e.jsonObject
                dao.upsertMemory(MemoryEntity(o["id"]!!.jsonPrimitive.content, o["text"]!!.jsonPrimitive.content, o["createdAt"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: clock()))
            }
            "handoff" -> _events.emit(LinkEvent.OpenChat(str("chatId")))
            "task.status" -> _events.emit(LinkEvent.TaskStatus(str("taskId"), str("state"), str("text")))
            "approval.request" -> approvals.record(str("id"), str("kind").ifEmpty { "other" }, str("title"), str("detail"), source = "desktop")
            "private.delta" -> str("text").takeIf { it.isNotEmpty() }?.let { privateStreams[str("reqId")]?.trySend(it) }
            "private.done" -> privateStreams[str("reqId")]?.trySend(null)
            "unpair" -> dao.deleteDevice(d.id)
        }
    }

    /** Keeps polling while the app is open. */
    suspend fun loop(active: () -> Boolean) {
        while (true) {
            if (active() && dao.devicesNow().isNotEmpty()) runCatching { pollOnce() }
            delay(if (privateStreams.isEmpty()) 8_000 else 1_000)
        }
    }

    @Suppress("unused") private fun JsonObject.bool(k: String) = this[k]?.jsonPrimitive?.boolean ?: false
}
