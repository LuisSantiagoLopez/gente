// Copyright 2026 DeskHead Inc.
// Self-heal on iOS: each failure id repairs itself and leaves one plain line; the repair event
// matches the shared contract and carries no content.
import CryptoKit
import XCTest
@testable import Gente

@MainActor
final class SelfHealTests: XCTestCase {
    var keys: KeyStore!
    var store: EncryptedStore!

    override func setUp() async throws {
        keys = KeyStore(service: "test.heal.\(UUID().uuidString)")
        store = try EncryptedStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".vault"), keyStore: keys)
        SelfHeal.shared.store = store
        CaptureProtocol.reset()
    }
    override func tearDown() async throws { keys.eraseAll(); SelfHeal.shared.store = .shared }

    func latest(_ f: FailureID) -> RepairEvent? { SelfHeal.shared.events.first { $0.failureId == f } }

    func testRepairEventMatchesTheContract() throws {
        let e = RepairEvent(failureId: .relayDown, outcome: .fixed, fixedBy: .restartRelay, ms: 2100)
        let p = SelfHeal.payload(e)
        XCTAssertEqual(Set(p.keys), ["kind", "failureId", "outcome", "fixedBy", "ms", "version", "platform", "installId"])
        XCTAssertEqual(p["kind"] as? String, "repair")
        XCTAssertEqual(p["failureId"] as? String, "relay-down")
        XCTAssertEqual(p["outcome"] as? String, "fixed")
        XCTAssertEqual(p["platform"] as? String, "ios")
        XCTAssertEqual(Set(FailureID.allCases.map(\.rawValue)), ["sign-in-expired", "relay-down", "cloud-model-unavailable", "slow-replies"])
        let line = SelfHeal.describe(e)
        XCTAssertTrue(line.contains("the link to your computer dropped, so I reconnected to your computer (2 s)."), line)
    }

    func testNotesAreNotSentUnlessTurnedOnAndConfigured() {
        SelfHeal.shared.sendNotes = false
        SelfHeal.shared.lastSent = nil
        SelfHeal.shared.record(.slowReplies, .fixed, fixedBy: .answerOnYourComputer, since: Date())
        XCTAssertNil(SelfHeal.shared.lastSent, "off by default")
        XCTAssertNil(SelfHeal.shared.reportURL, "no URL in this build, so nothing can be sent")
    }

    func testExpiredSignInRenewsAndRetries() async throws {
        var calls = 0
        CaptureProtocol.handler = { req, _ in
            calls += 1
            let fresh = req.value(forHTTPHeaderField: "Authorization") == "Bearer fresh"
            return fresh ? (200, ["Content-Type": "application/json"], Data(#"{"id":"pro"}"#.utf8)) : (401, [:], Data(#"{"error":"invalid_token"}"#.utf8))
        }
        let api = CloudAPI()
        api.http = CaptureProtocol.session { _ in }
        var token = "old"
        api.tokens = { token }
        api.refresh = { token = "fresh" }
        let plan = try await api.plan()
        XCTAssertEqual(plan.id, "pro")
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(latest(.signInExpired)?.outcome, .fixed)
        XCTAssertEqual(latest(.signInExpired)?.fixedBy, .refreshSignIn)
    }

    func testSignInThatCannotRenewAsksThePerson() async throws {
        CaptureProtocol.handler = { _, _ in (401, [:], Data(#"{"error":"invalid_token"}"#.utf8)) }
        let api = CloudAPI()
        api.http = CaptureProtocol.session { _ in }
        api.tokens = { "old" }
        api.refresh = { throw AuthError.signedOut }
        _ = try? await api.plan()
        XCTAssertEqual(latest(.signInExpired)?.outcome, .needsPerson)
        XCTAssertTrue(SelfHeal.describe(latest(.signInExpired)!).contains("Please sign in to Gente again. Your chats are safe."))
    }

    func testRelayDownReconnects() async throws {
        let relay = FlakyRelay(failures: 2)
        let sync = SyncEngine()
        sync.store = store
        sync.relay = relay
        sync.makeRelay = { relay }
        _ = try await sync.pair(qr: FakeDesktop().offer.qr)
        sync.stop()
        relay.failuresLeft = 2
        await sync.pullHealing()   // 1st failure
        await sync.pullHealing()   // 2nd: link restarted
        XCTAssertNil(latest(.relayDown))
        await sync.pullHealing()   // works again
        XCTAssertEqual(latest(.relayDown)?.outcome, .fixed)
        XCTAssertEqual(latest(.relayDown)?.fixedBy, .restartRelay)
    }

    func testCloudModelOffAnswersOnYourComputer() async throws {
        CaptureProtocol.handler = { req, _ in
            req.url!.path == "/v1/inference/status" ? (200, [:], Data(#"{"state":"off"}"#.utf8)) : (500, [:], Data())
        }
        let (engine, desk, relay, sync) = try await pairedEngine()
        let chat = engine.newChat()
        engine.send("hello", in: chat.id)
        try await answerAsDesktop(desk, relay: relay, sync: sync, text: "From your Mac")
        for _ in 0..<100 where engine.working.contains(chat.id) { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(store.messages(chat: chat.id).last?.answeredBy, .desktop)
        XCTAssertFalse(CaptureProtocol.captured.contains { $0.url.path == "/v1/inference/chat/completions" }, "the cloud wasn't asked")
        XCTAssertEqual(latest(.cloudModelUnavailable)?.fixedBy, .answerOnYourComputer)
    }

    func testSlowRepliesAnswerOnYourComputer() async throws {
        CaptureProtocol.handler = { req, _ in
            if req.url!.path == "/v1/inference/status" { return (200, [:], Data(#"{"state":"warm"}"#.utf8)) }
            Thread.sleep(forTimeInterval: 1.5)   // the cloud is slow to send its first word
            return (200, [:], FakeCloud.text("late"))
        }
        let (engine, desk, relay, sync) = try await pairedEngine()
        engine.slowAfter = .milliseconds(300)
        let chat = engine.newChat()
        engine.send("hello", in: chat.id)
        try await answerAsDesktop(desk, relay: relay, sync: sync, text: "Quick from your Mac")
        for _ in 0..<150 where engine.working.contains(chat.id) { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(store.messages(chat: chat.id).last?.text, "Quick from your Mac")
        XCTAssertEqual(latest(.slowReplies)?.fixedBy, .answerOnYourComputer)
    }

    // MARK: helpers

    func pairedEngine() async throws -> (ChatEngine, FakeDesktop, MemoryRelay, SyncEngine) {
        let relay = MemoryRelay()
        let sync = SyncEngine()
        sync.store = store
        sync.relay = relay
        let desk = FakeDesktop()
        _ = try await sync.pair(qr: desk.offer.qr)
        sync.stop()
        let api = CloudAPI()
        api.http = CaptureProtocol.session { _ in }
        api.tokens = { "t" }
        let e = ChatEngine()
        e.store = store; e.chats = []; e.messages = [:]
        e.inference.api = api; e.tools.api = api
        e.syncOverride = sync
        e.place = .cloud
        return (e, desk, relay, sync)
    }

    /// Waits for the phone's private.infer, answers it as the desktop, and lets the phone read it.
    func answerAsDesktop(_ desk: FakeDesktop, relay: MemoryRelay, sync: SyncEngine, text: String) async throws {
        var req: [String: Any]?
        var ds: LinkSession?
        for _ in 0..<200 where req == nil {
            let all = try await relay.poll(desk.channel, after: 0)
            if ds == nil, let pk = all.first?.envelope.epk.flatMap(Data.init(base64URL:)) { ds = try desk.session(phonePub: pk) }
            if let ds { req = all.compactMap { try? JSONSerialization.jsonObject(with: ds.open($0.envelope)) as? [String: Any] }.first { $0["type"] as? String == "private.infer" } }
            if req == nil { try await Task.sleep(for: .milliseconds(20)) }
        }
        let r = try XCTUnwrap(req), s = try XCTUnwrap(ds)
        let id = r["reqId"] as! String
        try await relay.post(desk.channel, s.seal(JSONSerialization.data(withJSONObject: ["type": "private.delta", "reqId": id, "text": text]), seq: 1), live: true)
        try await relay.post(desk.channel, s.seal(JSONSerialization.data(withJSONObject: ["type": "private.done", "reqId": id]), seq: 2), live: true)
        try await sync.pull()
    }
}

final class FlakyRelay: RelayTransport, @unchecked Sendable {
    var failuresLeft: Int
    init(failures: Int) { failuresLeft = failures }
    func post(_ channel: String, _ env: LinkEnvelope, live: Bool) async throws {}
    func poll(_ channel: String, after: Int64) async throws -> [RelayItem] {
        if failuresLeft > 0 { failuresLeft -= 1; throw URLError(.cannotConnectToHost) }
        return []
    }
    func delete(_ channel: String) async throws {}
}
