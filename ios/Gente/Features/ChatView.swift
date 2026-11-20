// Copyright 2026 DeskHead Inc.
import SwiftUI
import WebKit

struct ChatView: View {
    let chatId: String
    @Environment(ChatEngine.self) private var engine
    @Environment(SyncEngine.self) private var sync
    @State private var draft = ""
    @State private var showBrowser = false
    @State private var badgeInfo: AnsweredBy?
    @State private var handedOff = false

    var messages: [Message] { engine.messages[chatId]?.filter { $0.role != .tool && !($0.role == .assistant && $0.text.isEmpty) } ?? [] }
    var title: String { engine.chats.first(where: { $0.id == chatId })?.title ?? "" }

    var body: some View {
        @Bindable var engine = engine
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(messages) { m in
                        MessageView(message: m, onBadge: { badgeInfo = $0 })
                            .id(m.id)
                            .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                    }
                    if engine.working.contains(chatId) {
                        WorkingView(text: engine.streaming[chatId] ?? "", steps: engine.liveSteps[chatId] ?? [], place: engine.place)
                            .id("live")
                    }
                    if let e = engine.error {
                        ErrorCard(error: e) { retry() }
                            .id("error")
                    }
                    Color.clear.frame(height: 4).id("bottom")
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
                .animation(G.spring, value: messages.count)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: engine.streaming[chatId]) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: messages.count) { _, _ in withAnimation(G.spring) { proxy.scrollTo("bottom", anchor: .bottom) } }
        }
        .background(G.background)
        .safeAreaInset(edge: .bottom) {
            Composer(text: $draft, working: engine.working.contains(chatId),
                     send: { engine.send(draft, in: chatId); draft = "" },
                     stop: { engine.stop(chatId) })
        }
        .navigationTitle(title.isEmpty ? String(localized: "New chat") : title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(selection: $engine.place) {
                        ForEach(AIPlace.allCases.filter { $0 != .onDevice }) { p in
                            Label(p.title, systemImage: p.symbol).tag(p)
                        }
                    } label: { Text("Where the AI runs") }
                    if sync.desktop != nil {
                        Button { handoff() } label: { Label("Continue on my computer", systemImage: "arrow.up.forward.app") }
                    }
                } label: { Image(systemName: engine.place.symbol) }
                .accessibilityLabel(Text("Where the AI runs"))
            }
        }
        .sheet(item: $engine.approval) { a in ApprovalSheet(approval: a).presentationDetents([.medium]) }
        .sheet(isPresented: $showBrowser) { BrowserLiveSheet(url: engine.liveBrowser) }
        .sheet(item: $badgeInfo) { b in BadgeExplainer(by: b).presentationDetents([.height(320), .large]) }
        .onChange(of: engine.liveBrowser) { _, u in showBrowser = u != nil }
        .sensoryFeedback(.success, trigger: engine.replyCount)
        .userActivity("com.deskhead.gente.chat") { a in
            a.title = title
            a.userInfo = ["chatId": chatId]
            a.isEligibleForHandoff = true
            a.isEligibleForSearch = false
            a.isEligibleForPrediction = false
        }
        .overlay(alignment: .top) {
            if handedOff {
                Label("Open on your computer", systemImage: "checkmark.circle.fill")
                    .font(.gente(.subheadline, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule()).transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    func retry() {
        guard let last = engine.messages[chatId]?.last(where: { $0.role == .user }) else { return }
        engine.error = nil
        engine.messages[chatId]?.removeAll { $0.id == last.id }
        EncryptedStore.shared.delete("message", id: last.id)
        engine.send(last.text, in: chatId)
    }

    func handoff() {
        guard let desk = sync.desktop else { return }
        Task {
            let p = SyncPayload(type: "handoff.open", id: chatId, at: Int64(Date().timeIntervalSince1970 * 1000), body: Data(chatId.utf8))
            try? await sync.send(p, to: desk)
            withAnimation(G.spring) { handedOff = true }
            try? await Task.sleep(for: .seconds(2))
            withAnimation(G.spring) { handedOff = false }
        }
    }
}

extension AnsweredBy: Identifiable { var id: String { rawValue } }

struct MessageView: View {
    let message: Message
    var onBadge: (AnsweredBy) -> Void

    var body: some View {
        if message.role == .user {
            HStack {
                Spacer(minLength: 48)
                Text(message.text).font(.gente(.body))
                    .foregroundStyle(G.onUserBubble)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(G.userBubble, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .textSelection(.enabled)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if let steps = message.steps, !steps.isEmpty { StepsView(steps: steps) }
                Text(markdown(message.text)).font(.gente(.body)).textSelection(.enabled).tint(G.link)
                if let s = message.sources, !s.isEmpty { SourcesView(sources: s) }
                HStack(spacing: 14) {
                    if let by = message.answeredBy { AnswerBadge(by: by).onTapGesture { onBadge(by) } }
                    Spacer()
                    SpeakButton(message: message)
                    Button { UIPasteboard.general.string = message.text } label: { Image(systemName: "doc.on.doc") }
                        .accessibilityLabel(Text("Copy"))
                }
                .font(.gente(.footnote)).foregroundStyle(G.faint)
            }
        }
    }

    func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}

struct SpeakButton: View {
    let message: Message
    @State private var speaker = Speaker.shared
    var body: some View {
        let on = speaker.speakingMessage == message.id
        Button { on ? speaker.stop() : speaker.speak(message.text, messageId: message.id) } label: {
            Image(systemName: on ? "stop.circle.fill" : "speaker.wave.2").contentTransition(.symbolEffect(.replace))
        }
        .accessibilityLabel(on ? Text("Stop reading") : Text("Read aloud"))
    }
}

/// "Answered on our servers, not stored." Shown under every answer.
struct AnswerBadge: View {
    let by: AnsweredBy
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: by == .cloud ? "bolt.shield" : by == .desktop ? "desktopcomputer" : "iphone")
            Text(label)
        }
        .font(.gente(.caption, weight: .medium))
        .foregroundStyle(G.link)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(G.primary.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Shows where this answer was made"))
        .accessibilityIdentifier("badge.\(by.rawValue)")
    }
    var label: String {
        switch by {
        case .cloud: String(localized: "Answered on our servers, not stored")
        case .desktop: String(localized: "Answered on your computer")
        case .onDevice: String(localized: "Answered on this iPhone")
        }
    }
}

struct BadgeExplainer: View {
    let by: AnsweredBy
    var body: some View {
        NavigationStack {
        VStack(alignment: .leading, spacing: 14) {
            AnswerBadge(by: by)
            Text(by == .cloud ? "Gente Cloud got only this question, a few recent turns and the notes it needed. It answered in memory, then forgot it. No logs of your words, no storage, no training."
                              : "Your own computer made this answer with its local AI. The question and answer crossed the internet sealed end to end; Gente Cloud only passed the sealed box along.")
                .font(.gente(.body))
            NavigationLink(value: Route.egress) { Text("See what left your phone") }
                .font(.gente(.body, weight: .semibold)).foregroundStyle(G.link)
            Spacer()
        }
        .padding(24)
        .navigationDestination(for: Route.self) { _ in EgressLogView() }
        }
        .presentationBackground(G.dialog)
    }
}

struct StepsView: View {
    let steps: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(steps.enumerated()), id: \.offset) { _, s in
                Label(s, systemImage: "checkmark").font(.gente(.footnote)).foregroundStyle(G.muted)
            }
        }
    }
}

