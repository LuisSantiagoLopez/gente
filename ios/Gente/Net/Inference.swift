// Copyright 2026 DeskHead Inc.
// Fast mode: OpenAI-compatible chat completions on Gente Cloud (/v1/inference/chat/completions).
// The server answers in memory and keeps nothing; this file is the only place chat context leaves.
import Foundation

enum StreamEvent: Equatable {
    case text(String)
    case toolCalls([ToolCall])
    case done(stub: Bool)
}

struct WireMessage: Encodable {
    var role: String
    var content: String?
    var tool_calls: [WireToolCall]?
    var tool_call_id: String?
    var name: String?
    struct WireToolCall: Encodable {
        var id: String
        var type = "function"
        var function: Fn
        struct Fn: Encodable { var name: String; var arguments: String }
    }
}

/// Parses an OpenAI streaming body. Tool call pieces arrive split across chunks; this joins them.
struct SSEAccumulator {
    private var calls: [Int: (id: String, name: String, args: String)] = [:]

    mutating func feed(_ line: String) -> [StreamEvent] {
        guard line.hasPrefix("data:") else { return [] }
        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        if payload == "[DONE]" { return finish() }
        guard let d = payload.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let choices = o["choices"] as? [[String: Any]], let c = choices.first else { return [] }
        var out: [StreamEvent] = []
        let delta = c["delta"] as? [String: Any] ?? c["message"] as? [String: Any] ?? [:]
        if let t = delta["content"] as? String, !t.isEmpty { out.append(.text(t)) }
        for tc in delta["tool_calls"] as? [[String: Any]] ?? [] {
            let i = tc["index"] as? Int ?? 0
            var cur = calls[i] ?? ("", "", "")
            if let id = tc["id"] as? String { cur.id = id }
            if let f = tc["function"] as? [String: Any] {
                if let n = f["name"] as? String { cur.name += n }
                if let a = f["arguments"] as? String { cur.args += a }
            }
            calls[i] = cur
        }
        if let reason = c["finish_reason"] as? String, reason == "tool_calls" { out += finish() }
        return out
    }

    mutating func finish() -> [StreamEvent] {
        guard !calls.isEmpty else { return [] }
        let list = calls.keys.sorted().map { i -> ToolCall in
            let c = calls[i]!
            return ToolCall(id: c.id.isEmpty ? "call_\(i)" : c.id, name: c.name, arguments: c.args.isEmpty ? "{}" : c.args)
        }
        calls = [:]
        return [.toolCalls(list)]
    }
}

final class InferenceClient {
    var api = CloudAPI.shared

    func body(_ messages: [WireMessage], tools: [[String: Any]]) throws -> Data {
        let enc = JSONEncoder()
        let msgs = try JSONSerialization.jsonObject(with: enc.encode(messages))
        var b: [String: Any] = ["model": "swift-1.5-27b", "stream": true, "messages": msgs, "temperature": 0.6]
        if !tools.isEmpty { b["tools"] = tools; b["tool_choice"] = "auto" }
        return try JSONSerialization.data(withJSONObject: b)
    }

    func stream(_ messages: [WireMessage], tools: [[String: Any]]) async throws -> AsyncThrowingStream<StreamEvent, Error> {
        var r = try await api.request("/v1/inference/chat/completions", method: "POST")
        r.httpBody = try body(messages, tools: tools)
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (lines, resp) = try await api.http.lines(r, service: .inference, carries: .chatContext)
        if !(200..<300).contains(resp.statusCode) {
            var raw = ""
            for try await l in lines { raw += l }
            throw CloudAPI.failure(resp.statusCode, Data(raw.utf8))
        }
        let stub = resp.value(forHTTPHeaderField: "x-gente-fast-stub") == "1"
        return AsyncThrowingStream { cont in
            let t = Task {
                var acc = SSEAccumulator()
                do {
                    for try await line in lines {
                        for e in acc.feed(line) { cont.yield(e) }
                    }
                    for e in acc.finish() { cont.yield(e) }
                    cont.yield(.done(stub: stub))
                    cont.finish()
                } catch { cont.finish(throwing: error) }
            }
            cont.onTermination = { _ in t.cancel() }
        }
    }
}
