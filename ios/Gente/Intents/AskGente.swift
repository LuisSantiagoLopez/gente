// Copyright 2026 DeskHead Inc.
// Siri and Shortcuts: "Ask Gente…"
import AppIntents
import Foundation

struct AskGenteIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Gente"
    static var description = IntentDescription("Ask Gente anything. The chat stays on your iPhone.")
    static var openAppWhenRun = true

    @Parameter(title: "Question", requestValueDialog: "What should Gente do?")
    var question: String

    @MainActor
    func perform() async throws -> some IntentResult {
        DeepLink.pending = .ask(question)
        return .result()
    }
}

struct NewChatIntent: AppIntent {
    static var title: LocalizedStringResource = "New Gente chat"
    static var openAppWhenRun = true
    @MainActor
    func perform() async throws -> some IntentResult {
        DeepLink.pending = .newChat
        return .result()
    }
}

struct GenteShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskGenteIntent(), phrases: ["Ask \(.applicationName)", "Ask \(.applicationName) something"],
                    shortTitle: "Ask Gente", systemImageName: "bubble.left.and.text.bubble.right")
        AppShortcut(intent: NewChatIntent(), phrases: ["New \(.applicationName) chat"],
                    shortTitle: "New chat", systemImageName: "square.and.pencil")
    }
}

enum DeepLink: Equatable {
    case ask(String), newChat, chat(String), pair(URL)
    @MainActor static var pending: DeepLink? {
        didSet { NotificationCenter.default.post(name: .genteDeepLink, object: nil) }
    }
    static func parse(_ url: URL) -> DeepLink? {
        if url.scheme == "gente", url.host == "pair" { return .pair(url) }
        if url.scheme == "gente", url.host == "new" { return .newChat }
        if url.scheme == "gente", url.host == "chat", let id = url.pathComponents.dropFirst().first { return .chat(id) }
        if url.scheme == "gente", url.host == "ask",
           let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value { return .ask(q) }
        return nil
    }
}

extension Notification.Name { static let genteDeepLink = Notification.Name("gente.deeplink") }
