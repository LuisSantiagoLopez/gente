// Copyright 2026 DeskHead Inc.
// Everything Gente knows lives in one SQLite file on this phone. Every row's content is sealed with
// AES-256-GCM under the Keychain key, so the file on disk is ciphertext. The file is also:
//  - excluded from iCloud and computer backups (isExcludedFromBackup),
//  - protected by iOS Data Protection (complete until first unlock),
//  - written with secure_delete so removed rows are zeroed.
import CryptoKit
import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

final class EncryptedStore {
    static let shared: EncryptedStore = {
        do { return try EncryptedStore(url: EncryptedStore.defaultURL, keyStore: KeyStore()) }
        catch { fatalError("Gente could not open its vault: \(error)") }
    }()

    static var defaultURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Gente", isDirectory: true)
        return dir.appendingPathComponent("gente.vault")
    }

    let url: URL
    private var db: OpaquePointer?
    private var sealer: Sealer
    private let queue = DispatchQueue(label: "gente.store")
    let keyStore: KeyStore

    init(url: URL, keyStore: KeyStore) throws {
        self.url = url
        self.keyStore = keyStore
        sealer = Sealer(key: try keyStore.databaseKey())
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            throw NSError(domain: "gente.store", code: 1)
        }
        exec("PRAGMA journal_mode=DELETE")
        exec("PRAGMA secure_delete=ON")
        exec("""
        CREATE TABLE IF NOT EXISTS rows(
          kind TEXT NOT NULL, id TEXT NOT NULL, parent TEXT, sort REAL NOT NULL, blob BLOB NOT NULL,
          PRIMARY KEY(kind, id))
        """)
        exec("CREATE INDEX IF NOT EXISTS rows_parent ON rows(kind, parent, sort)")
        Self.excludeFromBackup(url.deletingLastPathComponent())
        Self.excludeFromBackup(url)
    }

    deinit { sqlite3_close(db) }

    static func excludeFromBackup(_ url: URL) {
        var u = url
        var v = URLResourceValues()
        v.isExcludedFromBackup = true
        try? u.setResourceValues(v)
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
    }

    // MARK: Generic sealed rows

    func put<T: Encodable>(_ kind: String, id: String, parent: String? = nil, sort: Double, _ value: T) {
        queue.sync {
            guard let blob = try? sealer.seal(value, id: kind + "/" + id) else { return }
            var st: OpaquePointer?
            sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO rows(kind,id,parent,sort,blob) VALUES(?,?,?,?,?)", -1, &st, nil)
            sqlite3_bind_text(st, 1, kind, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(st, 2, id, -1, SQLITE_TRANSIENT)
            if let parent { sqlite3_bind_text(st, 3, parent, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(st, 3) }
            sqlite3_bind_double(st, 4, sort)
            _ = blob.withUnsafeBytes { sqlite3_bind_blob(st, 5, $0.baseAddress, Int32(blob.count), SQLITE_TRANSIENT) }
            sqlite3_step(st)
            sqlite3_finalize(st)
        }
    }

    func all<T: Decodable>(_ kind: String, _ type: T.Type, parent: String? = nil, newestFirst: Bool = false, limit: Int = 100_000) -> [T] {
        queue.sync {
            var st: OpaquePointer?
            let order = newestFirst ? "DESC" : "ASC"
            let sql = parent == nil
                ? "SELECT id, blob FROM rows WHERE kind=? ORDER BY sort \(order) LIMIT ?"
                : "SELECT id, blob FROM rows WHERE kind=? AND parent=? ORDER BY sort \(order) LIMIT ?"
            sqlite3_prepare_v2(db, sql, -1, &st, nil)
            sqlite3_bind_text(st, 1, kind, -1, SQLITE_TRANSIENT)
            var idx: Int32 = 2
            if let parent { sqlite3_bind_text(st, 2, parent, -1, SQLITE_TRANSIENT); idx = 3 }
            sqlite3_bind_int(st, idx, Int32(limit))
            var out: [T] = []
            while sqlite3_step(st) == SQLITE_ROW {
                let id = String(cString: sqlite3_column_text(st, 0))
                let n = Int(sqlite3_column_bytes(st, 1))
                guard let p = sqlite3_column_blob(st, 1) else { continue }
                let data = Data(bytes: p, count: n)
                if let v = try? sealer.open(T.self, data, id: kind + "/" + id) { out.append(v) }
            }
            sqlite3_finalize(st)
            return out
        }
    }

    func delete(_ kind: String, id: String) {
        queue.sync {
            var st: OpaquePointer?
            sqlite3_prepare_v2(db, "DELETE FROM rows WHERE kind=? AND (id=? OR parent=?)", -1, &st, nil)
            sqlite3_bind_text(st, 1, kind, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(st, 2, id, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(st, 3, id, -1, SQLITE_TRANSIENT)
            sqlite3_step(st)
            sqlite3_finalize(st)
        }
    }

    func deleteChildren(_ kind: String, parent: String) {
        queue.sync {
            var st: OpaquePointer?
            sqlite3_prepare_v2(db, "DELETE FROM rows WHERE kind=? AND parent=?", -1, &st, nil)
            sqlite3_bind_text(st, 1, kind, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(st, 2, parent, -1, SQLITE_TRANSIENT)
            sqlite3_step(st)
            sqlite3_finalize(st)
        }
    }

    /// Wipes every row and the key. After this the old file cannot be read even if recovered.
    func eraseEverything() {
        queue.sync {
            exec("DELETE FROM rows"); exec("VACUUM")
            keyStore.eraseAll()
            if let k = try? keyStore.databaseKey() { sealer = Sealer(key: k) }
        }
    }

    private func exec(_ sql: String) { sqlite3_exec(db, sql, nil, nil, nil) }

    // MARK: Typed helpers

    func saveChat(_ c: Chat) { put("chat", id: c.id, sort: c.updatedAt.timeIntervalSince1970, c) }
    func chats() -> [Chat] { all("chat", Chat.self, newestFirst: true) }
    func deleteChat(_ id: String) { delete("chat", id: id); deleteChildren("message", parent: id) }

    func saveMessage(_ m: Message) { put("message", id: m.id, parent: m.chatId, sort: m.createdAt.timeIntervalSince1970, m) }
    func messages(chat: String) -> [Message] { all("message", Message.self, parent: chat) }

    func saveBrain(_ b: BrainItem) { put("brain", id: b.id, parent: b.kind.rawValue, sort: b.updatedAt.timeIntervalSince1970, b) }
    func brain(_ kind: BrainKind? = nil) -> [BrainItem] {
        kind == nil ? all("brain", BrainItem.self, newestFirst: true) : all("brain", BrainItem.self, parent: kind!.rawValue, newestFirst: true)
    }
    func deleteBrain(_ id: String) { delete("brain", id: id) }

    func saveRoutine(_ r: Routine) { put("routine", id: r.id, sort: Double(r.hour * 60 + r.minute), r) }
    func routines() -> [Routine] { all("routine", Routine.self) }
    func deleteRoutine(_ id: String) { delete("routine", id: id) }

    func saveEgress(_ e: EgressRecord) { put("egress", id: e.id, sort: e.at.timeIntervalSince1970, e) }
    func egress(limit: Int = 500) -> [EgressRecord] { all("egress", EgressRecord.self, newestFirst: true, limit: limit) }
}
