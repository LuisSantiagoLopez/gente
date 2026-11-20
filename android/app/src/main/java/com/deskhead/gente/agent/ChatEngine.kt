package com.deskhead.gente.agent

import com.deskhead.gente.data.ChatEntity
import com.deskhead.gente.data.FileEntity
import com.deskhead.gente.data.GenteDao
import com.deskhead.gente.data.MemoryEntity
import com.deskhead.gente.data.MessageEntity
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.CloudException
import com.deskhead.gente.net.GenteJson
import com.deskhead.gente.net.InferenceEvent
import com.deskhead.gente.net.WireFunction
import com.deskhead.gente.net.WireMessage
import com.deskhead.gente.net.WireToolCall
import com.deskhead.gente.sync.LinkService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

sealed interface Notice {
    data class Problem(val code: String) : Notice
    data object NeedsPlan : Notice
    data class LiveView(val url: String, val sessionId: String) : Notice
    data class LocationFallback(val wanted: AiLocation) : Notice
}

/** Badges stored on each assistant message. */
object Ran {
    const val CLOUD = "cloud"
    const val CLOUD_PREVIEW = "cloud_preview" // server stub until the GPU is live
    const val DESKTOP = "desktop"
    const val DEMO = "demo"
}

/**
 * Runs one turn: saves the question on the phone, picks where the answer is made, streams it,
 * runs tools (asking first for money, sending as the person, deleting data and legal terms).
 */
