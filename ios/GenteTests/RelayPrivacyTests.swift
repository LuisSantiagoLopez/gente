// Copyright 2026 DeskHead Inc.
// Proof: the relay only ever stores ciphertext. A fake relay keeps every byte it is given, the
// phone syncs real chats and memory to a paired desktop, and we search the relay's storage.
import CryptoKit
import XCTest
@testable import Gente

/// Mirrors Gente Cloud's mailbox: it stores exactly what the app uploads (base64 of the envelope).
final class MemoryRelay: RelayTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _stored: [Envelope] = []
    private var _raw = Data()
    var stored: [Envelope] { lock.withLock { _stored } }
    var rawBytes: Data { lock.withLock { _raw } }
    func register(_ d: DevicePublic) async throws -> String { UUID().uuidString.lowercased() }
    func remove(device: String) async throws { lock.withLock { _stored.removeAll { $0.to == device } } }
    func send(_ envelopes: [Envelope]) async throws {
        var bytes = Data()
        for e in envelopes {
            let wire = try JSONEncoder().encode(e).base64EncodedString()
            bytes += Data(wire.utf8) + (Data(base64Encoded: wire) ?? Data())
        }
        lock.withLock { _raw += bytes; _stored += envelopes }
    }
    func inbox(device: String, after: String?) async throws -> [Delivered] {
        lock.withLock { _stored.filter { $0.to == device }.map { Delivered(serverId: $0.id, envelope: $0) } }
    }
    func ack(device: String, ids: [String]) async throws { lock.withLock { _stored.removeAll { ids.contains($0.id) } } }
}

final class RelayCryptoTests: XCTestCase {
    func testEnvelopeRoundTripAndTamper() throws {
        let phone = DeviceIdentity.generate(), desk = DeviceIdentity.generate()
        let p = SyncPayload(type: "message.upsert", id: "m1", at: 1, body: Data("hello desk".utf8))
        let e = try RelayCrypto.seal(p, from: phone, to: desk.publicInfo)
        XCTAssertEqual(try RelayCrypto.open(e, me: desk, sender: phone.publicInfo), p)
        // Someone else can't open it.
        var other = e; other.to = DeviceIdentity.generate().id
        XCTAssertThrowsError(try RelayCrypto.open(other, me: DeviceIdentity.generate(), sender: phone.publicInfo))
        // A flipped bit fails.
        var bad = e
        var ct = Data(base64URL: e.ct)!; ct[0] ^= 1; bad.ct = ct.base64URL
        XCTAssertThrowsError(try RelayCrypto.open(bad, me: desk, sender: phone.publicInfo))
        // A forged sender fails the signature check.
        XCTAssertThrowsError(try RelayCrypto.open(e, me: desk, sender: DeviceIdentity.generate().publicInfo))
        // Changing the routing header fails (it is bound as associated data).
        var moved = e; moved.sent += 1
        XCTAssertThrowsError(try RelayCrypto.open(moved, me: desk, sender: phone.publicInfo))
    }

    func testPairingInviteAndSafetyCode() throws {
        let desk = DeviceIdentity.generate(), phone = DeviceIdentity.generate()
        let secret = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
        var info = desk.publicInfo; info.name = "Santi's Mac"; info.platform = "mac"
        let inv = PairingInvite(desktop: info, secret: secret)
        let parsed = try XCTUnwrap(PairingInvite(url: inv.url))
        XCTAssertEqual(parsed.desktop.x25519, info.x25519)
        XCTAssertEqual(parsed.secret, secret)
        XCTAssertEqual(RelayCrypto.safetyCode(phone.publicInfo, info, secret: secret), RelayCrypto.safetyCode(info, phone.publicInfo, secret: secret))
        XCTAssertEqual(RelayCrypto.safetyCode(phone.publicInfo, info, secret: secret).count, 6)
        XCTAssertNil(PairingInvite(url: URL(string: "gente://pair?v=1&d=x&x=short&s=short&c=short")!))
    }
}

@MainActor
final class RelayPrivacyTests: XCTestCase {
    func testRelayStoresOnlyCiphertext() async throws {
        let keys = KeyStore(service: "test.relay.\(UUID().uuidString)")
        defer { keys.eraseAll() }
        let store = try EncryptedStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".vault"), keyStore: keys)
        let relay = MemoryRelay()
        let sync = SyncEngine()
        sync.relay = relay
        sync.store = store
        let desk = DeviceIdentity.generate()
        var deskInfo = desk.publicInfo; deskInfo.platform = "mac"; deskInfo.name = "Mac"
        let secret = Data(repeating: 7, count: 16)
        let code = try await sync.pair(with: PairingInvite(desktop: deskInfo, secret: secret))
        XCTAssertEqual(code, RelayCrypto.safetyCode(sync.me.publicInfo, deskInfo, secret: secret))
        sync.stop()

        let marker = "TOP-SECRET-\(UUID().uuidString)"
        let chat = Chat(title: "Chat about \(marker)")
        sync.publish("chat.upsert", id: chat.id, chat)
        sync.publish("message.upsert", id: "m", Message(chatId: chat.id, role: .user, text: "my plan is \(marker)"))
        sync.publish("brain.upsert", id: "b", BrainItem(kind: .memory, title: marker, body: marker))
        for _ in 0..<100 where relay.stored.count < 4 { try await Task.sleep(for: .milliseconds(20)) }

        XCTAssertEqual(relay.stored.count, 4, "hello + 3 records")
        XCTAssertNil(relay.rawBytes.range(of: Data(marker.utf8)), "the relay must never see plaintext")
        XCTAssertNil(relay.rawBytes.range(of: Data("my plan".utf8)))
        XCTAssertNil(relay.rawBytes.range(of: Data("chat.upsert".utf8)), "even the record type is sealed")
        // The desktop, and only the desktop, can open them.
        let opened = try relay.stored.map { try RelayCrypto.open($0, me: desk, sender: sync.me.publicInfo) }
        XCTAssertTrue(opened.contains { String(data: $0.body, encoding: .utf8)!.contains(marker) })
        let hello = try JSONDecoder().decode(PairHello.self, from: opened.first { $0.type == "pair.hello" }!.body)
        XCTAssertEqual(hello.proof, RelayCrypto.pairingProof(sync.me.publicInfo, secret: secret))

        // Removing the device: nothing more is sealed to it.
        await sync.remove(deskInfo)
        let before = relay.stored.count
        sync.publish("message.upsert", id: "m2", Message(chatId: chat.id, role: .user, text: "after removal"))
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(relay.stored.filter { $0.to == deskInfo.id }.count, 0)
        XCTAssertLessThanOrEqual(relay.stored.count, before)
    }

    func testIncomingSyncLandsInTheEncryptedStore() async throws {
        let keys = KeyStore(service: "test.relay2.\(UUID().uuidString)")
        defer { keys.eraseAll() }
        let store = try EncryptedStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".vault"), keyStore: keys)
        let relay = MemoryRelay()
        let sync = SyncEngine()
        sync.relay = relay; sync.store = store
        let desk = DeviceIdentity.generate()
        var info = desk.publicInfo; info.platform = "mac"
        sync.addPeer(info); sync.stop()
        let chat = Chat(title: "From the Mac")
        try await relay.send([RelayCrypto.seal(SyncPayload(type: "chat.upsert", id: chat.id, at: 1, body: try JSONEncoder().encode(chat)), from: desk, to: sync.me.publicInfo)])
        try await sync.pull()
        XCTAssertEqual(store.chats().first?.title, "From the Mac")
        XCTAssertTrue(relay.stored.isEmpty, "acknowledged envelopes are deleted from the relay")
    }
}
