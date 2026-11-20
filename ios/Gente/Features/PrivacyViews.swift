// Copyright 2026 DeskHead Inc.
import CryptoKit
import SwiftUI

/// "What left your phone": every request, from the one door in GenteHTTP. Sizes and services only.
struct EgressLogView: View {
    @State private var records: [EgressRecord] = []
    var body: some View {
        List {
            Section {
                Text("Every time Gente talks to the internet, it's listed here: when, which service, how big, and what kind of thing went. Your words themselves are never kept, here or on our servers.")
                    .font(.gente(.footnote)).foregroundStyle(G.muted)
            }
            if records.isEmpty {
                Text("Nothing has left your phone yet.").foregroundStyle(G.muted)
            }
            ForEach(records) { r in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(LocalizedStringKey(r.service)).font(.gente(.headline))
                        Spacer()
                        Text(r.at, format: .dateTime.hour().minute().second()).font(.gente(.caption)).foregroundStyle(G.faint)
                    }
                    Text(LocalizedStringKey(r.carries)).font(.gente(.subheadline))
                    HStack(spacing: 10) {
                        Label(Self.size(r.bytesOut), systemImage: "arrow.up")
                        Label(Self.size(max(0, r.bytesIn)), systemImage: "arrow.down")
                        Text(LocalizedStringKey(r.stored))
                    }
                    .font(.gente(.caption)).foregroundStyle(G.muted)
                    Text("\(r.host)\(r.path)").font(.system(.caption2, design: .monospaced)).foregroundStyle(G.faint)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("What left your phone")
        .task { records = EncryptedStore.shared.egress() }
        .refreshable { records = EncryptedStore.shared.egress() }
    }
}

extension EgressLogView {
    static func size(_ n: Int) -> String {
        let f = ByteCountFormatter()
        f.countStyle = .file
        f.allowsNonnumericFormatting = false
        return f.string(fromByteCount: Int64(n))
    }
}

struct DeletionReceipt: Codable, Identifiable, Hashable {
    var id: String
    var userHash: String
    var objectType: String
    var objectHash: String
    var reason: String
    var deletedAt: String
    var digest: String
    var signature: String

    /// SHA-256 over the canonical receipt, signed with Gente Cloud's Ed25519 receipt key.
    func verify(publicKeyPEM: String) -> Bool {
        let canon = [id, userHash, objectType, objectHash, reason, deletedAt]
        guard let json = try? JSONSerialization.data(withJSONObject: canon, options: [.withoutEscapingSlashes]),
              Data(SHA256.hash(data: json)).hex == digest,
              let der = Data(base64Encoded: publicKeyPEM.components(separatedBy: "\n").filter { !$0.hasPrefix("-----") }.joined()),
              der.count >= 32, let key = try? Curve25519.Signing.PublicKey(rawRepresentation: der.suffix(32)),
              let sig = Data(base64URL: signature), let dig = Data(hexString: digest) else { return false }
        return key.isValidSignature(sig, for: dig)
    }
}

extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
    init?(hexString: String) {
        var d = Data(); var i = hexString.startIndex
        while i < hexString.endIndex {
            let j = hexString.index(i, offsetBy: 2, limitedBy: hexString.endIndex) ?? hexString.endIndex
            guard let b = UInt8(hexString[i..<j], radix: 16) else { return nil }
            d.append(b); i = j
        }
        self = d
    }
}

/// "Where's my data": live from real state on the phone, plus Gente Cloud's deletion receipts.
struct DataCenterView: View {
    @Environment(SyncEngine.self) private var sync
    @Environment(ChatEngine.self) private var engine
    @State private var counts: [BrainKind: Int] = [:]
    @State private var messageCount = 0
    @State private var receipts: [DeletionReceipt]?
    @State private var verified: Set<String> = []
    @State private var timeline: [EgressRecord] = []
    @State private var exportPass = ""
    @State private var exporting = false
    @State private var exportURL: URL?
    @State private var confirmErase = false

    var synced: String {
        sync.peers.isEmpty ? String(localized: "Only on this iPhone")
                           : String(localized: "This iPhone, synced end to end with \(sync.peers.count) of your devices")
    }