class ChatEngine(
    private val dao: GenteDao,
    private val cloud: CloudApi,
    private val link: LinkService,
    private val approvals: ApprovalCenter,
    private val settings: Settings,
    private val signedIn: () -> Boolean,
    private val filesDir: File,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val demoText: () -> String = { DEMO_REPLY },
) {
    private val _notices = MutableSharedFlow<Notice>(extraBufferCapacity = 16)
    val notices: SharedFlow<Notice> = _notices
    private val running = ConcurrentHashMap<String, Job>()

    fun isRunning(chatId: String) = running[chatId]?.isActive == true

    /** New chat id right away (no wait, so the screen opens instantly); the row is written in the background. */
    fun newChatNow(title: String = ""): String {
        val id = UUID.randomUUID().toString()
        scope.launch { if (dao.chat(id) == null) dao.upsertChat(ChatEntity(id, title, clock(), clock())) }
        return id
    }

    suspend fun newChat(title: String = ""): String {
        val id = UUID.randomUUID().toString()
        dao.upsertChat(ChatEntity(id, title, clock(), clock()))
        return id
    }

    fun stop(chatId: String) { running.remove(chatId)?.cancel() }

    fun send(chatId: String, text: String): Job {
        val job = scope.launch { turn(chatId, text.trim()) }
        running[chatId] = job
        job.invokeOnCompletion { running.remove(chatId, job) }
        return job
    }

    private suspend fun turn(chatId: String, text: String) {
        if (text.isEmpty()) return
        val now = clock()
        val chat = dao.chat(chatId) ?: ChatEntity(chatId, "", now, now)
        dao.upsertChat(chat.copy(title = chat.title.ifBlank { text.take(48) }, updatedAt = now))
        val userId = UUID.randomUUID().toString()
        dao.upsertMessage(MessageEntity(userId, chatId, "user", text, now))

        val replyId = UUID.randomUUID().toString()
        val prefs = settings.now()
        var where = prefs.aiLocation
        if (where == AiLocation.PHONE) { _notices.emit(Notice.LocationFallback(where)); where = AiLocation.CLOUD }
        if (where == AiLocation.DESKTOP && link.firstDevice() == null) { _notices.emit(Notice.LocationFallback(where)); where = AiLocation.CLOUD }
        if (where == AiLocation.CLOUD && !signedIn()) return demoReply(chatId, replyId)

        dao.upsertMessage(MessageEntity(replyId, chatId, "assistant", "", clock() + 1, ranOn = if (where == AiLocation.DESKTOP) Ran.DESKTOP else Ran.CLOUD, status = "streaming"))
        val acc = StringBuilder()
        try {
            if (where == AiLocation.CLOUD) {
                val ok = cloud.consumeMessage(userId)
                if (!ok.allowed) {
                    dao.updateMessage(replyId, "", "needs_plan"); _notices.emit(Notice.NeedsPlan); return
                }
            }
            val wire = ContextBuilder.build(dao.messagesNow(chatId).filter { it.id != replyId }, dao.allMemories()).toMutableList()
            var rounds = 0
            while (true) {
                val calls = mutableListOf<InferenceEvent.ToolCall>()
                var stub = false
                val stream: Flow<InferenceEvent> = if (where == AiLocation.DESKTOP) {
                    flow { link.privateInfer(wire).collect { emit(InferenceEvent.Text(it)) }; emit(InferenceEvent.Done(false)) }
                } else cloud.streamChat(wire, ContextBuilder.tools(link.firstDevice() != null))
                var lastWrite = 0L
                stream.collect { e ->
                    when (e) {
                        is InferenceEvent.Text -> {
                            acc.append(e.delta)
                            if (clock() - lastWrite > 50) { dao.updateMessage(replyId, acc.toString(), "streaming"); lastWrite = clock() }
                        }
                        is InferenceEvent.ToolCall -> calls += e
                        is InferenceEvent.Done -> stub = e.stub
                    }
                }
                if (stub) dao.upsertMessage(dao.messagesNow(chatId).first { it.id == replyId }.copy(ranOn = Ran.CLOUD_PREVIEW, text = acc.toString()))
                if (calls.isEmpty() || rounds++ >= 4) break
                wire += WireMessage("assistant", acc.toString().ifEmpty { null }, tool_calls = calls.map { WireToolCall(it.id, function = WireFunction(it.name, it.arguments)) })
                for (c in calls) {
                    val result = runTool(chatId, c)
                    wire += WireMessage("tool", result, tool_call_id = c.id)
                }
            }
            dao.updateMessage(replyId, acc.toString(), "done")
        } catch (e: kotlinx.coroutines.CancellationException) {
            dao.updateMessage(replyId, acc.toString(), "stopped"); throw e
        } catch (e: CloudException) {
            if (e.code == "plan_has_no_cloud" || e.status == 402) { dao.updateMessage(replyId, acc.toString(), "needs_plan"); _notices.emit(Notice.NeedsPlan) }
            else { dao.updateMessage(replyId, acc.toString(), "failed"); _notices.emit(Notice.Problem(e.code)) }
        } catch (e: Exception) {
            dao.updateMessage(replyId, acc.toString(), "failed"); _notices.emit(Notice.Problem("unknown"))
        }
    }

    /** Signed out: a plain local reply so the app is usable offline. Clearly badged as a demo. */
    private suspend fun demoReply(chatId: String, replyId: String) {
        dao.upsertMessage(MessageEntity(replyId, chatId, "assistant", "", clock() + 1, ranOn = Ran.DEMO, status = "streaming"))
        val words = demoText().split(" ")
        val sb = StringBuilder()
        for (w in words) { sb.append(w).append(' '); dao.updateMessage(replyId, sb.toString(), "streaming"); delay(28) }
        dao.updateMessage(replyId, sb.toString().trim(), "done")
    }

    private suspend fun runTool(chatId: String, c: InferenceEvent.ToolCall): String {
        val args = runCatching { GenteJson.parseToJsonElement(c.arguments).jsonObject }.getOrNull()
        fun a(k: String) = args?.get(k)?.jsonPrimitive?.contentOrNull.orEmpty()
        val kind = ApprovalPolicy.classify(c.name, c.arguments)
        val note = UUID.randomUUID().toString()
        suspend fun chip(text: String) = dao.upsertMessage(MessageEntity(note, chatId, "tool", text, clock()))
        if (kind != null) {
            val title = when (c.name) {
                "send_email" -> "Send an email to ${a("to")}"
                "buy" -> "Pay ${a("amount")} for ${a("item")}"
                "delete_my_data" -> "Delete ${a("what")}"
                "accept_terms" -> "Accept the terms of ${a("service")}"
                else -> c.name.replace('_', ' ')
            }
            chip("approval:${kind.name.lowercase()}:$title")
            val yes = approvals.ask(kind, title, detailOf(c.name, args?.toString().orEmpty()))
            chip(if (yes) "approved:$title" else "declined:$title")
            if (!yes) return "The person said no. Do not do it."
            return when (c.name) {
                "delete_my_data" -> "Approved. Tell the person to open Where's my data to pick exactly what to delete."
                else -> "Approved, but this action is not connected yet. Say so plainly."
            }
        }
        return try {
            when (c.name) {
                "web_search" -> {
                    chip("search:${a("query")}")
                    val r = cloud.search(a("query"))
                    r.results.take(5).joinToString("\n") { "- ${it.title} (${it.url}): ${it.text.orEmpty().take(400)}" }.ifEmpty { "No results." }
                }
                "remember" -> {
                    dao.upsertMemory(MemoryEntity(UUID.randomUUID().toString(), a("fact"), clock()))
                    chip("remember:${a("fact")}")
                    "Saved on the phone."
                }
                "create_image" -> {
                    chip("image:${a("prompt")}")
                    var job = cloud.createImage(a("prompt"))
                    repeat(20) { if (job.status == "completed" || job.status == "failed") return@repeat; delay(2000); job = cloud.mediaJob(job.jobId) }
                    if (job.stub) return "Image making is not available right now."
                    job.files.firstOrNull()?.let { f -> saveFile(f.url, f.contentType ?: "image/png") }
                    if (job.status == "completed") "Image made and saved on the phone." else "The image did not finish."
                }
                "open_browser" -> {
                    val s = cloud.startBrowser()
                    s.connection?.liveViewUrl?.let { _notices.emit(Notice.LiveView(it, s.sessionId)) }
                    chip("browser:${a("task")}")
                    "An online browser is open and the person can watch it live."
                }
                "desktop_task" -> {
                    link.startDesktopTask(a("task"))
                    chip("desktop:${a("task")}")
                    "Sent to the person's computer. It will report back."
                }
                else -> "That tool is not available."
            }
        } catch (e: CloudException) {
            "That tool is not available right now (${e.code})."
        }
    }

    private fun detailOf(tool: String, args: String) = "$tool $args".take(600)

    private suspend fun saveFile(url: String, mime: String) {
        val req = Request.Builder().url(url).build()
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            cloud.http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return@use
                val id = UUID.randomUUID().toString()
                val f = File(File(filesDir, "media").apply { mkdirs() }, "$id.${if (mime.contains("png")) "png" else "jpg"}")
                f.outputStream().use { r.body.byteStream().copyTo(it) }
                dao.upsertFile(FileEntity(id, f.name, mime, f.length(), f.absolutePath, clock()))
            }
        }
    }

    companion object {
        const val DEMO_REPLY = "Hi, I'm Gente. You're not signed in, so this is a sample reply made on your phone. " +
            "Sign in to get real answers. Your chats stay on this phone either way."
    }
}
