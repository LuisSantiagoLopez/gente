package com.deskhead.gente.net

import okhttp3.Interceptor
import okhttp3.Response

/** A record of one request. Never holds content. */
data class EgressRecord(
    val at: Long,
    val service: Service,
    val method: String,
    val path: String,
    val bytesOut: Long,
    val bytesIn: Long,
    val status: Int,
)

enum class Service(val carriesChat: Boolean) {
    AI(true), // /v1/inference: the only place chat text goes, and it is not stored
    RELAY(false), // ciphertext only
    SEARCH(false),
    VOICE(false),
    MEDIA(false),
    APPS(false),
    COMPUTER(false),
    BILLING(false),
    ACCOUNT(false),
    SIGN_IN(false),
    SUPPORT(false),
    OTHER(false);

    companion object {
        fun of(host: String, path: String): Service = when {
            host.contains("clerk") -> SIGN_IN
            path.startsWith("/v1/inference") -> AI
            path.startsWith("/v1/relay") -> RELAY
            path.startsWith("/v1/proxy/search") -> SEARCH
            path.startsWith("/v1/proxy/tts") || path.startsWith("/v1/tts") -> VOICE
            path.startsWith("/v1/proxy/media") -> MEDIA
            path.startsWith("/v1/proxy/composio") -> APPS
            path.startsWith("/v1/sessions") || path.startsWith("/v1/estimate") -> COMPUTER
            path.startsWith("/v1/billing") || path.startsWith("/v1/plans") -> BILLING
            path.startsWith("/v1/me") || path.startsWith("/v1/balance") || path.startsWith("/v1/messages") -> ACCOUNT
            path.startsWith("/v1/support") || path.startsWith("/v1/diagnostics") -> SUPPORT
            else -> OTHER
        }
    }
}

fun interface EgressSink {
    fun record(r: EgressRecord)
}

/** Logs time, service and size of every request for the "What left your phone" screen. */
class EgressInterceptor(private val sink: EgressSink, private val clock: () -> Long = System::currentTimeMillis) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val out = req.body?.contentLength()?.coerceAtLeast(0) ?: 0
        val service = Service.of(req.url.host, req.url.encodedPath)
        val started = clock()
        return try {
            val res = chain.proceed(req)
            val inLen = res.body.contentLength().coerceAtLeast(0)
            sink.record(EgressRecord(started, service, req.method, req.url.encodedPath, out, inLen, res.code))
            res
        } catch (e: Exception) {
            sink.record(EgressRecord(started, service, req.method, req.url.encodedPath, out, 0, -1))
            throw e
        }
    }
}