    var body: some View {
        List {
            Section {
                place("bubble.left.and.bubble.right", String(localized: "Chats"), String(localized: "\(engine.chats.count) chats, \(messageCount) messages"), synced)
                place("brain", String(localized: "Memory"), "\(counts[.memory] ?? 0)", synced)
                place("wand.and.stars", String(localized: "Skills"), "\(counts[.skill] ?? 0)", synced)
                place("folder", String(localized: "Projects and files"), "\((counts[.project] ?? 0) + (counts[.file] ?? 0))", synced)
                place("alarm", String(localized: "Routines"), "\(EncryptedStore.shared.routines().count)", String(localized: "Only on this iPhone"))
                place("photo", String(localized: "Images you made"), "",
                      String(localized: "This iPhone. A temporary cloud copy is deleted 30 days after it was made."))
                place("key", String(localized: "Encryption keys"), "",
                      EncryptedStore.shared.keyStore.usesSecureEnclave ? String(localized: "Only on this iPhone, in the Secure Enclave")
                                                                       : String(localized: "Only on this iPhone, in the Keychain"))
                place("person", String(localized: "Account, plan and hours"), "", String(localized: "Gente Cloud (needed to bill you)"))
            } header: { Text("Where each thing lives") } footer: {
                Text("Not in iCloud backups. Not on Gente's servers. AI answers are made in memory and not stored.")
            }

            Section {
                if let receipts {
                    if receipts.isEmpty { Text("No deletions on Gente Cloud yet.").foregroundStyle(G.muted) }
                    ForEach(receipts) { r in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(Self.label(r.objectType)).font(.gente(.subheadline, weight: .semibold))
                                Text(r.deletedAt).font(.gente(.caption)).foregroundStyle(G.muted)
                            }
                            Spacer()
                            if verified.contains(r.id) {
                                Label("Signature checked", systemImage: "checkmark.seal.fill").labelStyle(.iconOnly).foregroundStyle(G.success)
                                    .accessibilityLabel(Text("Signature checked"))
                            }
                        }
                    }
                } else {
                    Text("Deletion receipts appear here once Gente Cloud sends them.").foregroundStyle(G.muted)
                }
            } header: { Text("Gente Cloud deletion receipts") }

            Section {
                ForEach(timeline.prefix(30)) { r in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: r.service == Service.relay.rawValue ? "arrow.triangle.2.circlepath" : "arrow.up.right")
                            .foregroundStyle(G.link).frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(LocalizedStringKey(r.service)).font(.gente(.subheadline, weight: .medium))
                            Text(LocalizedStringKey(r.stored)).font(.gente(.caption)).foregroundStyle(G.muted)
                        }
                        Spacer()
                        Text(r.at, format: .relative(presentation: .named)).font(.gente(.caption)).foregroundStyle(G.faint)
                    }
                }
                NavigationLink(value: Route.egress) { Text("See every request") }
            } header: { Text("Timeline: sends and syncs") }

            Section {
                SecureField(String(localized: "Pick a passphrase for the export"), text: $exportPass)
                Button("Export everything (encrypted)") {
                    exporting = true
                    Task.detached {
                        let data = try? Exporter.seal(Exporter.bundle(EncryptedStore.shared), passphrase: await exportPass)
                        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Gente-export.gente")
                        try? data?.write(to: url, options: .completeFileProtection)
                        await MainActor.run { exportURL = data == nil ? nil : url; exporting = false }
                    }
                }
                .disabled(exportPass.count < 8 || exporting)
                if let exportURL { ShareLink(item: exportURL) { Label("Save the export", systemImage: "square.and.arrow.up") } }
                Button("Delete everything on this iPhone", role: .destructive) { confirmErase = true }
            } header: { Text("Your copy") } footer: {
                Text("The export is sealed with your passphrase (8 characters or more). Without it, no one can open the file, including us.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Where's my data")
        .task { await load() }
        .confirmationDialog(Text("Delete everything on this iPhone?"), isPresented: $confirmErase, titleVisibility: .visible) {
            Button("Delete everything", role: .destructive) {
                EncryptedStore.shared.eraseEverything()
                engine.chats = []; engine.messages = [:]
                Task { await load() }
            }
        } message: { Text("Chats, memory, routines and the log are erased, and the key is replaced. This can't be undone.") }
    }

    static func label(_ type: String) -> String {
        switch type {
        case "relay_message": String(localized: "Sealed sync message")
        case "device": String(localized: "Removed device")
        case "media": String(localized: "Cloud copy of an image or video")
        case "account": String(localized: "Account")
        default: type.replacingOccurrences(of: "_", with: " ")
        }
    }

    func place(_ symbol: String, _ title: String, _ count: String, _ whereText: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(G.primary).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                HStack { Text(title).font(.gente(.body, weight: .semibold)); Spacer(); Text(count).font(.gente(.footnote)).foregroundStyle(G.faint) }
                Text(whereText).font(.gente(.footnote)).foregroundStyle(G.muted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    func load() async {
        let s = EncryptedStore.shared
        var c: [BrainKind: Int] = [:]
        for k in BrainKind.allCases { c[k] = s.brain(k).count }
        counts = c
        messageCount = s.chats().reduce(0) { $0 + s.messages(chat: $1.id).count }
        timeline = s.egress(limit: 60)
        struct R: Codable { var receipts: [DeletionReceipt] }
        if Auth.shared.signedIn {
            receipts = (try? await CloudAPI.shared.call("/v1/me/data/receipts", service: .account, carries: .account, as: R.self))?.receipts
            if let rs = receipts, !rs.isEmpty,
               let r = try? await CloudAPI.shared.request("/v1/receipts/public-key"),
               let (d, _) = try? await GenteHTTP.shared.data(r, service: .account, carries: .none),
               let pem = String(data: d, encoding: .utf8) {
                verified = Set(rs.filter { $0.verify(publicKeyPEM: pem) }.map(\.id))
            }
        }
    }
}
