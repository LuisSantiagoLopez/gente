// Copyright 2026 DeskHead Inc.
// Builds each request on the phone: the fixed system prompt, a few memories that match, and the
// recent turns. Nothing else goes. The server never sees the full history or the whole brain.
import Foundation

struct ContextBuilder {
    var maxTurns = 14
    var maxChars = 24_000
    var maxMemories = 5

    /// Simple, private retrieval: word overlap with a small boost for recent items.
    static func retrieve(_ query: String, from items: [BrainItem], limit: Int) -> [BrainItem] {
        let q = Set(words(query))
        guard !q.isEmpty else { return [] }
        let scored = items.compactMap { item -> (BrainItem, Double)? in
            let w = Set(words(item.title + " " + item.body))
            let hit = Double(q.intersection(w).count)
            guard hit > 0 else { return nil }
            let ageDays = Date().timeIntervalSince(item.updatedAt) / 86_400
            return (item, hit + max(0, 1 - ageDays / 60) * 0.5)
        }
        return scored.sorted { $0.1 > $1.1 }.prefix(limit).map(\.0)
    }

    static func words(_ s: String) -> [String] {
        s.lowercased().folding(options: .diacriticInsensitive, locale: nil)
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map(String.init).filter { $0.count > 2 }
    }

    func build(history: [Message], brain: [BrainItem], locale: String = Locale.current.identifier) -> [WireMessage] {
        var out = [WireMessage(role: "system", content: Config.systemPrompt)]
        let lastUser = history.last(where: { $0.role == .user })?.text ?? ""
        let picked = Self.retrieve(lastUser, from: brain, limit: maxMemories)
        if !picked.isEmpty {
            let notes = picked.map { "- [\($0.kind.rawValue)] \($0.title): \($0.body.prefix(600))" }.joined(separator: "\n")
            out.append(WireMessage(role: "system", content: "What you know about this person (from their phone):\n\(notes)"))
        }
        var tail: [Message] = []
        var budget = maxChars
        for m in history.reversed() {
            if tail.filter({ $0.role == .user }).count >= maxTurns / 2 && m.role == .user { break }
            budget -= m.text.count
            if budget < 0 && !tail.isEmpty { break }
            tail.insert(m, at: 0)
        }
        // A tool reply must follow the assistant message that asked for it.
        while let f = tail.first, f.role == .tool { tail.removeFirst() }
        for m in tail {
            switch m.role {
            case .user: out.append(WireMessage(role: "user", content: m.text))
            case .assistant:
                out.append(WireMessage(role: "assistant", content: m.text.isEmpty ? nil : m.text,
                                       tool_calls: m.toolCalls?.map { .init(id: $0.id, function: .init(name: $0.name, arguments: $0.arguments)) }))
            case .tool: out.append(WireMessage(role: "tool", content: m.text, tool_call_id: m.toolCallId, name: m.toolName))
            case .system: break
            }
        }
        return out
    }
}
