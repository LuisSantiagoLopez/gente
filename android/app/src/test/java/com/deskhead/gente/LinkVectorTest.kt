package com.deskhead.gente

import com.deskhead.gente.net.GenteJson
import com.deskhead.gente.sync.LinkCrypto
import com.google.crypto.tink.subtle.X25519
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** The shared Gente Link v1 vector (gente-mobile-proof/gente-link-v1-test-vector.json) used by iOS, desktop and Android. */
class LinkVectorTest {
    private val v = GenteJson.parseToJsonElement(javaClass.classLoader!!.getResource("gente-link-v1-test-vector.json")!!.readText()).jsonObject
    private fun s(k: String) = v.getValue(k).jsonPrimitive.content
    private val env = GenteJson.decodeFromJsonElement(LinkCrypto.Envelope.serializer(), v.getValue("envelope"))

    @Test fun keysChannelAndSafetyCodeMatch() {
        assertArrayEquals(LinkCrypto.unb64(s("phonePub")), X25519.publicFromPrivate(LinkCrypto.unb64(s("phonePriv"))))
        assertArrayEquals(LinkCrypto.unb64(s("deskPub")), X25519.publicFromPrivate(LinkCrypto.unb64(s("deskPriv"))))
        assertEquals(s("channel"), LinkCrypto.channel(LinkCrypto.unb64(s("secret"))))
        val phone = LinkCrypto.Session(LinkCrypto.unb64(s("phonePriv")), LinkCrypto.unb64(s("deskPub")), LinkCrypto.unb64(s("secret")), iAmPhone = true)
        assertEquals(s("code"), phone.safetyCode)
    }

    @Test fun phoneOpensTheDesktopEnvelope() {
        val phone = LinkCrypto.Session(LinkCrypto.unb64(s("phonePriv")), LinkCrypto.unb64(s("deskPub")), LinkCrypto.unb64(s("secret")), iAmPhone = true)
        assertEquals(s("plain"), String(phone.open(env)))
    }

    @Test fun desktopSideProducesTheSameBytes() {
        val desk = LinkCrypto.Session(LinkCrypto.unb64(s("deskPriv")), LinkCrypto.unb64(s("phonePub")), LinkCrypto.unb64(s("secret")), iAmPhone = false)
        val again = desk.sealWith(s("plain").toByteArray(), env.seq, LinkCrypto.unb64(env.n))
        assertEquals(env.ct, again.ct)
    }
}
