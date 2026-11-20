package com.deskhead.gente.agent

import com.deskhead.gente.data.DataEventEntity
import com.deskhead.gente.data.GenteDao
import com.deskhead.gente.net.GenteJson
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Self-healing, same contract as desktop, cloud and iOS (docs/gente/self-heal-catalog.md):
 * failure ids, repair step ids and outcomes match, so fleet learning groups them.
 */
object Failure {
    const val SIGN_IN_EXPIRED = "sign-in-expired"
    const val RELAY_DOWN = "relay-down"
    const val CLOUD_MODEL_UNAVAILABLE = "cloud-model-unavailable"
    const val SLOW_REPLIES = "slow-replies"
}

object Step {
    const val REFRESH_SIGN_IN = "refresh-sign-in" // reconnect
    const val RESTART_RELAY = "restart-relay" // restart
    const val ANSWER_ON_THIS_COMPUTER = "answer-on-this-computer" // fallback
    const val ANSWER_FROM_CLOUD = "answer-from-cloud" // fallback
    const val RETRY_REQUEST = "retry-request" // retry (Android only)
}

enum class Outcome(val wire: String) { FIXED("fixed"), REPORTED("reported"), NEEDS_PERSON("needs-person"), STILL_TRYING("still-trying") }

/** One repair, as stored on the phone and (only with consent) sent. No content, no personal data. */
@Serializable
data class RepairEvent(
    val kind: String = "repair",
    val failureId: String,
    val outcome: String,
    val fixedBy: String? = null,
    val ms: Long? = null,
    val version: String,
    val platform: String = "android",
    val installId: String,
)

/** Where repairs go: always the local "Gente fixed itself" list; the fleet only with "Always send". */
class SelfHeal(
    private val dao: GenteDao,
    private val version: String,
    private val installId: () -> String,
    private val shareAlways: suspend () -> Boolean,
    private val selfHealUrl: String, // set at build time (GENTE_SELFHEAL_URL); empty sends nothing
    private val http: OkHttpClient? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** Two equal events within this window are one (a flaky link must not flood the list). */
    private val lastByFailure = HashMap<String, Pair<String, Long>>()

    suspend fun record(failureId: String, outcome: Outcome, fixedBy: String? = null, ms: Long? = null) {
        val now = clock()
        val prev = lastByFailure[failureId]
        if (prev != null && prev.first == outcome.wire && now - prev.second < 60_000) return
        lastByFailure[failureId] = outcome.wire to now
        val e = RepairEvent(failureId = failureId, outcome = outcome.wire, fixedBy = fixedBy, ms = ms, version = version, installId = installId())
        dao.logEvent(DataEventEntity(at = now, kind = "repair", detail = GenteJson.encodeToString(RepairEvent.serializer(), e)))
        val client = http
        if (selfHealUrl.isNotBlank() && client != null && shareAlways()) {
            // Never on the caller's thread: a repair can be recorded from the UI thread.
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching {
                val req = Request.Builder().url(selfHealUrl.trimEnd('/') + "/diagnostics")
                    .post(GenteJson.encodeToString(RepairEvent.serializer(), e).toRequestBody("application/json".toMediaType())).build()
                client.newCall(req).execute().close()
            } }
        }
    }

    companion object {
        /** First token later than this on the paired computer counts as slow (same as desktop: 20 s). */
        const val SLOW_REPLY_MS = 20_000L
        fun parse(detail: String): RepairEvent? = runCatching { GenteJson.decodeFromString(RepairEvent.serializer(), detail) }.getOrNull()
    }
}
