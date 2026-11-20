// Copyright 2026 DeskHead Inc.
// The agent loop on the phone: build context, stream the answer, run tools (asking first when the
// rules say so), save everything to the encrypted store.
import Foundation
import Observation
import UIKit

enum AIPlace: String, CaseIterable, Codable, Identifiable {
    case cloud, desktop, onDevice
    var id: String { rawValue }
    var title: String {
        switch self {
        case .cloud: String(localized: "Cloud (fast)")
        case .desktop: String(localized: "On my computer")
        case .onDevice: String(localized: "On this iPhone")
        }
    }
    var detail: String {
        switch self {
        case .cloud: String(localized: "Answered on our servers, not stored.")
        case .desktop: String(localized: "Your own computer answers. Sealed end to end; the cloud only passes it along.")
        case .onDevice: String(localized: "A small model on this iPhone. Not available yet.")
        }
    }
    var symbol: String {
        switch self { case .cloud: "bolt.fill"; case .desktop: "desktopcomputer"; case .onDevice: "iphone" }
    }
}

struct PendingApproval: Identifiable {
    let id = UUID()
    let call: ToolCall
    let reasons: [ApprovalReason]
    let summary: String
    let decide: (Bool) -> Void
}

@MainActor @Observable
final class ChatEngine {
    static let shared = ChatEngine()

    var store = EncryptedStore.shared
    var inference = InferenceClient()
    var tools = ToolRunner()
    var sync: SyncEngine { syncOverride ?? SyncEngine.shared }
    var syncOverride: SyncEngine?
    /// Self-heal "slow-replies": no first word from Gente Cloud after this long, and a computer is paired.
    var slowAfter: Duration = .seconds(12)
    var context = ContextBuilder()

    var chats: [Chat] = []
    var messages: [String: [Message]] = [:]
    /// The answer being written right now, per chat.
    var streaming: [String: String] = [:]
    var working: Set<String> = []
    var liveSteps: [String: [String]] = [:]
    var error: FriendlyError?
    var approval: PendingApproval?
    var liveBrowser: URL?
    var replyCount = 0
    var place: AIPlace {
        didSet { UserDefaults.standard.set(place.rawValue, forKey: "aiPlace") }
    }
    private var tasks: [String: Task<Void, Never>] = [:]

