// Copyright 2026 DeskHead Inc.
// Proof: chat content goes ONLY to /v1/inference. Every request is captured with its body, the
// app runs real chats (with a tool call and a sync), then we search every body for the secret.
import XCTest
@testable import Gente

@MainActor
final class NetworkPrivacyTests: XCTestCase {
    var store: EncryptedStore!
    var keys: KeyStore!
    var egress: [EgressRecord] = []

    override func setUp() async throws {
        keys = KeyStore(service: "test.net.\(UUID().uuidString)")
        store = try EncryptedStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".vault"), keyStore: keys)
        CaptureProtocol.reset()
        egress = []
    }
    override func tearDown() async throws { keys.eraseAll() }

    func makeEngine() -> ChatEngine {
        let http = CaptureProtocol.session { [weak self] r in self?.egress.append(r) }
        let api = CloudAPI()
        api.http = http
        api.tokens = { "test-token" }
        let e = ChatEngine()
        e.store = store
        e.chats = []
        e.messages = [:]
        e.inference.api = api
        e.tools.api = api
        e.place = .cloud
        return e
    }

    func waitIdle(_ e: ChatEngine, _ chat: String) async {
        for _ in 0..<200 where e.working.contains(chat) { try? await Task.sleep(for: .milliseconds(25)) }
    }

    func testChatContentOnlyGoesToInference() async throws {
        let secret = "MY-SECRET-PLAN-\(UUID().uuidString)"
        var round = 0
        CaptureProtocol.handler = { req, body in
            switch req.url!.path {
            case "/v1/inference/chat/completions":
                round += 1
                return (200, ["Content-Type": "text/event-stream"],
                        round == 1 ? FakeCloud.toolCall("web_search", ["query": "weather mexico city saturday"]) : FakeCloud.text("Sunny, 24C."))
            case "/v1/proxy/search":
                return (200, ["Content-Type": "application/json"],
                        try! JSONSerialization.data(withJSONObject: ["results": [["title": "Weather", "url": "https://weather.gov", "text": "Sunny"]]]))
            default: return (404, [:], Data())
            }
        }
        let e = makeEngine()
        let chat = e.newChat()
        e.send("About \(secret): will it rain on Saturday?", in: chat.id)
        await waitIdle(e, chat.id)
        e.send("Thanks. Remember \(secret) for later.", in: chat.id)
        await waitIdle(e, chat.id)

        let all = CaptureProtocol.captured
        XCTAssertTrue(all.contains { $0.url.path == "/v1/proxy/search" }, "the tool really ran")
        XCTAssertGreaterThanOrEqual(all.filter { $0.url.path == "/v1/inference/chat/completions" }.count, 3)
        for r in all where r.body.range(of: Data(secret.utf8)) != nil || r.url.absoluteString.contains(secret) {
            XCTAssertEqual(r.url.path, "/v1/inference/chat/completions", "chat content leaked to \(r.url)")
        }
        // The search request carried only the model's search words, not the conversation.
        let search = all.first { $0.url.path == "/v1/proxy/search" }!
        XCTAssertNil(search.body.range(of: Data("rain on Saturday".utf8)))
        // The log lists every request, and holds no content.
        XCTAssertEqual(egress.count, all.count)
        let logBytes = try JSONEncoder().encode(egress)
        XCTAssertNil(logBytes.range(of: Data(secret.utf8)))
        XCTAssertTrue(egress.contains { $0.service == Service.inference.rawValue && $0.stored == "Not stored" })
        // Assistant answer is saved with the badge source.
        XCTAssertEqual(store.messages(chat: chat.id).last(where: { $0.role == .assistant })?.answeredBy, .cloud)
    }

    func testContextSendsOnlyRecentTurns() async throws {
        var lastBody = Data()
        CaptureProtocol.handler = { _, body in lastBody = body; return (200, [:], FakeCloud.text("ok")) }
        let e = makeEngine()
        let chat = e.newChat()
        let old = "ANCIENT-\(UUID().uuidString)"
        store.saveMessage(Message(chatId: chat.id, role: .user, text: old, createdAt: Date().addingTimeInterval(-9000)))
        for i in 0..<20 {
            store.saveMessage(Message(chatId: chat.id, role: .user, text: "q\(i)", createdAt: Date().addingTimeInterval(Double(-8000 + i * 10))))
            store.saveMessage(Message(chatId: chat.id, role: .assistant, text: "a\(i)", createdAt: Date().addingTimeInterval(Double(-7995 + i * 10))))
        }
        e.messages[chat.id] = nil
        e.send("latest question", in: chat.id)
        await waitIdle(e, chat.id)
        XCTAssertNotNil(lastBody.range(of: Data("latest question".utf8)))
        XCTAssertNil(lastBody.range(of: Data(old.utf8)), "old turns stay on the phone")
    }

    func testRiskyToolWaitsForApprovalAndNoMeansNo() async throws {
        var round = 0
        CaptureProtocol.handler = { req, _ in
            if req.url!.path == "/v1/inference/chat/completions" {
                round += 1
                return (200, [:], round == 1 ? FakeCloud.toolCall("apps", ["tool": "GMAIL_SEND_EMAIL", "arguments": ["to": "ana@example.com"]]) : FakeCloud.text("Okay, I won't send it."))
            }
            return (200, [:], Data("{}".utf8))
        }
        let e = makeEngine()
        let chat = e.newChat()
        e.send("Send Ana the reply", in: chat.id)
        for _ in 0..<200 where e.approval == nil { try await Task.sleep(for: .milliseconds(20)) }
        let a = try XCTUnwrap(e.approval)
        XCTAssertTrue(a.reasons.contains(.sendAsYou))
        a.decide(false)
        await waitIdle(e, chat.id)
        XCTAssertFalse(CaptureProtocol.captured.contains { $0.url.path.contains("composio") }, "denied tool must not run")
        XCTAssertEqual(store.messages(chat: chat.id).last?.text, "Okay, I won't send it.")
    }

    func testOfflineGivesAFriendlySentence() async throws {
        let f = Friendly.from(URLError(.notConnectedToInternet))
        XCTAssertEqual(f.action, .retry)
        XCTAssertFalse(f.text.contains("URLError"))
        XCTAssertEqual(Friendly.from(HTTPFailure(status: 402, code: "plan_has_no_cloud")).action, .upgrade)
    }

    func testChatContextCannotUseAnotherDoor() throws {
        let http = GenteHTTP.shared
        var r = URLRequest(url: URL(string: "https://gente-cloud.vercel.app/v1/proxy/search")!)
        r.httpMethod = "POST"
        XCTAssertThrowsError(try http.check(r, carries: .chatContext))
        r.url = URL(string: "http://gente-cloud.vercel.app/v1/inference/chat/completions")
        XCTAssertThrowsError(try http.check(r, carries: .chatContext), "plain http is refused")
        r.url = URL(string: "https://gente-cloud.vercel.app/v1/inference/chat/completions")
        XCTAssertNoThrow(try http.check(r, carries: .chatContext))
    }
}
