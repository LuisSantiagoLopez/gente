// Copyright 2026 DeskHead Inc.
// A tiny fake Gente Cloud on 127.0.0.1 for UI tests (Debug builds allow http to localhost only).
// It speaks the same paths and shapes as the real API (SHARED.md) and records what it received.
import Foundation
import Network

final class MockCloud {
    let listener: NWListener
    let port: UInt16
    private(set) var requests: [(path: String, body: String)] = []
    private let lock = NSLock()
    private var inferenceRound: [String: Int] = [:]
    private var manageCalls = 0

    init() throws {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        var l: NWListener?
        var chosen: UInt16 = 0
        for p in UInt16(18_700)...UInt16(18_799) {
            if let x = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: p)!) { l = x; chosen = p; break }
        }
        listener = l!
        port = chosen
        listener.newConnectionHandler = { [weak self] c in self?.handle(c) }
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { s in if case .ready = s { ready.signal() } }
        listener.start(queue: .global())
        _ = ready.wait(timeout: .now() + 5)
    }

    var base: String { "http://127.0.0.1:\(port)" }
    func stop() { listener.cancel() }

    func received(_ path: String) -> [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.filter { $0.path.hasPrefix(path) }.map(\.body)
    }

    private func handle(_ c: NWConnection) {
        c.start(queue: .global())
        var buffer = Data()
        func readMore() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { data, _, done, _ in
                if let data { buffer.append(data) }
                if let req = Self.parse(buffer) {
                    let resp = self.respond(method: req.method, path: req.path, body: req.body)
                    c.send(content: resp, completion: .contentProcessed { _ in c.cancel() })
                } else if !done { readMore() } else { c.cancel() }
            }
        }
        readMore()
    }

    static func parse(_ d: Data) -> (method: String, path: String, body: String)? {
        guard let headEnd = d.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let head = String(data: d[..<headEnd.lowerBound], encoding: .utf8) ?? ""
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        let len = lines.first { $0.lowercased().hasPrefix("content-length:") }.flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
        let body = d[headEnd.upperBound...]
        guard body.count >= len else { return nil }
        return (String(first[0]), String(first[1]), String(data: body.prefix(len), encoding: .utf8) ?? "")
    }

    func http(_ status: Int, _ type: String, _ body: Data, extra: String = "") -> Data {
        var h = "HTTP/1.1 \(status) OK\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\(extra)\r\n"
        if status == 304 { h = "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n" }
        return Data(h.utf8) + body
    }
    func json(_ o: Any, _ status: Int = 200) -> Data { http(status, "application/json", try! JSONSerialization.data(withJSONObject: o)) }

    static func sse(_ chunks: [[String: Any]]) -> Data {
        var s = ""
        for c in chunks { s += "data: " + String(data: try! JSONSerialization.data(withJSONObject: c), encoding: .utf8)! + "\n\n" }
        return Data((s + "data: [DONE]\n\n").utf8)
    }
    static func words(_ t: String) -> Data {
        let parts = t.split(separator: " ", omittingEmptySubsequences: false).map { String($0) + " " }
        return sse(parts.map { ["choices": [["index": 0, "delta": ["content": $0]]]] } + [["choices": [["index": 0, "delta": [:], "finish_reason": "stop"]]]])
    }
    static func tool(_ name: String, _ args: [String: Any]) -> Data {
        let a = String(data: try! JSONSerialization.data(withJSONObject: args), encoding: .utf8)!
        return sse([["choices": [["index": 0, "delta": ["tool_calls": [["index": 0, "id": "call_1", "type": "function", "function": ["name": name, "arguments": a]]]]]]],
                    ["choices": [["index": 0, "delta": [:], "finish_reason": "tool_calls"]]]])
    }

    private func respond(method: String, path: String, body: String) -> Data {
        lock.lock(); requests.append((path, body)); lock.unlock()
        let p = path.components(separatedBy: "?")[0]
        switch (method, p) {
        case ("POST", "/v1/inference/chat/completions"):
            let msgs = ((try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any])?["messages"] as? [[String: Any]] ?? []
            let lastUser = (msgs.last { $0["role"] as? String == "user" }?["content"] as? String ?? "").lowercased()
            let afterTool = msgs.last?["role"] as? String == "tool"
            let sse: Data
            if !afterTool && (lastUser.contains("weather") || lastUser.contains("clima") || lastUser.contains("tempo")) {
                sse = Self.tool("web_search", ["query": "weather this weekend"])
            } else if !afterTool && (lastUser.contains("email") || lastUser.contains("correo")) {
                sse = Self.tool("apps", ["tool": "GMAIL_SEND_EMAIL", "arguments": ["to": "ana@example.com", "subject": "Thursday"]])
            } else if afterTool {
                let toolText = msgs.last?["content"] as? String ?? ""
                sse = Self.words(toolText.contains("said no") ? "Okay. I didn't send anything." :
                                 lastUser.contains("email") ? "Sent. Ana will see it in her inbox." :
                                 "Saturday looks warm, around 24°C, with a chance of showers after 4 pm. Plan outdoor things for the morning.")
            } else {
                sse = Self.words("Here's a simple plan: start with the hardest task while you're fresh, take a real lunch break, and leave Friday afternoon for anything that slipped.")
            }
            return http(200, "text/event-stream", sse, extra: "x-gente-not-stored: content=none; logs=none; kept=token-counts\r\n")
        case ("POST", "/v1/proxy/search"):
            return json(["results": [["title": "Weather forecast", "url": "https://weather.gov/forecast", "text": "Warm, 24C, showers after 4 pm."]]])
        case ("POST", "/v1/proxy/composio/mcp"):
            let rpc = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any] ?? [:]
            let params = rpc["params"] as? [String: Any] ?? [:]
            if rpc["method"] as? String == "tools/list" {
                return json(["jsonrpc": "2.0", "id": "1", "result": ["tools": ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_MULTI_EXECUTE_TOOL"].map { ["name": $0] }]])
            }
            if params["name"] as? String == "COMPOSIO_MANAGE_CONNECTIONS" {
                lock.lock(); manageCalls += 1; let n = manageCalls; lock.unlock()
                let text = n == 1 ? #"{"results":{"gmail":{"status":"INITIATED","redirect_url":"https://example.com/?composio_connect=gmail"}}}"#
                                  : #"{"results":{"gmail":{"status":"ACTIVE"}}}"#
                return json(["jsonrpc": "2.0", "id": "1", "result": ["content": [["type": "text", "text": text]]]])
            }
            return json(["jsonrpc": "2.0", "id": "1", "result": ["content": [["type": "text", "text": "Email sent."]]]])
        case ("POST", "/v1/proxy/tts"):
            return json(["error": "plan_has_no_cloud", "message": "Free plan"], 402)
        case ("GET", "/v1/me/plan"):
            return json(["id": "pro", "status": "active", "cloud": true, "monthlyOnlineHours": 37])
        case ("GET", "/v1/balance"):
            return json(["planSeconds": 120_000, "topupSeconds": 0, "totalSeconds": 120_000, "totalHours": 33.3])
        case ("GET", "/v1/store/account-token"):
            return json(["appleAppAccountToken": "6f1c1f3e-4e0b-4b8f-9a55-3c2d9b0b7a10"])
        case ("POST", "/v1/billing/apple/verify"):
            return json(["ok": true, "plan": "pro"])
        case ("DELETE", "/v1/me"):
            return json(["receiptId": "rcpt_test_1", "cancelInStore": []])
        case ("GET", "/v1/me/data/receipts"):
            return json(["publicKeyUrl": "/v1/receipts/public-key", "receipts": [["id": "r1", "userHash": "u", "objectType": "relay_message", "objectHash": "o", "reason": "user", "deletedAt": "2026-11-19T10:00:00.000Z", "digest": "00", "signature": "AA"]]])
        case ("POST", "/v1/devices"):
            return json(["deviceId": UUID().uuidString.lowercased()], 201)
        default:
            return json(["error": "not_found"], 404)
        }
    }
}
