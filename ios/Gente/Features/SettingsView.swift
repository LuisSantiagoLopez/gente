// Copyright 2026 DeskHead Inc.
import SwiftUI

struct SettingsView: View {
    @Binding var path: [Route]
    @Environment(Auth.self) private var auth
    @Environment(ChatEngine.self) private var engine
    @Environment(Purchases.self) private var purchases
    @Environment(SyncEngine.self) private var sync
    @State private var plan: PlanStatus?
    @State private var balance: Balance?
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var deleteError: String?
    @AppStorage("onboarded") private var onboarded = true

    var body: some View {
        @Bindable var engine = engine
        List {
            Section {
                if auth.signedIn {
                    LabeledContent("Account", value: auth.email ?? "")
                    LabeledContent("Plan", value: planName)
                    if let balance { LabeledContent("Hours left", value: balance.totalHours.formatted(.number.precision(.fractionLength(1)))) }
                    NavigationLink(value: Route.paywall) { Label("Plans and hours", systemImage: "sparkles") }.accessibilityIdentifier("settings.paywall")
                } else {
                    Button { Task { try? await auth.signIn(); await refresh() } } label: { Label("Sign in or create account", systemImage: "person.crop.circle.badge.plus") }
                }
            }
            Section {
                Picker(selection: $engine.place) {
                    ForEach(AIPlace.allCases.filter { $0 != .onDevice }) { p in
                        VStack(alignment: .leading) { Text(p.title); Text(p.detail).font(.gente(.caption)).foregroundStyle(G.muted) }.tag(p)
                    }
                } label: { Label("Where the AI runs", systemImage: "cpu") }
                .pickerStyle(.navigationLink)
                if engine.place == .desktop && sync.desktop == nil {
                    Text("Pair your computer first.").font(.gente(.footnote)).foregroundStyle(G.warning)
                }
            } header: { Text("AI") }
            Section {
                NavigationLink(value: Route.data) { Label("Where's my data", systemImage: "externaldrive.badge.checkmark") }.accessibilityIdentifier("settings.data")
                NavigationLink(value: Route.egress) { Label("What left your phone", systemImage: "arrow.up.right.circle") }.accessibilityIdentifier("settings.egress")
                NavigationLink(value: Route.devices) { Label("Your devices", systemImage: "laptopcomputer.and.iphone") }
            } header: { Text("Privacy") }
            Section {
                NavigationLink(value: Route.brain) { Label("Memory, skills and projects", systemImage: "brain") }
                NavigationLink(value: Route.routines) { Label("Routines", systemImage: "alarm") }
                NavigationLink(value: Route.apps) { Label("Connected apps", systemImage: "square.grid.2x2") }.accessibilityIdentifier("settings.apps")
            } header: { Text("Gente") }
            Section {
                Link(destination: Config.support) { Label("Help", systemImage: "questionmark.circle") }
                Link(destination: Config.privacyPolicy) { Label("Privacy policy", systemImage: "hand.raised") }
                Link(destination: Config.terms) { Label("Terms of use", systemImage: "doc.text") }
            }
            if auth.signedIn {
                Section {
                    Button("Sign out") { auth.signOut() }
                    Button("Delete account", role: .destructive) { confirmDelete = true }
                        .accessibilityIdentifier("settings.deleteAccount")
                    if let deleteError { Text(deleteError).font(.gente(.footnote)).foregroundStyle(G.destructive) }
                } footer: {
                    Text("Deleting your account removes it from Gente Cloud and erases everything Gente keeps on this iPhone. Subscriptions bought through Apple are managed in your Apple Account settings.")
                }
            } else {
                Section {
                    Button("Erase Gente data on this iPhone", role: .destructive) { confirmDelete = true }
                }
            }
            Section {
                Text("Gente \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") · DeskHead Inc.")
                    .font(.gente(.footnote)).foregroundStyle(G.faint)
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Settings")
        .task { await refresh() }
        .confirmationDialog(auth.signedIn ? Text("Delete your Gente account?") : Text("Erase Gente data on this iPhone?"),
                            isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(auth.signedIn ? "Delete account and data" : "Erase", role: .destructive) { Task { await deleteAll() } }
        } message: {
            Text("This can't be undone. Your chats, memory and keys on this iPhone are erased.")
        }
        .overlay { if deleting { ProgressView().controlSize(.large) } }
    }

    var planName: String {
        switch plan?.id ?? purchases.activePlan ?? "free" {
        case "pro": "Pro"; case "max": "Max"; case "max_plus": "Max Plus"; default: String(localized: "Free")
        }
    }

    func refresh() async {
        guard auth.signedIn else { return }
        plan = try? await CloudAPI.shared.plan()
        balance = try? await CloudAPI.shared.balance()
    }

    func deleteAll() async {
        deleting = true; deleteError = nil
        defer { deleting = false }
        if auth.signedIn {
            do { _ = try await CloudAPI.shared.deleteAccount() }
            catch {
                deleteError = String(localized: "Gente Cloud couldn't delete the account right now. Nothing was erased. Try again, or write to support.")
                return
            }
        }
        for d in sync.desktops { await sync.unpair(d) }
        sync.stop()
        EncryptedStore.shared.eraseEverything()
        KeyStore(service: "com.deskhead.gente.device").eraseAll()
        auth.signOut()
        engine.chats = []; engine.messages = [:]
        path = []
        onboarded = false
    }
}
