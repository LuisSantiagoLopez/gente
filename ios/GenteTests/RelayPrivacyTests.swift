// Copyright 2026 DeskHead Inc.
// Proof for Gente Link v1:
//  1. Same bytes as an independent Node implementation (scripts/link-vectors.mjs), both ways.
//  2. The relay only ever stores ciphertext: a fake relay keeps every byte; a fake desktop pairs,
//     syncs, pushes an approval, runs Private mode and a task; the secret never reaches the relay.
import CryptoKit
import XCTest
@testable import Gente

/// Mirrors Gente Cloud's channel relay: stores exactly the bytes the app uploads, per channel.
final class MemoryRelay: RelayTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var channels: [String: [(seq: Int64, bytes: Data)]] = [:]
    private var next: Int64 = 0
    var rawBytes: Data { lock.withLock { channels.values.flatMap { $0 }.reduce(Data()) { $0 + $1.bytes } } }
    var deleted: [String] = []
    func count(_ ch: String) -> Int { lock.withLock { channels[ch]?.count ?? 0 } }

    func post(_ channel: String, _ env: LinkEnvelope, live: Bool) async throws {
        let bytes = try JSONEncoder().encode(env)
        lock.withLock { next += 1; channels[channel, default: []].append((next, bytes)) }
    }
    func poll(_ channel: String, after: Int64) async throws -> [RelayItem] {
        lock.withLock {
            (channels[channel] ?? []).filter { $0.seq > after }.compactMap { x in
                (try? JSONDecoder().decode(LinkEnvelope.self, from: x.bytes)).map { RelayItem(seq: x.seq, envelope: $0) }
            }
        }
    }
    func delete(_ channel: String) async throws { lock.withLock { channels[channel] = nil; deleted.append(channel) } }
}

final class LinkCryptoTests: XCTestCase {
    // From `node scripts/link-vectors.mjs make`.
    let phonePriv = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc", phonePub = "E75P6uryBMf9M1j8nAByGIHRdCeBKCJ-xnTzf3_pe20"
    let deskPub = "V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CE", deskPriv = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk", secret = "AwMDAwMDAwMDAwMDAwMDAw"
    let nodeChannel = "UGc4KUkZ0ciLlDPeQEOJi7", nodeCode = "6488"
    let nodeEnvelope = LinkEnvelope(from: "desktop", seq: 5, n: "AQEBAQEBAQEBAQEB", ct: "Z8MueWiJsQGTf0sj-c2uZIbD7NA7gWQx10jaaMuGfbFy-wWt52Doq7GpDZ_Zzt5g_c3-m7fpwc2Mg06QuU5RnBxlQ9FbNvZ1MTiGZiSyHWp_KTwn7w2QAb5eYdw5lvkw52n8U9IofafOBzk04btGYuVt2TTcB-oONmkMdlcxWJ12lCxxbax0eaw7d_pbvkJW26SquEA6s2vgma0buKygOXNPW9tbmHPXO0v4fHn6cCcMyxWHM8sNHVVtfIjLcRpLng8TJY58pX3QlVUV9f3KyGec8Q")
    let nodePlain = "{\"type\":\"sync.chat\",\"id\":\"c1\",\"title\":\"From the desktop\",\"updatedAt\":1795000000000,\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"text\":\"hola desde la compu\",\"createdAt\":1795000000000,\"ranOn\":\"desktop\"}]}"

