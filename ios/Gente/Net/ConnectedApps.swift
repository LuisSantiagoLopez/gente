// Copyright 2026 DeskHead Inc.
// Connecting apps from the phone, through Gente Cloud's Composio proxy (per-person Tool Router
// session). Sign-in happens on the app's own page in Safari; Gente never sees the password.
import Foundation
import Observation

struct AppToolkit: Identifiable, Hashable {
    var id: String          // Composio toolkit slug
    var name: String
    var symbol: String
    static let common: [AppToolkit] = [
        .init(id: "gmail", name: "Gmail", symbol: "envelope"),
        .init(id: "googlecalendar", name: "Google Calendar", symbol: "calendar"),
        .init(id: "googledrive", name: "Google Drive", symbol: "externaldrive"),
        .init(id: "slack", name: "Slack", symbol: "number"),
        .init(id: "notion", name: "Notion", symbol: "doc.text"),
        .init(id: "github", name: "GitHub", symbol: "chevron.left.forwardslash.chevron.right"),
        .init(id: "outlook", name: "Outlook", symbol: "envelope.badge"),
        .init(id: "linear", name: "Linear", symbol: "checklist"),
    ]
}

@MainActor @Observable
final class ConnectedApps {
    static let shared = ConnectedApps()
    var api = CloudAPI.shared
    private(set) var connected: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "apps.connected") ?? [])
    private(set) var toolNames: Set<String> = []
    var busy: String?

    private func remember() { UserDefaults.standard.set(Array(connected), forKey: "apps.connected") }

    func loadTools() async throws {
        guard toolNames.isEmpty else { return }
        let r = try await api.composio("tools/list", params: [:])
        toolNames = Set((r["tools"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String })
    }

    /// Asks Composio for a sign-in link for this app. Returns nil when it is already connected.
    func connectLink(_ toolkit: String) async throws -> URL? {
        busy = toolkit; defer { busy = nil }
        try? await loadTools()
        let r = try await api.composio("tools/call", params: ["name": "COMPOSIO_MANAGE_CONNECTIONS",
                                                              "arguments": ["toolkits": [toolkit]]])
        if let url = Self.firstLink(in: r) { return url }
        if Self.mentionsActive(r) { connected.insert(toolkit); remember() }
        return nil
    }

    /// After the person comes back from the sign-in page.
    func refresh(_ toolkit: String) async {
        busy = toolkit; defer { busy = nil }
        let name = toolNames.first { $0.hasPrefix("COMPOSIO_CHECK_ACTIVE_CONNECTION") } ?? "COMPOSIO_MANAGE_CONNECTIONS"
        guard let r = try? await api.composio("tools/call", params: ["name": name, "arguments": ["toolkits": [toolkit]]]) else { return }
        if Self.firstLink(in: r) == nil && Self.mentionsActive(r) { connected.insert(toolkit) } else { connected.remove(toolkit) }
        remember()
    }

    func forget(_ toolkit: String) { connected.remove(toolkit); remember() }

    /// Runs an app action the model chose. Meta tools are called directly; app actions go through
    /// COMPOSIO_MULTI_EXECUTE_TOOL when the session exposes it.
    func run(_ slug: String, arguments: Any) async throws -> [String: Any] {
        try? await loadTools()
        if toolNames.contains(slug) || slug.hasPrefix("COMPOSIO_") || toolNames.isEmpty {
            return try await api.composio("tools/call", params: ["name": slug, "arguments": arguments])
        }
        return try await api.composio("tools/call", params: ["name": "COMPOSIO_MULTI_EXECUTE_TOOL",
                                                             "arguments": ["tools": [["tool_slug": slug, "arguments": arguments]]]])
    }

    // MARK: Reading Composio's answers (MCP content is text that usually holds JSON)

    static func texts(_ r: [String: Any]) -> [String] {
        var out: [String] = []
        for c in r["content"] as? [[String: Any]] ?? [] { if let t = c["text"] as? String { out.append(t) } }
        if out.isEmpty, let d = try? JSONSerialization.data(withJSONObject: r), let s = String(data: d, encoding: .utf8) { out.append(s) }
        return out
    }

    static func firstLink(in r: [String: Any]) -> URL? {
        let joined = texts(r).joined(separator: "\n")
        let pattern = #"https://[^\s"'\\<>]+"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        for m in re.matches(in: joined, range: NSRange(joined.startIndex..., in: joined)) {
            guard let range = Range(m.range, in: joined), let u = URL(string: String(joined[range])) else { continue }
            let s = u.absoluteString.lowercased()
            if s.contains("redirect") || s.contains("connect") || s.contains("oauth") || s.contains("auth") || s.contains("link") { return u }
        }
        return nil
    }

    static func mentionsActive(_ r: [String: Any]) -> Bool {
        texts(r).joined().lowercased().range(of: #"active|connected"#, options: .regularExpression) != nil
    }
}
