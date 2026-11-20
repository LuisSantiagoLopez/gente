package com.deskhead.gente.security

import android.content.Context
import android.content.pm.PackageManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Holds the on-device secrets.
 *
 * A random 32-byte database key is wrapped (AES-256-GCM) by a key that never leaves
 * Android Keystore. StrongBox is used when the phone has it. The wrapped blob lives in
 * noBackupFilesDir, so it is never part of Google backup or device-to-device transfer.
 */
/** Seals small secrets. KeyManager does it with Android Keystore; tests use a fake. */
interface Sealer {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

/** Everything the app needs from the key store. */
interface Vault : Sealer {
    val usesStrongBox: Boolean
    fun databasePassphrase(): ByteArray
    fun destroyAll()
}

class KeyManager(private val context: Context) : Vault {

    /** True when the wrapping key is inside a StrongBox secure element. */
    override var usesStrongBox: Boolean = false
        private set

    private val ks: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    override fun databasePassphrase(): ByteArray = unwrapOrCreate(File(context.noBackupFilesDir, "db.key.wrapped"))

    fun secretFor(name: String): ByteArray = unwrapOrCreate(File(context.noBackupFilesDir, "$name.key.wrapped"))

    /** Encrypt small values (tokens) with the Keystore key. */
    override fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, wrappingKey())
        return c.iv + c.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, sealed, 0, 12))
        return c.doFinal(sealed, 12, sealed.size - 12)
    }

    /** Delete every key. After this the encrypted database can never be read again. */
    override fun destroyAll() {
        context.noBackupFilesDir.listFiles()?.filter { it.name.endsWith(".key.wrapped") }?.forEach { it.delete() }
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    }

    private fun unwrapOrCreate(file: File): ByteArray {
        if (file.exists()) return open(file.readBytes())
        val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
        file.writeBytes(seal(raw))
        return raw
    }

    private fun wrappingKey(): SecretKey {
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            usesStrongBox = context.getSharedPreferences("km", 0).getBoolean("strongbox", false)
            return it.secretKey
        }
        val hasStrongBox = context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        fun gen(strongBox: Boolean): SecretKey {
            val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setIsStrongBoxBacked(strongBox)
                .build()
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply { init(spec) }.generateKey()
        }
        val key = if (hasStrongBox) {
            try { gen(true).also { usesStrongBox = true } } catch (_: StrongBoxUnavailableException) { gen(false) }
        } else gen(false)
        context.getSharedPreferences("km", 0).edit().putBoolean("strongbox", usesStrongBox).apply()
        return key
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "gente.wrap.v1"
        private const val TRANSFORM = "AES/GCM/NoPadding"
    }
}