    func phoneSession() throws -> LinkSession {
        try LinkSession(myPrivate: Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(base64URL: phonePriv)!),
                        peerPublic: Data(base64URL: deskPub)!, secret: Data(base64URL: secret)!, iAmPhone: true)
    }

    func testMatchesTheNodeImplementation() throws {
        let s = try phoneSession()
        XCTAssertEqual(try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(base64URL: phonePriv)!).publicKey.rawRepresentation.base64URL, phonePub)
        XCTAssertEqual(s.channel, nodeChannel)
        XCTAssertEqual(s.safetyCode, nodeCode)
        XCTAssertEqual(String(data: try s.open(nodeEnvelope), encoding: .utf8), nodePlain, "iPhone opens what Node sealed")
        // The other direction: write an iPhone envelope for `node scripts/link-vectors.mjs check`.
        let mine = try s.seal(Data("hola desde el iPhone".utf8), seq: 2)
        let out: [String: Any] = ["deskPriv": deskPriv, "phonePub": phonePub, "secret": secret,
                                  "envelope": try JSONSerialization.jsonObject(with: JSONEncoder().encode(mine))]
        try? JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: "/tmp/gente-link-from-iphone.json"))
    }

    func testTamperOwnAndWrongDirectionFail() throws {
        let s = try phoneSession()
        var bad = nodeEnvelope
        var ct = Data(base64URL: bad.ct)!; ct[3] ^= 1; bad.ct = ct.base64URL
        XCTAssertThrowsError(try s.open(bad), "a flipped bit fails")
        var moved = nodeEnvelope; moved.seq += 1
        XCTAssertThrowsError(try s.open(moved), "the counter is bound in")
        let mine = try s.seal(Data("x".utf8), seq: 9)
        XCTAssertThrowsError(try s.open(mine), "own messages are dropped")
        let other = try LinkSession(myPrivate: .init(), peerPublic: Data(base64URL: deskPub)!, secret: Data(base64URL: secret)!, iAmPhone: true)
        XCTAssertThrowsError(try other.open(nodeEnvelope), "another phone can't open it")
    }

    func testQRParse() {
        let o = LinkOffer(desktopId: "mac-1", name: "Santi's Mac", desktopPk: Data(base64URL: deskPub)!, secret: Data(base64URL: secret)!)
        XCTAssertEqual(LinkOffer(text: o.qr), o)
        XCTAssertNil(LinkOffer(text: "gente://link?v=1&id=x&pk=short&s=short"))
        XCTAssertNil(LinkOffer(text: "https://example.com"))
    }
}

/// A desktop written only from the protocol text, to drive the phone end to end.
struct FakeDesktop {
    let priv = Curve25519.KeyAgreement.PrivateKey()
    let secret = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
    var offer: LinkOffer { LinkOffer(desktopId: "mac-test", name: "Test Mac", desktopPk: priv.publicKey.rawRepresentation, secret: secret) }
    var channel: String { LinkSession.channel(secret) }
    func session(phonePub: Data) throws -> LinkSession { try LinkSession(myPrivate: priv, peerPublic: phonePub, secret: secret, iAmPhone: false) }
}