    init() {
        place = AIPlace(rawValue: UserDefaults.standard.string(forKey: "aiPlace") ?? "") ?? .cloud
        if place == .onDevice { place = .cloud }
        reload()
        tools.onBrowserOpened = { [weak self] u in self?.liveBrowser = u }
        NotificationCenter.default.addObserver(forName: .genteSynced, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.reload() }
        }
    }

    func reload() {
        chats = store.chats()
        for c in chats where messages[c.id] != nil { messages[c.id] = store.messages(chat: c.id) }
    }

    func load(_ chat: String) -> [Message] {
        if let m = messages[chat] { return m }
        let m = store.messages(chat: chat)
        messages[chat] = m
        return m
    }

    func newChat(title: String = "") -> Chat {
        let c = Chat(title: title)
        store.saveChat(c)
        chats.insert(c, at: 0)
        messages[c.id] = []
        return c
    }

    func delete(_ chat: Chat) {
        store.deleteChat(chat.id)
        chats.removeAll { $0.id == chat.id }
        messages[chat.id] = nil
    }

    private func save(_ m: Message) {
        store.saveMessage(m)
        messages[m.chatId, default: []].append(m)
        SyncEngine.shared.chatChanged(m.chatId)
    }

    func stop(_ chat: String) { tasks[chat]?.cancel() }

    func send(_ text: String, in chatId: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !working.contains(chatId) else { return }
        error = nil
        if var c = chats.first(where: { $0.id == chatId }) {
            if c.title.isEmpty { c.title = String(trimmed.prefix(48)) }
            c.updatedAt = Date()
            store.saveChat(c)
            chats.removeAll { $0.id == chatId }
            chats.insert(c, at: 0)
        }
        save(Message(chatId: chatId, role: .user, text: trimmed))
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        working.insert(chatId)
        tasks[chatId] = Task { await run(chatId); }
    }

    private func run(_ chatId: String) async {
        defer {
            working.remove(chatId)
            streaming[chatId] = nil
            liveSteps[chatId] = nil
            tasks[chatId] = nil
            Task { await tools.finish(); liveBrowser = nil }
        }
        var steps: [String] = []
        var sources: [Source] = []
        do {
            for _ in 0..<6 {
                let wire = context.build(history: load(chatId), brain: store.brain())
                let stream: AsyncThrowingStream<StreamEvent, Error>
                let by: AnsweredBy
                switch place {
                case .desktop:
                    stream = try await sync.privateInfer(wire); by = .desktop
                default:
                    if try await waitForFastMode(chatId) {
                        stream = try await sync.privateInfer(wire); by = .desktop
                    } else {
                        (stream, by) = try await cloudWithSlowGuard(wire)
                    }
                }
                var text = ""
                var calls: [ToolCall] = []
                var answered = by
                streaming[chatId] = ""
                for try await e in stream {
                    switch e {
                    case .text(let t): text += t; streaming[chatId] = text
                    case .toolCalls(let c): calls += c
                    case .done(let stub): if stub { answered = .cloudPreview }
                    }
                }
                if calls.isEmpty {
                    save(Message(chatId: chatId, role: .assistant, text: text, answeredBy: answered,
                                 sources: sources.isEmpty ? nil : sources, steps: steps.isEmpty ? nil : steps))
                    replyCount += 1
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    return
                }
                save(Message(chatId: chatId, role: .assistant, text: text, answeredBy: by, toolCalls: calls))
                for call in calls {
                    let reasons = ApprovalRules.reasons(tool: call.name, arguments: call.arguments)
                    var ok = true
                    if !reasons.isEmpty { ok = await ask(call, reasons: reasons) }
                    let outcome: ToolOutcome
                    if ok {
                        liveSteps[chatId, default: []].append(Self.stepInProgress(call.name))
                        outcome = await tools.run(call)
                    } else {
                        outcome = ToolOutcome(text: "The person said no. Do not try this again; offer another way.",
                                              step: String(localized: "You said no, so Gente stopped"))
                    }
                    steps.append(outcome.step)
                    sources += outcome.sources
                    liveSteps[chatId] = steps
                    save(Message(chatId: chatId, role: .tool, text: outcome.text, toolCallId: call.id, toolName: call.name))
                }
            }
        } catch {
            self.error = Friendly.from(error)
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        }
    }

    /// Self-heal "cloud-model-unavailable". The cloud GPU sleeps overnight. With a paired
    /// computer, that computer answers instead (returns true). Without one, wait while it wakes.
    /// "off" with no computer: the server still answers (a short placeholder until the GPU is live).
    private func waitForFastMode(_ chatId: String) async throws -> Bool {
        let start = Date()
        var status = await inference.api.inferenceStatus()
        if status != .warm && sync.paired {
            SelfHeal.shared.record(.cloudModelUnavailable, .fixed, fixedBy: .answerOnYourComputer, since: start)
            return true
        }
        var tries = 0
        while status == .waking && tries < 30 {
            liveSteps[chatId] = [String(localized: "Waking up the fast AI (about a minute)…")]
            try await Task.sleep(for: .seconds(4))
            status = await inference.api.inferenceStatus()
            tries += 1
        }
        liveSteps[chatId] = nil
        if tries > 0 {
            SelfHeal.shared.record(.cloudModelUnavailable, status == .warm ? .fixed : .stillTrying,
                                   fixedBy: status == .warm ? .waitForCloud : nil, since: start)
        }
        return false
    }

    /// Self-heal "slow-replies": if Gente Cloud sends no first word in time and a computer is
    /// paired, the computer answers instead. Without a computer we keep waiting (silent).
    private func cloudWithSlowGuard(_ wire: [WireMessage]) async throws -> (AsyncThrowingStream<StreamEvent, Error>, AnsweredBy) {
        let start = Date()
        let cloud = try await inference.stream(wire, tools: ToolSpec.all)
        guard sync.paired else { return (cloud, .cloud) }
        let (out, cont) = AsyncThrowingStream<StreamEvent, Error>.makeStream()
        let seen = FirstWord()
        let pump = Task {
            do {
                for try await e in cloud { await seen.mark(); cont.yield(e) }
                cont.finish()
            } catch { cont.finish(throwing: error) }
        }
        let deadline = ContinuousClock.now + slowAfter
        while ContinuousClock.now < deadline {
            if await seen.value { return (out, .cloud) }
            try await Task.sleep(for: .milliseconds(50))
        }
        if await seen.value { return (out, .cloud) }
        pump.cancel()
        cont.finish()
        SelfHeal.shared.record(.slowReplies, .fixed, fixedBy: .answerOnYourComputer, since: start)
        return (try await sync.privateInfer(wire), .desktop)
    }

    static func stepInProgress(_ tool: String) -> String {
        switch tool {
        case "web_search": String(localized: "Searching the web…")
        case "browse": String(localized: "Opening a browser…")
        case "apps": String(localized: "Working in your apps…")
        case "make_image": String(localized: "Making an image…")
        default: String(localized: "Working…")
        }
    }

    private func ask(_ call: ToolCall, reasons: [ApprovalReason]) async -> Bool {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        NotificationScheduler.approvalIfBackground(reasons.first!.title)
        return await withCheckedContinuation { cont in
            approval = PendingApproval(call: call, reasons: reasons, summary: Self.describe(call)) { [weak self] yes in
                self?.approval = nil
                cont.resume(returning: yes)
            }
        }
    }

    static func describe(_ call: ToolCall) -> String {
        let args = (try? JSONSerialization.jsonObject(with: Data(call.arguments.utf8))) as? [String: Any] ?? [:]
        if call.name == "apps" {
            let tool = (args["tool"] as? String ?? "").replacingOccurrences(of: "_", with: " ").lowercased()
            return String(localized: "Gente wants to: \(tool)")
        }
        if call.name == "browse" { return String(localized: "Gente wants to act on a web page.") }
        return String(localized: "Gente wants to use \(call.name).")
    }
}

private actor FirstWord {
    private(set) var value = false
    func mark() { value = true }
}
