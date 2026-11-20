package com.deskhead.gente.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.deskhead.gente.security.Sealer
import com.deskhead.gente.net.GenteJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

/** PKCE helpers, pure so they are unit tested. */
object Pkce {
    fun verifier(random: SecureRandom = SecureRandom()): String {
        val b = ByteArray(32).also { random.nextBytes(it) }
        return b64url(b)
    }
    fun challenge(verifier: String): String = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
    fun b64url(b: ByteArray): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b)
}

@Serializable
data class Tokens(
    val access_token: String,
    val refresh_token: String? = null,
    val expires_in: Long = 3600,
    val obtainedAt: Long = 0,
)

sealed interface AuthState {
    data object SignedOut : AuthState
    data object Working : AuthState
    data class SignedIn(val since: Long) : AuthState
}

/**
 * Sign in with Clerk through a Custom Tab, OAuth 2.0 authorization code + PKCE (public client).
 * Gente Cloud accepts Clerk OAuth access tokens (acceptsToken: session_token, oauth_token).
 * Tokens are sealed with the Android Keystore key and kept in noBackupFilesDir.
 */
class ClerkAuth(
    private val context: Context,
    private val keys: Sealer,
    private val http: OkHttpClient,
    private val frontendApi: String,
    private val clientId: String,
) {
    private val file = File(context.noBackupFilesDir, "auth.sealed")
    private val pending = File(context.noBackupFilesDir, "auth.pending")
    private val mutex = Mutex()
    private val _state = MutableStateFlow<AuthState>(if (file.exists()) AuthState.SignedIn(file.lastModified()) else AuthState.SignedOut)
    val state: StateFlow<AuthState> = _state

    fun start() {
        val verifier = Pkce.verifier()
        val st = Pkce.verifier()
        pending.writeBytes(keys.seal("$st\n$verifier".toByteArray()))
        val uri = Uri.Builder().scheme("https").authority(frontendApi).path("/oauth/authorize")
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", REDIRECT)
            .appendQueryParameter("scope", "profile email offline_access")
            .appendQueryParameter("code_challenge", Pkce.challenge(verifier))
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("state", st)
            .build()
        _state.value = AuthState.Working
        CustomTabsIntent.Builder().setShowTitle(true).setShareState(CustomTabsIntent.SHARE_STATE_OFF).build()
            .apply { intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK) }
            .launchUrl(context, uri)
    }

    /** Called by MainActivity with com.deskhead.gente://oauth/callback?code=...&state=... */
    suspend fun handleRedirect(uri: Uri): Boolean = withContext(Dispatchers.IO) {
        val code = uri.getQueryParameter("code")
        val st = uri.getQueryParameter("state")
        if (!pending.exists() || code == null) { _state.value = AuthState.SignedOut; return@withContext false }
        val (expectedState, verifier) = String(keys.open(pending.readBytes())).split("\n")
        pending.delete()
        if (st != expectedState) { _state.value = AuthState.SignedOut; return@withContext false }
        val ok = exchange(FormBody.Builder()
            .add("grant_type", "authorization_code").add("code", code).add("redirect_uri", REDIRECT)
            .add("client_id", clientId).add("code_verifier", verifier).build())
        _state.value = if (ok) AuthState.SignedIn(System.currentTimeMillis()) else AuthState.SignedOut
        ok
    }

    /** Fresh access token, refreshed when it is close to expiry. Null when signed out. */
    suspend fun token(): String? = mutex.withLock {
        val t = read() ?: return null
        val age = (System.currentTimeMillis() - t.obtainedAt) / 1000
        if (age < t.expires_in - 60) return t.access_token
        val rt = t.refresh_token ?: return t.access_token
        val ok = withContext(Dispatchers.IO) {
            exchange(FormBody.Builder().add("grant_type", "refresh_token").add("refresh_token", rt).add("client_id", clientId).build())
        }
        if (!ok) { signOut(); return null }
        read()?.access_token
    }

    fun signOut() {
        file.delete(); pending.delete()
        _state.value = AuthState.SignedOut
    }

    private fun exchange(form: FormBody): Boolean = runCatching {
        val req = Request.Builder().url("https://$frontendApi/oauth/token").post(form).build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) return false
            val t = GenteJson.decodeFromString(Tokens.serializer(), r.body.string()).copy(obtainedAt = System.currentTimeMillis())
            file.writeBytes(keys.seal(GenteJson.encodeToString(Tokens.serializer(), t).toByteArray()))
            true
        }
    }.getOrDefault(false)

    private fun read(): Tokens? = runCatching {
        GenteJson.decodeFromString(Tokens.serializer(), String(keys.open(file.readBytes())))
    }.getOrNull()

    companion object {
        const val REDIRECT = "com.deskhead.gente://oauth/callback"
    }
}
