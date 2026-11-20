package com.deskhead.gente.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import androidx.sqlite.db.SupportSQLiteOpenHelper
import kotlinx.coroutines.flow.Flow
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/** Where an answer was made. Shown as a badge on every message. */
enum class RanOn { CLOUD, DESKTOP, PHONE, LOCAL_DEMO }

@Entity(tableName = "chats")
data class ChatEntity(
    @PrimaryKey val id: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long,
    val pinned: Boolean = false,
)

@Entity(tableName = "messages", indices = [Index("chatId")])
data class MessageEntity(
    @PrimaryKey val id: String,
    val chatId: String,
    val role: String, // user | assistant | tool
    val text: String,
    val createdAt: Long,
    val ranOn: String? = null,
    val status: String = "done", // streaming | done | failed | stopped
    val reported: Boolean = false,
)

@Entity(tableName = "memories")
data class MemoryEntity(
    @PrimaryKey val id: String,
    val text: String,
    val createdAt: Long,
)

@Entity(tableName = "files")
data class FileEntity(
    @PrimaryKey val id: String,
    val name: String,
    val mime: String,
    val sizeBytes: Long,
    val localPath: String,
    val createdAt: Long,
)

/** One row per network request. Never content: only time, service, size and result. */
@Entity(tableName = "egress")
data class EgressEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val service: String,
    val method: String,
    val path: String,
    val bytesOut: Long,
    val bytesIn: Long,
    val status: Int,
    val carriesChat: Boolean,
)

/** Timeline for the "Where's my data" center: syncs, deletions, exports, receipts. */
@Entity(tableName = "data_events")
data class DataEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val kind: String, // send | sync | delete | export | receipt | pair
    val detail: String, // never message content
)

@Entity(tableName = "devices")
data class PairedDeviceEntity(
    @PrimaryKey val id: String,
    val name: String,
    val channel: String,
    val sealedKeys: ByteArray, // relay keys, sealed by Android Keystore
    val pairedAt: Long,
    val lastSeen: Long,
    val lastSeq: Long = 0,
)

@Entity(tableName = "approvals")
data class ApprovalEntity(
    @PrimaryKey val id: String,
    val kind: String, // money | send_as_user | delete_data | legal | other
    val title: String,
    val detail: String,
    val source: String, // phone | desktop | routine
    val status: String, // pending | approved | declined
    val createdAt: Long,
    val decidedAt: Long? = null,
)

@Entity(tableName = "routines")
data class RoutineEntity(
    @PrimaryKey val id: String,
    val title: String,
    val schedule: String,
    val enabled: Boolean,
)

data class ChatSummary(
    val id: String,
    val title: String,
    val updatedAt: Long,
    val pinned: Boolean,
    val lastText: String?,
)

@Dao
interface GenteDao {
    @Query(
        """SELECT c.id, c.title, c.updatedAt, c.pinned,
           (SELECT m.text FROM messages m WHERE m.chatId = c.id ORDER BY m.createdAt DESC LIMIT 1) AS lastText
           FROM chats c ORDER BY c.pinned DESC, c.updatedAt DESC""",
    )
    fun chatSummaries(): Flow<List<ChatSummary>>

    @Query("SELECT * FROM chats WHERE id = :id") suspend fun chat(id: String): ChatEntity?
    @Query("SELECT * FROM chats") suspend fun allChats(): List<ChatEntity>
    @Upsert suspend fun upsertChat(c: ChatEntity)
    @Query("DELETE FROM chats WHERE id = :id") suspend fun deleteChat(id: String)

    @Query("SELECT * FROM messages WHERE chatId = :chatId ORDER BY createdAt ASC") fun messages(chatId: String): Flow<List<MessageEntity>>
    @Query("SELECT * FROM messages WHERE chatId = :chatId ORDER BY createdAt ASC") suspend fun messagesNow(chatId: String): List<MessageEntity>
    @Query("SELECT * FROM messages") suspend fun allMessages(): List<MessageEntity>
    @Upsert suspend fun upsertMessage(m: MessageEntity)
    @Query("UPDATE messages SET text = :text, status = :status WHERE id = :id") suspend fun updateMessage(id: String, text: String, status: String)
    @Query("UPDATE messages SET reported = 1 WHERE id = :id") suspend fun markReported(id: String)
    @Query("DELETE FROM messages WHERE chatId = :chatId") suspend fun deleteMessages(chatId: String)