struct SourcesView: View {
    let sources: [Source]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(sources.enumerated()), id: \.element.url) { i, s in
                    if let u = URL(string: s.url) {
                        Link(destination: u) {
                            Text(u.host ?? s.title).font(.gente(.caption, weight: .medium)).lineLimit(1)
                                .padding(.horizontal, 10).padding(.vertical, 6).genteCard()
                        }
                        .foregroundStyle(G.foreground)
                        .accessibilityLabel(Text("Source \(i + 1)"))
                        .accessibilityValue(Text(verbatim: s.title))
                    }
                }
            }
        }
    }
}

/// The answer as it streams: text eases in at a steady pace, the mark breathes, steps tick by.
struct WorkingView: View {
    let text: String
    let steps: [String]
    let place: AIPlace
    @State private var shown = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !steps.isEmpty { StepsView(steps: steps).transition(.opacity) }
            if shown.isEmpty {
                HStack(spacing: 10) {
                    GenteMark(size: 22, breathing: true)
                    Text(place == .desktop ? "Your computer is thinking…" : "Thinking…")
                        .font(.gente(.subheadline)).foregroundStyle(G.muted)
                }
            } else {
                Text(shown).font(.gente(.body)).contentTransition(.opacity)
            }
        }
        .task(id: text) { await catchUp() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(shown.isEmpty ? String(localized: "Gente is thinking") : shown))
    }

    /// Smooths bursty network chunks into an even, readable flow.
    func catchUp() async {
        while shown.count < text.count {
            let behind = text.count - shown.count
            let step = max(1, behind / 12)
            let end = text.index(text.startIndex, offsetBy: min(text.count, shown.count + step))
            withAnimation(.linear(duration: 0.05)) { shown = String(text[..<end]) }
            try? await Task.sleep(for: .milliseconds(16))
        }
    }
}

