// Copyright 2026 DeskHead Inc.
import StoreKitTest
import XCTest
@testable import Gente

final class LogicTests: XCTestCase {
    func testSSEJoinsSplitToolCalls() {
        var acc = SSEAccumulator()
        var events: [StreamEvent] = []
        let body = String(data: FakeCloud.toolCall("web_search", ["query": "hola mundo"]), encoding: .utf8)!
        for line in body.split(separator: "\n") { events += acc.feed(String(line)) }
        events += acc.finish()
        guard case .toolCalls(let calls) = events.last else { return XCTFail("no tool call") }
        XCTAssertEqual(calls.first?.name, "web_search")
        XCTAssertEqual(calls.first?.arguments, #"{"query":"hola mundo"}"#)
    }

    func testSSEText() {
        var acc = SSEAccumulator()
        let body = String(data: FakeCloud.text("Hola"), encoding: .utf8)!
        let events = body.split(separator: "\n").flatMap { acc.feed(String($0)) }
        XCTAssertEqual(events, [.text("Hola")])
    }

    func testApprovalRules() {
        XCTAssertEqual(ApprovalRules.reasons(tool: "web_search", arguments: #"{"query":"buy shoes"}"#), [])
        XCTAssertTrue(ApprovalRules.reasons(tool: "apps", arguments: #"{"tool":"GMAIL_SEND_EMAIL"}"#).contains(.sendAsYou))
        XCTAssertTrue(ApprovalRules.reasons(tool: "apps", arguments: #"{"tool":"STRIPE_CREATE_PAYMENT"}"#).contains(.money))
        XCTAssertTrue(ApprovalRules.reasons(tool: "apps", arguments: #"{"tool":"GOOGLEDRIVE_DELETE_FILE"}"#).contains(.deleteData))
        XCTAssertTrue(ApprovalRules.reasons(tool: "browse", arguments: ##"{"action":"click","selector":"#accept-terms"}"##).contains(.legalTerms))
        XCTAssertEqual(ApprovalRules.reasons(tool: "browse", arguments: #"{"action":"read","url":"https://x.com/terms"}"#), [])
        XCTAssertTrue(ApprovalRules.reasons(tool: "apps", arguments: #"{"tool":"SLACK_ENVIAR_MENSAJE"}"#).contains(.sendAsYou))
    }

    func testRetrievalPicksOnlyRelevantMemory() {
        let items = [BrainItem(kind: .memory, title: "Lives in Mexico City", body: "Lives in Mexico City"),
                     BrainItem(kind: .memory, title: "Allergic to peanuts", body: "Allergic to peanuts")]
        let got = ContextBuilder.retrieve("Restaurants in Mexico City tonight?", from: items, limit: 5)
        XCTAssertEqual(got.map(\.title), ["Lives in Mexico City"])
    }

    func testContextDropsOrphanToolMessages() {
        let c = "c"
        let h = [Message(chatId: c, role: .tool, text: "orphan", toolCallId: "x"), Message(chatId: c, role: .user, text: "hi")]
        let w = ContextBuilder().build(history: h, brain: [])
        XCTAssertFalse(w.contains { $0.role == "tool" })
        XCTAssertEqual(w.first?.content, Config.systemPrompt)
    }

    func testDeepLinks() {
        XCTAssertEqual(DeepLink.parse(URL(string: "gente://ask?q=hola")!), .ask("hola"))
        XCTAssertEqual(DeepLink.parse(URL(string: "gente://new")!), .newChat)
    }

    @MainActor func testPKCE() {
        let v = Auth.verifier()
        XCTAssertGreaterThanOrEqual(v.count, 43)
        // Expected value from an independent implementation:
        // python3 -c "import hashlib,base64;print(base64.urlsafe_b64encode(hashlib.sha256(b'dBjftJeZ4CVP-mB92K9uhvUHxrXOOv4yN_bL4L5-yZ0').digest()).rstrip(b'='))"
        XCTAssertEqual(Auth.challenge("dBjftJeZ4CVP-mB92K9uhvUHxrXOOv4yN_bL4L5-yZ0"), "GzBa7ZJh4y9Ruq5sKg1GTPiYHF-Rj2Tm_430dj9TbXk")
    }
}

@MainActor
final class PurchaseTests: XCTestCase {
    func testBuyRestoreAndHours() async throws {
        let session = try SKTestSession(configurationFileNamed: "Gente")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        let p = Purchases()
        await p.load()
        XCTAssertEqual(Set(p.products.map(\.id)), Set(ProductID.all), "every product is configured")
        await p.buy(try XCTUnwrap(p.product(ProductID.proMonth)))
        await p.refresh()
        XCTAssertEqual(p.activePlan, "pro")
        _ = try await session.buyProduct(identifier: ProductID.hours8)
        await p.restore()
        XCTAssertEqual(p.activePlan, "pro")
        // Expiring the subscription removes the plan.
        for t in session.allTransactions() where t.productIdentifier == ProductID.proMonth { try session.expireSubscription(productIdentifier: t.productIdentifier) }
        for _ in 0..<40 where p.activePlan != nil { await p.refresh(); try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertNil(p.activePlan)
    }
}
