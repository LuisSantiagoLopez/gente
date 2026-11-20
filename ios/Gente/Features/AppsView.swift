// Copyright 2026 DeskHead Inc.
import SafariServices
import SwiftUI

struct AppsView: View {
    @State private var apps = ConnectedApps.shared
    @State private var signIn: IdentifiedURL?
    @State private var pendingToolkit: String?
    @State private var error: String?

    var body: some View {
        List {
            Section {
                Text("Connect the apps Gente may use for you. You sign in on the app's own page; Gente never sees your password. Gente still asks before it sends, pays, deletes or accepts anything.")
                    .font(.gente(.footnote)).foregroundStyle(G.muted)
            }
            if let error { Text(error).font(.gente(.footnote)).foregroundStyle(G.destructive) }
            Section {
                ForEach(AppToolkit.common) { t in
                    HStack(spacing: 12) {
                        Image(systemName: t.symbol).foregroundStyle(G.primary).frame(width: 26)
                        Text(t.name).font(.gente(.body, weight: .semibold))
                        Spacer()
                        if apps.busy == t.id { ProgressView() }
                        else if apps.connected.contains(t.id) {
                            Label("Connected", systemImage: "checkmark.circle.fill").font(.gente(.footnote)).foregroundStyle(G.success)
                        } else {
                            Button("Connect") { Task { await connect(t.id) } }
                                .font(.gente(.subheadline, weight: .semibold)).foregroundStyle(G.link)
                                .accessibilityIdentifier("apps.connect.\(t.id)")
                        }
                    }
                    .swipeActions { if apps.connected.contains(t.id) { Button("Hide") { apps.forget(t.id) } } }
                }
            } header: { Text("Apps") } footer: {
                Text("To disconnect an app for good, remove Gente's access in that app's own settings.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Connected apps")
        .sheet(item: $signIn, onDismiss: {
            if let t = pendingToolkit { pendingToolkit = nil; Task { await apps.refresh(t) } }
        }) { u in SafariView(url: u.url).ignoresSafeArea() }
    }

    func connect(_ toolkit: String) async {
        error = nil
        do {
            if let url = try await apps.connectLink(toolkit) {
                pendingToolkit = toolkit
                signIn = IdentifiedURL(url: url)
            }
        } catch {
            self.error = (error as? HTTPFailure)?.status == 503
                ? String(localized: "Connecting apps isn't available yet. Try again later.")
                : Friendly.from(error).text
        }
    }
}

struct IdentifiedURL: Identifiable { var url: URL; var id: String { url.absoluteString } }

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let c = SFSafariViewController.Configuration()
        c.entersReaderIfAvailable = false
        let v = SFSafariViewController(url: url, configuration: c)
        v.preferredControlTintColor = UIColor(G.primary)
        return v
    }
    func updateUIViewController(_ v: SFSafariViewController, context: Context) {}
}