struct ErrorCard: View {
    let error: FriendlyError
    var retry: () -> Void
    @Environment(\.openURL) private var open
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(error.text).font(.gente(.body))
            HStack {
                switch error.action {
                case .retry: Button("Try again", action: retry)
                case .upgrade: NavigationLink(value: Route.paywall) { Text("See plans") }
                case .signIn: Button("Sign in") { Task { try? await Auth.shared.signIn() } }
                case .pair: NavigationLink(value: Route.devices) { Text("Pair your computer") }
                case .none: EmptyView()
                }
            }
            .font(.gente(.body, weight: .semibold)).foregroundStyle(G.link)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .genteCard()
        .accessibilityIdentifier("chat.error")
    }
}

/// One input box: type, or hold the mic to talk (speech to text on the phone).
struct Composer: View {
    @Binding var text: String
    var working: Bool
    var send: () -> Void
    var stop: () -> Void
    @State private var listener = Listener()
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 6) {
            if let u = listener.unavailable {
                Text(u).font(.gente(.footnote)).foregroundStyle(G.muted)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField(listener.listening ? String(localized: "Listening…") : String(localized: "Ask Gente"), text: $text, axis: .vertical)
                    .font(.gente(.body))
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.vertical, 10)
                    .accessibilityIdentifier("composer.field")
                if working {
                    circle("stop.fill", label: String(localized: "Stop"), action: stop)
                } else if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    circle(listener.listening ? "waveform" : "mic.fill", label: String(localized: "Talk"), active: listener.listening) {
                        Task {
                            if listener.listening { listener.stop() } else { await listener.start() }
                        }
                    }
                    .symbolEffect(.variableColor.iterative, isActive: listener.listening)
                } else {
                    circle("arrow.up", label: String(localized: "Send"), action: send)
                        .accessibilityIdentifier("composer.send")
                }
            }
            .padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 4)
            .background(G.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(focused ? G.primary.opacity(0.6) : G.border, lineWidth: 1))
            .animation(G.snappy, value: working)
            .animation(G.snappy, value: text.isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        .background(G.background.opacity(0.94))
        .onChange(of: listener.transcript) { _, t in if !t.isEmpty { text = t } }
        .onChange(of: listener.listening) { was, now in
            if was && !now && !text.isEmpty { send() }
        }
    }

    func circle(_ symbol: String, label: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(G.onPrimary)
                .frame(width: 38, height: 38)
                .background(active ? G.warning : G.primary, in: Circle())
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(PressableStyle())
        .sensoryFeedback(.impact(weight: .light), trigger: symbol)
        .accessibilityLabel(Text(label))
        .padding(.bottom, 3)
    }
}

struct ApprovalSheet: View {
    let approval: PendingApproval
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                ForEach(approval.reasons, id: \.self) { r in
                    Image(systemName: r.symbol).font(.title2).foregroundStyle(G.primary)
                }
            }
            Text(approval.reasons.map(\.title).joined(separator: " · ")).font(.gente(.title3, weight: .bold))
            Text(approval.summary).font(.gente(.body))
            Text(approval.call.arguments).font(.system(.footnote, design: .monospaced)).foregroundStyle(G.muted)
                .lineLimit(6).padding(10).frame(maxWidth: .infinity, alignment: .leading).genteCard()
            Text("Gente always asks before money, sending as you, deleting data or accepting terms.")
                .font(.gente(.footnote)).foregroundStyle(G.muted)
            Spacer()
            HStack(spacing: 12) {
                Button { approval.decide(false) } label: { Text("Don't do it").frame(maxWidth: .infinity, minHeight: 50) }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule).accessibilityIdentifier("approval.deny")
                Button { approval.decide(true) } label: { Text("Allow once") }
                    .buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("approval.allow")
            }
        }
        .padding(24)
        .interactiveDismissDisabled()
        .presentationBackground(G.dialog)
    }
}

struct BrowserLiveSheet: View {
    let url: URL?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Group {
                if let url { LiveWebView(url: url) } else { ProgressView() }
            }
            .navigationTitle(Text("Live view"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct LiveWebView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .nonPersistent()
        let v = WKWebView(frame: .zero, configuration: c)
        v.load(URLRequest(url: url))
        return v
    }
    func updateUIView(_ v: WKWebView, context: Context) {}
}
