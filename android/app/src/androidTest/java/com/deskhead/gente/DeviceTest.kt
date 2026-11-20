package com.deskhead.gente

import android.content.pm.ApplicationInfo
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Runs on the emulator against the real app: real Keystore, real SQLCipher, real UI. */
@RunWith(AndroidJUnit4::class)
class DeviceTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val ctx get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun s(id: Int) = ctx.getString(id)

    @Test fun databaseIsEncryptedOnDisk() {
        rule.waitForIdle()
        val app = ctx.applicationContext as GenteApp
        kotlinx.coroutines.runBlocking { app.graph.dao.upsertChat(com.deskhead.gente.data.ChatEntity("enc-test", "PLAINTEXT-MARKER-42", 1, 1)) }
        app.graph.db.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(FULL)").close()
        val file = ctx.getDatabasePath(com.deskhead.gente.data.GenteDatabase.FILE)
        val bytes = file.readBytes()
        assertFalse("must not be a plain SQLite file", String(bytes.copyOfRange(0, 16)).startsWith("SQLite format 3"))
        assertFalse("marker must not be readable on disk", String(bytes, Charsets.ISO_8859_1).contains("PLAINTEXT-MARKER-42"))
        val wal = File(file.path + "-wal")
        if (wal.exists()) assertFalse(String(wal.readBytes(), Charsets.ISO_8859_1).contains("PLAINTEXT-MARKER-42"))
        // The key lives wrapped by Android Keystore, outside backup.
        assertTrue(File(ctx.noBackupFilesDir, "db.key.wrapped").exists())
        kotlinx.coroutines.runBlocking { app.graph.dao.deleteChat("enc-test") }
    }

    @Test fun backupIsOff() {
        val info = ctx.packageManager.getApplicationInfo(ctx.packageName, 0)
        assertEquals(0, info.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
    }

    @Test fun demoChatEndToEndWithAccessibilityChecks() {
        rule.enableAccessibilityChecks()
        if (rule.onAllNodes(hasText(s(R.string.try_first))).fetchSemanticsNodes().isNotEmpty()) rule.onNodeWithText(s(R.string.try_first)).performClick()
        rule.onNodeWithText(s(R.string.new_chat)).performClick()
        rule.onNode(hasSetTextAction()).performTextInput("Hello from the emulator")
        rule.onNodeWithContentDescription(s(R.string.cd_send)).performClick()
        rule.waitUntil(15_000) { rule.onAllNodes(hasText(s(R.string.badge_demo))).fetchSemanticsNodes().isNotEmpty() }
        Espresso.pressBack() // predictive-back capable navigation returns home
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("Hello from the emulator")).fetchSemanticsNodes().isNotEmpty() }
    }
}
