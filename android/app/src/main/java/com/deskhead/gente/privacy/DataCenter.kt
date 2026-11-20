package com.deskhead.gente.privacy

import com.deskhead.gente.data.DataEventEntity
import com.deskhead.gente.data.GenteDao
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.AccountDeleted
import com.deskhead.gente.net.GenteJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.OutputStream

/** Where each kind of data lives. Shown live in the "Where's my data" center. */
enum class DataPlace { PHONE_ENCRYPTED, PHONE_AND_COMPUTER_E2E, CLOUD_NOT_STORED, CLOUD_ACCOUNT, PLAY }

data class DataKind(val key: String, val place: DataPlace, val count: Int?)

/** Export-all and delete-all. The export never goes to the network; the person picks where it is saved. */
class DataCenter(private val dao: GenteDao, private val cloud: CloudApi, private val clock: () -> Long = System::currentTimeMillis) {

    suspend fun exportTo(out: OutputStream) {
        val chats = dao.allChats()
        val msgs = dao.allMessages().groupBy { it.chatId }
        val doc = buildJsonObject {
            put("format", "gente-export/v1")
            put("exportedAt", clock())
            put("chats", JsonArray(chats.map { c ->
                buildJsonObject {
                    put("id", c.id); put("title", c.title); put("createdAt", c.createdAt)
                    put("messages", JsonArray(msgs[c.id].orEmpty().map { m ->
                        buildJsonObject { put("role", m.role); put("text", m.text); put("at", m.createdAt); m.ranOn?.let { put("ranOn", it) } }
                    }))
                }
            }))
            put("memories", JsonArray(dao.allMemories().map { buildJsonObject { put("text", it.text); put("at", it.createdAt) } }))
            put("files", JsonArray(dao.allFiles().map { buildJsonObject { put("name", it.name); put("mime", it.mime); put("bytes", it.sizeBytes) } }))
            put("whatLeftYourPhone", JsonArray(dao.allEgress().map {
                buildJsonObject { put("at", it.at); put("service", it.service); put("bytesOut", it.bytesOut); put("bytesIn", it.bytesIn); put("status", it.status) }
            }))
        }
        out.bufferedWriter().use { it.write(GenteJson.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), doc)) }
        dao.logEvent(DataEventEntity(at = clock(), kind = "export", detail = "Exported ${chats.size} chats to a file you chose"))
    }

    /** Deletes the Gente Cloud account and returns the server's deletion receipt. */
    suspend fun deleteCloudAccount(): AccountDeleted {
        val r = cloud.deleteAccount()
        dao.logEvent(DataEventEntity(at = clock(), kind = "receipt", detail = "Gente Cloud deletion receipt ${r.receiptId}"))
        return r
    }
}
