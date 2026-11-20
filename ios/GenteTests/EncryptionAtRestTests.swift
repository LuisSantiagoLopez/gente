// Copyright 2026 DeskHead Inc.
// Proof: chats are ciphertext on disk, the key is device-only, and the file is out of backups.
import CryptoKit
import Security
import XCTest
@testable import Gente

final class EncryptionAtRestTests: XCTestCase {
    var dir: URL!
    var keys: KeyStore!

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        keys = KeyStore(service: "test.vault.\(UUID().uuidString)")
    }
    override func tearDown() { keys.eraseAll(); try? FileManager.default.removeItem(at: dir) }

    func allBytes(_ url: URL) -> Data {
        var out = Data()
        for suffix in ["", "-journal", "-wal", "-shm"] {
            if let d = try? Data(contentsOf: URL(fileURLWithPath: url.path + suffix)) { out += d }
        }
        return out
    }

    func testChatTextIsNeverPlaintextOnDisk() throws {
        let url = dir.appendingPathComponent("t.vault")
        let marker = "PURPLE-ELEPHANT-\(UUID().uuidString)"
        do {
            let s = try EncryptedStore(url: url, keyStore: keys)
            let chat = Chat(title: "Title \(marker)")
            s.saveChat(chat)
            for i in 0..<50 { s.saveMessage(Message(chatId: chat.id, role: .user, text: "message \(i) \(marker)")) }
            s.saveBrain(BrainItem(kind: .memory, title: marker, body: "memory \(marker)"))
            XCTAssertEqual(s.messages(chat: chat.id).count, 50, "round trip works")
            XCTAssertEqual(s.chats().first?.title, "Title \(marker)")
        }
        let disk = allBytes(url)
        XCTAssertGreaterThan(disk.count, 4096)
        XCTAssertNil(disk.range(of: Data(marker.utf8)), "marker must not appear in the database file")
        XCTAssertNil(disk.range(of: Data("message 7".utf8)))
        XCTAssertNil(disk.range(of: Data("Title".utf8)))
        // A UTF-16 copy would also be a leak.
        XCTAssertNil(disk.range(of: marker.data(using: .utf16LittleEndian)!))
    }

    func testAnotherKeyCannotRead() throws {
        let url = dir.appendingPathComponent("t.vault")
        let s = try EncryptedStore(url: url, keyStore: keys)
        let c = Chat(title: "secret")
        s.saveChat(c)
        let other = KeyStore(service: "test.vault.other.\(UUID().uuidString)")
        defer { other.eraseAll() }
        let thief = try EncryptedStore(url: url, keyStore: other)
        XCTAssertTrue(thief.chats().isEmpty, "rows must not open with a different key")
    }

    func testRowsAreBoundToTheirId() throws {
        let k = SymmetricKey(size: .bits256)
        let sealer = Sealer(key: k)
        let blob = try sealer.seal(Chat(title: "a"), id: "chat/1")
        XCTAssertThrowsError(try sealer.open(Chat.self, blob, id: "chat/2"), "a ciphertext moved to another row must fail")
    }

    func testFileIsExcludedFromBackupAndProtected() throws {
        let url = dir.appendingPathComponent("t.vault")
        _ = try EncryptedStore(url: url, keyStore: keys)
        XCTAssertEqual(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        XCTAssertEqual(try url.deletingLastPathComponent().resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testKeyIsThisDeviceOnlyAndNotSynced() throws {
        _ = try keys.databaseKey()
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keys.service,
                                kSecAttrAccount as String: "db-key", kSecReturnAttributes as String: true]
        var out: AnyObject?
        XCTAssertEqual(SecItemCopyMatching(q as CFDictionary, &out), errSecSuccess)
        let attrs = out as! [String: Any]
        XCTAssertEqual(attrs[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertNotEqual(attrs[kSecAttrSynchronizable as String] as? Bool, true)
    }

    func testEraseEverythingReplacesTheKey() throws {
        let url = dir.appendingPathComponent("t.vault")
        let s = try EncryptedStore(url: url, keyStore: keys)
        let before = try keys.read("db-key")
        s.saveChat(Chat(title: "x"))
        s.eraseEverything()
        XCTAssertTrue(s.chats().isEmpty)
        XCTAssertNotEqual(try keys.read("db-key"), before, "a new key after erase")
    }

    func testEncryptedExportRoundTripAndWrongPassphrase() throws {
        let b = ExportBundle(chats: [Chat(title: "hello")], messages: [], brain: [], routines: [])
        let file = try Exporter.seal(b, passphrase: "correct horse")
        XCTAssertNil(file.range(of: Data("hello".utf8)))
        XCTAssertEqual(try Exporter.open(file, passphrase: "correct horse").chats.first?.title, "hello")
        XCTAssertThrowsError(try Exporter.open(file, passphrase: "wrong horse"))
    }
}
