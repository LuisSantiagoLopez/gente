// Copyright 2026 DeskHead Inc.
// A network capture for tests: every request any URLSession in Gente makes (through GenteHTTP)
// is recorded here with its full body, and answered by a scripted fake Gente Cloud.
import Foundation
@testable import Gente

struct Captured { var url: URL; var method: String; var body: Data }

final class CaptureProtocol: URLProtocol {
    static var captured: [Captured] = []
    static var lock = NSLock()
    static var handler: (URLRequest, Data) -> (Int, [String: String], Data) = { _, _ in (404, [:], Data()) }

    static func reset() { lock.lock(); captured = []; lock.unlock() }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    static func bodyOf(_ r: URLRequest) -> Data {
        if let b = r.httpBody { return b }
        guard let s = r.httpBodyStream else { return Data() }
        s.open(); defer { s.close() }
        var d = Data(); var buf = [UInt8](repeating: 0, count: 4096)
        while s.hasBytesAvailable { let n = s.read(&buf, maxLength: buf.count); if n <= 0 { break }; d.append(buf, count: n) }
        return d
    }

    override func startLoading() {
        let body = Self.bodyOf(request)
        Self.lock.lock(); Self.captured.append(Captured(url: request.url!, method: request.httpMethod ?? "GET", body: body)); Self.lock.unlock()
        let (status, headers, data) = Self.handler(request, body)
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    static func session(recorder: @escaping (EgressRecord) -> Void) -> GenteHTTP {
        let c = GenteHTTP.privateConfiguration()
        c.protocolClasses = [CaptureProtocol.self]
        return GenteHTTP(configuration: c, recorder: recorder)
    }
}

enum FakeCloud {
    static func sse(_ chunks: [[String: Any]]) -> Data {
        var s = ""
        for c in chunks { s += "data: " + String(data: try! JSONSerialization.data(withJSONObject: c), encoding: .utf8)! + "\n\n" }
        return Data((s + "data: [DONE]\n\n").utf8)
    }
    static func text(_ t: String) -> Data {
        sse([["choices": [["index": 0, "delta": ["content": t]]]], ["choices": [["index": 0, "delta": [:], "finish_reason": "stop"]]]])
    }
    static func toolCall(_ name: String, _ args: [String: Any]) -> Data {
        let a = String(data: try! JSONSerialization.data(withJSONObject: args), encoding: .utf8)!
        let half = a.index(a.startIndex, offsetBy: a.count / 2)
        return sse([
            ["choices": [["index": 0, "delta": ["tool_calls": [["index": 0, "id": "call_1", "type": "function", "function": ["name": name, "arguments": String(a[..<half])]]]]]]],
            ["choices": [["index": 0, "delta": ["tool_calls": [["index": 0, "function": ["arguments": String(a[half...])]]]]]]],
            ["choices": [["index": 0, "delta": [:], "finish_reason": "tool_calls"]]],
        ])
    }
}
