// Copyright 2026 DeskHead Inc.
import AVFoundation
import SwiftUI

struct DevicesView: View {
    @Environment(SyncEngine.self) private var sync
    @State private var scanning = false
    @State private var safety: String?
    @State private var error: String?
    @State private var removing: DevicePublic?

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
                        Text("If it's different, remove the device below.").font(.gente(.footnote)).foregroundStyle(G.muted)
                    }
                } header: { Text("Safety code") }
            }
            if let error { Text(error).foregroundStyle(G.destructive).font(.gente(.footnote)) }
            Section {
                deviceRow(name: String(localized: "This iPhone"), platform: "ios", added: nil)
                ForEach(sync.peers) { d in
                    deviceRow(name: d.name, platform: d.platform, added: d.addedAt)
                        .swipeActions { Button(role: .destructive) { removing = d } label: { Label("Remove", systemImage: "trash") } }
                }
            } header: { Text("Your devices") } footer: {
                if let t = sync.lastSync { Text("Last synced \(t.formatted(.relative(presentation: .named)))") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Your devices")
        .sheet(isPresented: $scanning) {
            QRScanner { code in
                scanning = false
                guard let url = URL(string: code), let invite = PairingInvite(url: url) else {
                    error = String(localized: "That isn't a Gente pairing code. On your computer, open Settings, then Devices, then Pair a phone.")
                    return
                }
                Task {
                    do { safety = try await sync.pair(with: invite); error = nil }
                    catch { self.error = Friendly.from(error).text }
                }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog(Text("Remove this device?"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) { if let d = removing { Task { await sync.remove(d) } } }
        } message: { Text("It stops getting your chats and memory, and can't use this iPhone's Gente.") }
    }

    func deviceRow(name: String, platform: String, added: Date?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: platform == "ios" ? "iphone" : platform == "android" ? "smartphone" : "laptopcomputer")
                .foregroundStyle(G.primary).frame(width: 26)
            VStack(alignment: .leading) {
                Text(name).font(.gente(.body, weight: .semibold))
                if let added { Text("Paired \(added.formatted(date: .abbreviated, time: .omitted))").font(.gente(.caption)).foregroundStyle(G.muted) }
            }
        }
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