@MainActor
final class RelayPrivacyTests: XCTestCase {
    func makeSync(_ relay: MemoryRelay) throws -> (SyncEngine, EncryptedStore, KeyStore) {
        let keys = KeyStore(service: "test.link.\(UUID().uuidString)")
        let store = try EncryptedStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".vault"), keyStore: keys)
        let sync = SyncEngine()
        sync.relay = relay
        sync.store = store
        return (sync, store, keys)
    }

    func testRelayOnlyEverStoresCiphertext() async throws {
        let relay = MemoryRelay()
        let (sync, store, keys) = try makeSync(relay)
        defer { keys.eraseAll(); sync.stop() }
        let desk = FakeDesktop()

        // Pair: the phone sends hello with its public key; both sides get the same 4-digit code.
        let code = try await sync.pair(qr: desk.offer.qr)
        sync.stop()
        let hello = try await relay.poll(desk.channel, after: 0)
        XCTAssertEqual(hello.count, 1)
        let phonePub = try XCTUnwrap(Data(base64URL: hello[0].envelope.epk ?? ""))
        let ds = try desk.session(phonePub: phonePub)
        XCTAssertEqual(ds.safetyCode, code)
        let helloMsg = try JSONSerialization.jsonObject(with: ds.open(hello[0].envelope)) as! [String: Any]
        XCTAssertEqual(helloMsg["type"] as? String, "hello")

        // Phone -> desktop: a chat and memory with a secret.
        let secret = "TOP-SECRET-\(UUID().uuidString)"
        let chat = Chat(title: "Plan about \(secret)")
        store.saveChat(chat)
        store.saveMessage(Message(chatId: chat.id, role: .user, text: "my plan is \(secret)"))
        store.saveBrain(BrainItem(kind: .memory, title: secret, body: "remember \(secret)"))
        await sync.sendChat(chat.id)
        sync.memoryChanged()
        for _ in 0..<50 where relay.count(desk.channel) < 3 { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(relay.count(desk.channel), 3)

        XCTAssertNil(relay.rawBytes.range(of: Data(secret.utf8)), "the relay never sees plaintext")
        XCTAssertNil(relay.rawBytes.range(of: Data("sync.chat".utf8)), "not even the message type")
        XCTAssertNil(relay.rawBytes.range(of: Data("my plan".utf8)))
        let opened = try await relay.poll(desk.channel, after: 1).map { String(data: try ds.open($0.envelope), encoding: .utf8)! }
        XCTAssertTrue(opened.contains { $0.contains(secret) && $0.contains("sync.chat") }, "the desktop can read it")
        XCTAssertTrue(opened.contains { $0.contains("sync.memory") })

        // Desktop -> phone: ack, a chat, an approval, Private mode words, task status.
        var seq: Int64 = 0
        func send(_ o: [String: Any]) async throws {
            seq += 1
            try await relay.post(desk.channel, ds.seal(JSONSerialization.data(withJSONObject: o), seq: seq), live: false)
        }
        try await send(["type": "hello_ack"])
        try await send(["type": "sync.chat", "id": "desk-chat", "title": "From the Mac", "updatedAt": 1795000000000,
                        "messages": [["id": "dm1", "role": "assistant", "text": "made on the Mac", "createdAt": 1795000000000, "ranOn": "desktop"]]])
        try await send(["type": "approval.request", "id": "ap1", "kind": "send_as_user", "title": "Send the email to Ana", "detail": "To ana@example.com"])
        let stream = try await sync.privateInfer([WireMessage(role: "user", content: "hi")])
        sync.stop()
        let infer = try await relay.poll(desk.channel, after: 0).last!
        let req = try JSONSerialization.jsonObject(with: ds.open(infer.envelope)) as! [String: Any]
        XCTAssertEqual(req["type"] as? String, "private.infer")
        let reqId = req["reqId"] as! String
        try await send(["type": "private.delta", "reqId": reqId, "text": "Hola "])
        try await send(["type": "private.delta", "reqId": reqId, "text": "Santi"])
        try await send(["type": "private.done", "reqId": reqId])
        let taskId = try await sync.startTask("Clean my downloads folder")
        sync.stop()
        try await send(["type": "task.status", "taskId": taskId, "state": "running", "text": "Sorting 42 files"])
        try await sync.pull()

        XCTAssertTrue(sync.desktop?.confirmed == true)
        XCTAssertEqual(store.messages(chat: "desk-chat").first?.answeredBy, .desktop)
        XCTAssertEqual(store.chats().first { $0.id == "desk-chat" }?.title, "From the Mac")
        XCTAssertEqual(sync.approvals.first?.title, "Send the email to Ana")
        XCTAssertEqual(sync.tasks.first?.status, "Sorting 42 files")
        var words = ""
        for try await e in stream { if case .text(let t) = e { words += t } }
        XCTAssertEqual(words, "Hola Santi")

        // The phone's decision goes back sealed.
        await sync.decide(sync.approvals.first!, approved: false)
        let decision = try await relay.poll(desk.channel, after: 0).last!
        let d = try JSONSerialization.jsonObject(with: ds.open(decision.envelope)) as! [String: Any]
        XCTAssertEqual(d["type"] as? String, "approval.decision")
        XCTAssertEqual(d["approved"] as? Bool, false)

        // Replay: the same envelope again is ignored.
        let before = store.messages(chat: "desk-chat").count
        let old = try await relay.poll(desk.channel, after: 0).first { $0.envelope.from == "desktop" && $0.envelope.seq == 2 }!
        try await relay.post(desk.channel, old.envelope, live: false)
        try await sync.pull()
        XCTAssertEqual(store.messages(chat: "desk-chat").count, before)

        // Unpair: the desktop is told, the channel is deleted, the keys are gone.
        await sync.unpair(sync.desktop!)
        XCTAssertEqual(relay.deleted, [desk.channel])
        XCTAssertFalse(sync.paired)
        XCTAssertTrue(store.all("peer", PairedDesktop.self).isEmpty)
    }
}