    @Query("SELECT * FROM memories ORDER BY createdAt DESC") fun memories(): Flow<List<MemoryEntity>>
    @Query("SELECT * FROM memories") suspend fun allMemories(): List<MemoryEntity>
    @Upsert suspend fun upsertMemory(m: MemoryEntity)
    @Query("DELETE FROM memories WHERE id = :id") suspend fun deleteMemory(id: String)

    @Query("SELECT * FROM files ORDER BY createdAt DESC") fun files(): Flow<List<FileEntity>>
    @Query("SELECT * FROM files") suspend fun allFiles(): List<FileEntity>
    @Upsert suspend fun upsertFile(f: FileEntity)

    @Insert suspend fun logEgress(e: EgressEntity)
    @Query("SELECT * FROM egress ORDER BY at DESC LIMIT 500") fun egress(): Flow<List<EgressEntity>>
    @Query("SELECT * FROM egress ORDER BY at DESC") suspend fun allEgress(): List<EgressEntity>

    @Insert suspend fun logEvent(e: DataEventEntity)
    @Query("SELECT * FROM data_events ORDER BY at DESC LIMIT 500") fun events(): Flow<List<DataEventEntity>>
    @Query("SELECT * FROM data_events ORDER BY at DESC") suspend fun allEvents(): List<DataEventEntity>

    @Query("SELECT * FROM devices ORDER BY pairedAt DESC") fun devices(): Flow<List<PairedDeviceEntity>>
    @Query("SELECT * FROM devices") suspend fun devicesNow(): List<PairedDeviceEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertDevice(d: PairedDeviceEntity)
    @Query("UPDATE devices SET lastSeq = :seq, lastSeen = :at WHERE id = :id") suspend fun touchDevice(id: String, seq: Long, at: Long)
    @Query("DELETE FROM devices WHERE id = :id") suspend fun deleteDevice(id: String)

    @Query("SELECT * FROM approvals WHERE status = 'pending' ORDER BY createdAt DESC") fun pendingApprovals(): Flow<List<ApprovalEntity>>
    @Query("SELECT * FROM approvals WHERE id = :id") suspend fun approval(id: String): ApprovalEntity?
    @Upsert suspend fun upsertApproval(a: ApprovalEntity)

    @Query("SELECT * FROM routines") fun routines(): Flow<List<RoutineEntity>>
    @Upsert suspend fun upsertRoutine(r: RoutineEntity)

    @Query("SELECT COUNT(*) FROM chats") fun chatCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM messages") fun messageCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM memories") fun memoryCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM files") fun fileCount(): Flow<Int>
}

@Database(
    entities = [
        ChatEntity::class, MessageEntity::class, MemoryEntity::class, FileEntity::class, EgressEntity::class,
        DataEventEntity::class, PairedDeviceEntity::class, ApprovalEntity::class, RoutineEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class GenteDatabase : RoomDatabase() {
    abstract fun dao(): GenteDao

    companion object {
        const val FILE = "gente.db"

        /** The real database: SQLCipher (AES-256) with a key unwrapped from Android Keystore. */
        fun encrypted(context: Context, passphrase: ByteArray): GenteDatabase {
            System.loadLibrary("sqlcipher")
            val factory: SupportSQLiteOpenHelper.Factory = SupportOpenHelperFactory(passphrase)
            return Room.databaseBuilder(context, GenteDatabase::class.java, FILE)
                .openHelperFactory(factory)
                .build()
        }

        /** Tests only. */
        fun inMemory(context: Context): GenteDatabase =
            Room.inMemoryDatabaseBuilder(context, GenteDatabase::class.java).allowMainThreadQueries().build()
    }
}
