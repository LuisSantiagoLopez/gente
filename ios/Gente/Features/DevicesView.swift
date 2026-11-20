// Copyright 2026 DeskHead Inc.
import AVFoundation
import SwiftUI

struct DevicesView: View {
    /// A gente://link URL opened from outside (a QR scanned with the Camera app).
    @MainActor static var pendingLink: String?
    @Environment(SyncEngine.self) private var sync
    @State private var scanning = false
    @State private var safety: String?
    @State private var error: String?
    @State private var removing: PairedDesktop?
    @State private var taskText = ""

    var body: some View {
        List {
            Section {
                Text("Pair your computer to use Gente's AI on it from anywhere, keep chats and memory the same on both, and approve its tasks from here. Everything between your devices is sealed end to end. Gente Cloud only passes along boxes it can't open.")
                    .font(.gente(.footnote)).foregroundStyle(G.muted)
                Button { scanning = true } label: { Label("Pair a computer", systemImage: "qrcode.viewfinder") }
                    .accessibilityIdentifier("devices.pair")
            }
            if let safety {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Check that your computer shows this code:").font(.gente(.subheadline))
                        Text(safety).font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(G.link)
                            .accessibilityLabel(Text(safety.map(String.init).joined(separator: " ")))
                            .accessibilityIdentifier("devices.safety")
                        Text("If it's different, remove the device below.").font(.gente(.footnote)).foregroundStyle(G.muted)
                    }
                } header: { Text("Safety code") }
            }
            if let error { Text(error).foregroundStyle(G.destructive).font(.gente(.footnote)) }
            Section {
                deviceRow(name: String(localized: "This iPhone"), symbol: "iphone", added: nil, confirmed: true)
                ForEach(sync.desktops) { d in
                    deviceRow(name: d.name, symbol: "laptopcomputer", added: d.pairedAt, confirmed: d.confirmed)
                        .swipeActions { Button(role: .destructive) { removing = d } label: { Label("Remove", systemImage: "trash") } }
                }
            } header: { Text("Your devices") } footer: {
                if let t = sync.lastSync { Text("Last synced \(t.formatted(.relative(presentation: .named)))") }
            }
            if sync.paired {
                Section {
                    HStack {
                        TextField(String(localized: "Ask your computer to do something"), text: $taskText, axis: .vertical)
                            .accessibilityIdentifier("devices.taskField")
                        Button {
                            let t = taskText; taskText = ""
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                            Task { _ = try? await sync.startTask(t) }
                        } label: {
                            Image(systemName: "arrow.up.circle.fill").font(.title2)
                        }
                        .disabled(taskText.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel(Text("Start on my computer"))
                        .accessibilityIdentifier("devices.taskSend")
                    }
                    ForEach(sync.tasks) { t in
                        VStack(alignment: .leading, spacing: 3) {
                            if !t.text.isEmpty { Text(t.text).font(.gente(.body, weight: .semibold)).lineLimit(2) }
                            HStack(spacing: 6) {
                                if !["done", "failed", "stopped"].contains(t.state) { ProgressView().controlSize(.mini) }
                                Text(t.status).font(.gente(.footnote)).foregroundStyle(G.muted)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: { Text("Tasks on your computer") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Your devices")
        .task {
            sync.start()
            if let link = Self.pendingLink { Self.pendingLink = nil; await pair(link) }
        }
        .sheet(isPresented: $scanning) {
            QRScanner { code in
                scanning = false
                Task { await pair(code) }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog(Text("Remove this device?"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) { if let d = removing { Task { await sync.unpair(d) } } }
        } message: { Text("It stops getting your chats and memory, and can't use this iPhone's Gente.") }
    }

    func pair(_ code: String) async {
        guard LinkOffer(text: code) != nil else {
            error = String(localized: "That isn't a Gente pairing code. On your computer, open Settings, then Devices, then Pair a phone.")
            return
        }
        do { safety = try await sync.pair(qr: code); error = nil }
        catch { self.error = Friendly.from(error).text }
    }

    func deviceRow(name: String, symbol: String, added: Date?, confirmed: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(G.primary).frame(width: 26)
            VStack(alignment: .leading) {
                Text(name).font(.gente(.body, weight: .semibold))
                if let added {
                    Text(confirmed ? "Paired \(added.formatted(date: .abbreviated, time: .omitted))" : "Waiting for your computer to confirm")
                        .font(.gente(.caption)).foregroundStyle(G.muted)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// An approval the computer asked for, shown on the phone.
struct DesktopApprovalSheet: View {
    let approval: DesktopApproval
    var decide: (Bool) -> Void
    var reason: ApprovalReason? {
        switch approval.kind {
        case "money": .money
        case "send_as_user": .sendAsYou
        case "delete_data": .deleteData
        case "legal": .legalTerms
        default: nil
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Your computer asks", systemImage: "laptopcomputer").font(.gente(.subheadline, weight: .semibold)).foregroundStyle(G.link)
            if let r = reason { Label(r.title, systemImage: r.symbol).font(.gente(.title3, weight: .bold)) }
            Text(approval.title).font(.gente(.headline))
            if !approval.detail.isEmpty {
                Text(approval.detail).font(.gente(.body)).foregroundStyle(G.muted)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).genteCard()
            }
            Spacer()
            HStack(spacing: 12) {
                Button { decide(false) } label: { Text("Don't do it").frame(maxWidth: .infinity, minHeight: 50) }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule).accessibilityIdentifier("desktopApproval.deny")
                Button { decide(true) } label: { Text("Allow once") }
                    .buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("desktopApproval.allow")
            }
        }
        .padding(24)
        .interactiveDismissDisabled()
        .presentationBackground(G.dialog)
    }
}

struct QRScanner: UIViewControllerRepresentable {
    var found: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerVC { let v = ScannerVC(); v.found = found; return v }
    func updateUIViewController(_ vc: ScannerVC, context: Context) {}

    final class ScannerVC: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var found: (String) -> Void = { _ in }
        private let session = AVCaptureSession()
        private var done = false

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black
            let label = UILabel()
            label.text = String(localized: "Point at the code on your computer")
            label.textColor = .white
            label.font = .preferredFont(forTextStyle: .headline)
            label.adjustsFontForContentSizeCategory = true
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
            NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                                         label.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40)])
            guard let cam = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: cam),
                  session.canAddInput(input) else {
                label.text = String(localized: "The camera isn't available. Allow it in Settings.")
                return
            }
            session.addInput(input)
            let out = AVCaptureMetadataOutput()
            session.addOutput(out)
            out.setMetadataObjectsDelegate(self, queue: .main)
            out.metadataObjectTypes = [.qr]
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.frame = view.bounds
            layer.videoGravity = .resizeAspectFill
            view.layer.insertSublayer(layer, at: 0)
            DispatchQueue.global().async { self.session.startRunning() }
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard !done, let s = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
            done = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            session.stopRunning()
            found(s)
        }
    }
}
