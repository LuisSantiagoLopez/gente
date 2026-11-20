package com.deskhead.gente.sync

import com.deskhead.gente.net.GenteJson
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import kotlinx.serialization.Serializable
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Gente Link v1: phone <-> desktop, end-to-end encrypted. The relay in Gente Cloud only ever sees
 * the envelope (channel, sender, counter, nonce, ciphertext). See LINK-PROTOCOL.md.
 *
 * QR:      gente://link?v=1&id=<desktopId>&name=<name>&pk=<b64url X25519 public, 32 B>&s=<b64url secret, 16 B>
 * Keys:    shared = X25519(phonePriv, desktopPk)
 *          kP2D = HKDF-SHA256(shared, salt = s, info = "gente-link v1 phone->desktop", 32)
 *          kD2P = HKDF-SHA256(shared, salt = s, info = "gente-link v1 desktop->phone", 32)
 * Channel: b64url(SHA-256("gente-link v1 channel" || s))[0..22]
 * Seal:    AES-256-GCM, 12-byte random nonce, AAD = "gente-link/v1|<channel>|<from>|<seq>"
 * Safety:  4 digits from HKDF(shared, s, "gente-link v1 sas", 2) so both screens can be compared.
 */
object LinkCrypto {
    const val VERSION = 1
    private val rng = SecureRandom()

    data class QrOffer(val desktopId: String, val name: String, val desktopPk: ByteArray, val secret: ByteArray)

    @Serializable
    data class Envelope(val v: Int = VERSION, val from: String, val seq: Long, val n: String, val ct: String, val epk: String? = null)

    @Serializable
    data class Keys(val phonePriv: String, val phonePub: String, val desktopPk: String, val secret: String, val sendSeq: Long = 0, val recvSeq: Long = 0)

    fun b64(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    fun unb64(s: String): ByteArray = Base64.getUrlDecoder().decode(s)

    fun parseQr(text: String): QrOffer? = runCatching {
        val u = URI(text.trim())
        if (u.scheme != "gente" || u.host != "link") return null
        val q = u.rawQuery.split('&').associate { p -> p.substringBefore('=') to URLDecoder.decode(p.substringAfter('='), "UTF-8") }
        if (q["v"] != "1") return null
        val pk = unb64(q.getValue("pk")); val s = unb64(q.getValue("s"))
        require(pk.size == 32 && s.size >= 16)
        QrOffer(q.getValue("id"), q["name"] ?: "Computer", pk, s)
    }.getOrNull()

    fun qrFor(desktopId: String, name: String, desktopPub: ByteArray, secret: ByteArray): String =
        "gente://link?v=1&id=$desktopId&name=${java.net.URLEncoder.encode(name, "UTF-8")}&pk=${b64(desktopPub)}&s=${b64(secret)}"

    fun newKeyPair(): Pair<ByteArray, ByteArray> {
        val priv = X25519.generatePrivateKey()
        return priv to X25519.publicFromPrivate(priv)
    }

    fun newSecret(): ByteArray = ByteArray(16).also { rng.nextBytes(it) }

    fun channel(secret: ByteArray): String =
        b64(MessageDigest.getInstance("SHA-256").digest("gente-link v1 channel".toByteArray() + secret)).take(22)

    class Session(myPriv: ByteArray, peerPub: ByteArray, val secret: ByteArray, private val iAmPhone: Boolean) {
        private val shared = X25519.computeSharedSecret(myPriv, peerPub)
        private val p2d = Hkdf.computeHkdf("HMACSHA256", shared, secret, "gente-link v1 phone->desktop".toByteArray(), 32)
        private val d2p = Hkdf.computeHkdf("HMACSHA256", shared, secret, "gente-link v1 desktop->phone".toByteArray(), 32)
        val channel = channel(secret)
        val me = if (iAmPhone) "phone" else "desktop"
        val safetyCode: String = Hkdf.computeHkdf("HMACSHA256", shared, secret, "gente-link v1 sas".toByteArray(), 2)
            .let { (((it[0].toInt() and 0xff) shl 8) or (it[1].toInt() and 0xff)) % 10000 }.toString().padStart(4, '0')

        fun seal(plain: ByteArray, seq: Long, epk: ByteArray? = null): Envelope =
            sealWith(plain, seq, ByteArray(12).also { rng.nextBytes(it) }, epk)

        /** Fixed nonce: only for the shared cross-platform test vector. */
        internal fun sealWith(plain: ByteArray, seq: Long, nonce: ByteArray, epk: ByteArray? = null): Envelope {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(if (iAmPhone) p2d else d2p, "AES"), GCMParameterSpec(128, nonce))
            c.updateAAD(aad(me, seq))
            return Envelope(from = me, seq = seq, n = b64(nonce), ct = b64(c.doFinal(plain)), epk = epk?.let(::b64))
        }

        /** Throws if the envelope was changed, replayed under another counter, or sent by us. */
        fun open(e: Envelope): ByteArray {
            require(e.v == VERSION && e.from != me)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(if (iAmPhone) d2p else p2d, "AES"), GCMParameterSpec(128, unb64(e.n)))
            c.updateAAD(aad(e.from, e.seq))
            return c.doFinal(unb64(e.ct))
        }

        private fun aad(from: String, seq: Long) = "gente-link/v$VERSION|$channel|$from|$seq".toByteArray()
    }

    fun encode(e: Envelope): String = GenteJson.encodeToString(Envelope.serializer(), e)
    fun decode(s: String): Envelope = GenteJson.decodeFromString(Envelope.serializer(), s)
}
