package com.deskhead.gente.agent

import com.deskhead.gente.data.ApprovalEntity
import com.deskhead.gente.data.GenteDao
import com.deskhead.gente.data.MemoryEntity
import com.deskhead.gente.data.MessageEntity
import com.deskhead.gente.net.WireMessage
import com.deskhead.gente.net.toolSchema
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.JsonArray
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Things that always need a person's yes. There is no "always allow" for these. */
enum class ApprovalKind { MONEY, SEND_AS_USER, DELETE_DATA, LEGAL }

object ApprovalPolicy {
    private val byTool = mapOf(
        "buy" to ApprovalKind.MONEY,
        "pay" to ApprovalKind.MONEY,
        "send_email" to ApprovalKind.SEND_AS_USER,
        "send_message" to ApprovalKind.SEND_AS_USER,
        "post" to ApprovalKind.SEND_AS_USER,
        "delete_my_data" to ApprovalKind.DELETE_DATA,
        "accept_terms" to ApprovalKind.LEGAL,
    )
    private val words = listOf(
        ApprovalKind.MONEY to listOf("pay", "buy", "purchase", "checkout", "order", "subscribe", "transfer", "invoice", "tip", "donate"),
        ApprovalKind.SEND_AS_USER to listOf("send", "reply", "post", "publish", "tweet", "email", "message", "invite", "comment"),
        ApprovalKind.DELETE_DATA to listOf("delete", "remove", "erase", "wipe", "destroy", "trash", "unsubscribe", "cancel"),
        ApprovalKind.LEGAL to listOf("terms", "agree", "accept", "sign", "contract", "consent", "tos", "eula"),
    )

    /** Returns the kind of approval needed, or null for safe tools. Unknown tools that look risky still ask. */
    fun classify(tool: String, argumentsJson: String = ""): ApprovalKind? {
        byTool[tool]?.let { return it }
        if (tool in SAFE_TOOLS) return null
        val hay = (tool.replace('_', ' ') + " " + argumentsJson).lowercase()
        return words.firstOrNull { (_, ws) -> ws.any { Regex("\\b$it").containsMatchIn(hay) } }?.first
    }

    val SAFE_TOOLS = setOf("web_search", "remember", "create_image", "open_browser", "desktop_task")
}

/** Waits for a person's decision. Approvals can come from this phone, the paired desktop, or a routine push. */
class ApprovalCenter(private val dao: GenteDao, private val clock: () -> Long = System::currentTimeMillis) {
    private val waiting = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()

    suspend fun ask(kind: ApprovalKind, title: String, detail: String, source: String = "phone", id: String = UUID.randomUUID().toString()): Boolean {
        val d = CompletableDeferred<Boolean>()
        waiting[id] = d
        dao.upsertApproval(ApprovalEntity(id, kind.name.lowercase(), title, detail, source, "pending", clock()))
        return d.await()
    }

    /** Records an approval that something else is waiting on (desktop, push). */
    suspend fun record(id: String, kind: String, title: String, detail: String, source: String) {
        dao.upsertApproval(ApprovalEntity(id, kind, title, detail, source, "pending", clock()))
    }

    suspend fun decide(id: String, approved: Boolean): ApprovalEntity? {
        val a = dao.approval(id) ?: return null
        val done = a.copy(status = if (approved) "approved" else "declined", decidedAt = clock())
        dao.upsertApproval(done)
        waiting.remove(id)?.complete(approved)
        return done
    }
}

/**
 * Builds the smallest context an answer needs: the fixed system prompt, a few memories that
 * match the question, and the recent turns of this one chat. Never other chats, never files.
 */
object ContextBuilder {
    /** Must stay byte-for-byte the same for everyone so the server can cache it. */
    const val SYSTEM_PROMPT =
        "You are Gente, a private assistant made by DeskHead Inc. You work for one person. " +
            "Be brief, warm and plain-spoken. Answer in the language the person writes in. " +
            "Use tools when they help. Never pay, send messages as the person, delete their data or accept legal terms " +
            "without calling the matching tool, which asks them first. If a tool says it is not available, say so simply."

    const val MAX_TURNS = 16
    const val MAX_MEMORIES = 5

    fun build(history: List<MessageEntity>, memories: List<MemoryEntity>, now: String? = null): List<WireMessage> {
        val last = history.filter { it.role == "user" || it.role == "assistant" }.filter { it.text.isNotBlank() }.takeLast(MAX_TURNS)
        val question = last.lastOrNull { it.role == "user" }?.text.orEmpty()
        val relevant = relevantMemories(question, memories)
        val out = mutableListOf(WireMessage("system", SYSTEM_PROMPT))
        if (relevant.isNotEmpty() || now != null) {
            out += WireMessage("system", buildString {
                now?.let { append("Now: ").append(it).append('\n') }
                if (relevant.isNotEmpty()) {
                    append("Things the person asked you to remember:\n")
                    relevant.forEach { append("- ").append(it.text).append('\n') }
                }
            }.trim())
        }
        last.forEach { out += WireMessage(it.role, it.text) }
        return out
    }

    fun relevantMemories(question: String, memories: List<MemoryEntity>): List<MemoryEntity> {
        val q = words(question)
        if (q.isEmpty()) return emptyList()
        return memories.map { it to words(it.text).intersect(q).size }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
            .take(MAX_MEMORIES)
            .map { it.first }
    }

    private fun words(s: String) = s.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.length > 3 }.toSet()

    fun tools(desktopPaired: Boolean): JsonArray = JsonArray(buildList {
        add(toolSchema("web_search", "Search the web.", mapOf("query" to "What to search for"), listOf("query")))
        add(toolSchema("remember", "Save a fact about the person on their phone.", mapOf("fact" to "The fact"), listOf("fact")))
        add(toolSchema("create_image", "Make an image.", mapOf("prompt" to "What to draw"), listOf("prompt")))
        add(toolSchema("open_browser", "Open an online browser to do a task on a website.", mapOf("task" to "What to do"), listOf("task")))
        add(toolSchema("send_email", "Send an email as the person. Always asks first.", mapOf("to" to "Recipient", "subject" to "Subject", "body" to "Body"), listOf("to", "subject", "body")))
        add(toolSchema("buy", "Buy or pay for something. Always asks first.", mapOf("item" to "What", "amount" to "Price with currency"), listOf("item", "amount")))
        add(toolSchema("delete_my_data", "Delete some of the person's data. Always asks first.", mapOf("what" to "What to delete"), listOf("what")))
        add(toolSchema("accept_terms", "Accept legal terms. Always asks first.", mapOf("service" to "Which service", "summary" to "What the terms say"), listOf("service")))
        if (desktopPaired) add(toolSchema("desktop_task", "Do a task on the person's own computer.", mapOf("task" to "What to do"), listOf("task")))
    })
}
