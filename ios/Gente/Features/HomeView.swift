// Copyright 2026 DeskHead Inc.
import SwiftUI

enum Route: Hashable { case chat(String), settings, egress, data, devices, brain, routines, paywall }

struct HomeView: View {
    @Environment(ChatEngine.self) private var engine
    @Environment(Connectivity.self) private var net
    @State private var path: [Route] = []
    @State private var query = ""
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !net.online {
                    Label("You're offline. Your chats are still here.", systemImage: "wifi.slash")
                        .font(.gente(.footnote)).foregroundStyle(G.muted)
                        .listRowBackground(Color.clear)
                }
                if engine.chats.isEmpty {
                    EmptyHome { start($0) }
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(filtered) { chat in
                    NavigationLink(value: Route.chat(chat.id)) {
                        ChatRow(chat: chat, preview: engine.load(chat.id).last(where: { $0.role != .tool })?.text ?? "",
                                working: engine.working.contains(chat.id))
                    }
                    .matchedTransitionSource(id: chat.id, in: zoom)
                    .listRowBackground(G.background)
                    .swipeActions {
                        Button(role: .destructive) { withAnimation(G.spring) { engine.delete(chat) } } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(G.background)
            .searchable(text: $query, prompt: Text("Search your chats"))
            .navigationTitle("Gente")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(value: Route.settings) {
                        Image(systemName: "person.crop.circle").font(.system(size: 20))
                    }
                    .accessibilityLabel(Text("Settings"))
                    .accessibilityIdentifier("home.settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { start(nil) } label: { Image(systemName: "square.and.pencil").font(.system(size: 18, weight: .semibold)) }
                        .accessibilityLabel(Text("New chat"))
                        .accessibilityIdentifier("home.new")
                        .matchedTransitionSource(id: "new", in: zoom)
                }
            }
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .chat(let id):
                    ChatView(chatId: id).navigationTransition(.zoom(sourceID: id, in: zoom))
                case .settings: SettingsView(path: $path)
                case .egress: EgressLogView()
                case .data: DataCenterView()
                case .devices: DevicesView()
                case .brain: BrainView()
                case .routines: RoutinesView()
                case .paywall: PaywallView()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .genteDeepLink)) { _ in handleDeepLink() }
        .onAppear { handleDeepLink() }
    }

    var filtered: [Chat] {
        guard !query.isEmpty else { return engine.chats }
        return engine.chats.filter { c in
            c.title.localizedCaseInsensitiveContains(query) ||
            engine.load(c.id).contains { $0.text.localizedCaseInsensitiveContains(query) }
        }
    }

    func start(_ text: String?) {
        let c = engine.newChat()
        path = [.chat(c.id)]
        if let text { engine.send(text, in: c.id) }
    }

    func handleDeepLink() {
        guard let l = DeepLink.pending else { return }
        DeepLink.pending = nil
        switch l {
        case .ask(let q): start(q)
        case .newChat: start(nil)
        case .chat(let id): path = [.chat(id)]
        case .pair: path = [.settings, .devices]
        }
    }
}

struct ChatRow: View {
    let chat: Chat
    let preview: String
    let working: Bool
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(chat.title.isEmpty ? String(localized: "New chat") : chat.title)
                    .font(.gente(.headline)).lineLimit(1)
                Text(preview).font(.gente(.subheadline)).foregroundStyle(G.muted).lineLimit(2)
            }
            Spacer(minLength: 0)
            if working { GenteMark(size: 18, breathing: true) }
            else { Text(chat.updatedAt, format: .relative(presentation: .named)).font(.gente(.caption)).foregroundStyle(G.faint) }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

struct EmptyHome: View {
    var start: (String?) -> Void
    var ideas: [String] { [String(localized: "Plan my week"), String(localized: "What's new in AI today?"), String(localized: "Write a kind reply to my landlord")] }
    var body: some View {
        VStack(spacing: 18) {
            GenteMark(size: 64, breathing: true).padding(.top, 60)
            Text("What should we do?").font(.gente(.title2, weight: .bold))
            VStack(spacing: 10) {
                ForEach(Array(ideas.enumerated()), id: \.offset) { i, idea in
                    Button { start(idea) } label: {
                        Text(verbatim: idea).font(.gente(.body)).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14).genteCard()
                    }
                    .buttonStyle(PressableStyle())
                    .foregroundStyle(G.foreground)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

