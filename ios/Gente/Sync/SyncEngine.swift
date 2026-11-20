// Copyright 2026 DeskHead Inc.
// Phone side of Gente Link: pairing, encrypted sync of chats and memory, handoff, driving tasks on
// the desktop, approvals pushed to the phone, and Private mode (the desktop's own AI answers).
// Message types match the Android app and SHARED.md ("Gente Link v1").
import CryptoKit
import Foundation
import Observation
import UIKit

struct PairedDesktop: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var channel: String
    var phonePrivate: Data
    var desktopPk: Data
    var secret: Data
    var sendSeq: Int64 = 0
    var recvSeq: Int64 = 0
    var relayCursor: Int64 = 0
    var pairedAt = Date()
    var confirmed = false
}

struct DesktopTask: Identifiable, Hashable {
    var id: String
    var text: String
    var state: String
    var status: String
    var updatedAt = Date()
}

struct DesktopApproval: Identifiable, Hashable {
    var id: String
    var kind: String
    var title: String
    var detail: String
    var desktopId: String
}

@MainActor @Observable
final class SyncEngine {
    static let shared = SyncEngine()

    var relay: RelayTransport = CloudRelay()
    var store = EncryptedStore.shared
    private(set) var desktops: [PairedDesktop] = []
    var tasks: [DesktopTask] = []
    var approvals: [DesktopApproval] = []
    var lastSync: Date?
    private var loop: Task<Void, Never>?
    private var privateStreams: [String: AsyncThrowingStream<StreamEvent, Error>.Continuation] = [:]
    private var pendingChats: Set<String> = []
    private var flush: Task<Void, Never>?

    var paired: Bool { !desktops.isEmpty }
    var desktop: PairedDesktop? { desktops.first }

    init() { desktops = store.all("peer", PairedDesktop.self) }

    private func save(_ d: PairedDesktop) {
        store.put("peer", id: d.id, sort: d.pairedAt.timeIntervalSince1970, d)
        desktops = store.all("peer", PairedDesktop.self)
    }

    func session(_ d: PairedDesktop) throws -> LinkSession {
        try LinkSession(myPrivate: try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: d.phonePrivate),
                        peerPublic: d.desktopPk, secret: d.secret, iAmPhone: true)
    }

    // MARK: Pairing

    /// Phone side after scanning the desktop's QR. Returns the 4-digit safety code both screens show.
    func pair(qr: String) async throws -> String {
        guard let offer = LinkOffer(text: qr) else { throw LinkError.badKey }
        let key = Curve25519.KeyAgreement.PrivateKey()
        var d = PairedDesktop(id: offer.desktopId, name: offer.name, channel: LinkSession.channel(offer.secret),
                              phonePrivate: key.rawRepresentation, desktopPk: offer.desktopPk, secret: offer.secret)
        let s = try session(d)
        let hello: [String: Any] = ["type": "hello", "phoneName": UIDevice.current.name, "at": Self.now()]
        try await relay.post(d.channel, try s.seal(try JSONSerialization.data(withJSONObject: hello), seq: 1, epk: key.publicKey.rawRepresentation), live: false)
        d.sendSeq = 1
        save(d)
        if let cloud = relay as? CloudRelay { await cloud.registerDevice(publicKey: key.publicKey.rawRepresentation, pushToken: UserDefaults.standard.string(forKey: "apnsToken")) }
        start()
        return s.safetyCode
    }

    /// Unpair a lost or old computer: tell it, drop the channel on the relay, forget the keys.
    func unpair(_ d: PairedDesktop) async {
        try? await send(["type": "unpair"], to: d)
        try? await relay.delete(d.channel)
        store.delete("peer", id: d.id)
        desktops = store.all("peer", PairedDesktop.self)
        if desktops.isEmpty { stop() }
    }

    // MARK: Sending

    func send(_ msg: [String: Any], to target: PairedDesktop, live: Bool = false) async throws {
        guard var d = desktops.first(where: { $0.id == target.id }) else { return }
        d.sendSeq += 1
        save(d)
        let env = try session(d).seal(try JSONSerialization.data(withJSONObject: msg), seq: d.sendSeq)
        try await relay.post(d.channel, env, live: live)
        lastSync = Date()
    }

    /// A chat changed on the phone: send it (debounced) to every paired computer.
    func chatChanged(_ chatId: String) {
        guard paired else { return }
        pendingChats.insert(chatId)
        flush?.cancel()
        flush = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1200))
            guard let self, !Task.isCancelled else { return }
            let ids = self.pendingChats
            self.pendingChats = []
            for id in ids { await self.sendChat(id) }
        }
    }

    func chatMessage(_ c: Chat) -> [String: Any] {
        let msgs = store.messages(chat: c.id).filter { $0.role == .user || ($0.role == .assistant && !$0.text.isEmpty) }
        return ["type": "sync.chat", "id": c.id, "title": c.title, "updatedAt": Self.ms(c.updatedAt),
                "messages": msgs.map { m -> [String: Any] in
                    var o: [String: Any] = ["id": m.id, "role": m.role.rawValue, "text": m.text, "createdAt": Self.ms(m.createdAt)]
                    if let r = m.answeredBy { o["ranOn"] = r.wire }
                    return o
                }]
    }

    func sendChat(_ chatId: String) async {
        guard let c = store.chats().first(where: { $0.id == chatId }) else { return }
        for d in desktops { try? await send(chatMessage(c), to: d) }
    }

    func memoryChanged() {
        guard paired else { return }
        let items = store.brain(.memory).map { ["id": $0.id, "text": $0.body, "createdAt": Self.ms($0.createdAt)] as [String: Any] }
        Task { for d in desktops { try? await send(["type": "sync.memory", "items": items], to: d) } }
    }

    /// Continue this chat on the computer now.
    func handoff(_ chatId: String) async throws {
        guard let d = desktop, let c = store.chats().first(where: { $0.id == chatId }) else { return }
        try await send(chatMessage(c), to: d)
        try await send(["type": "handoff", "chatId": chatId], to: d, live: true)
    }

    /// Start a task on the computer from the phone. Progress comes back as task.status.
    func startTask(_ text: String) async throws -> String {
        guard let d = desktop else { throw HTTPFailure(status: 409, code: "not_paired") }
        let id = UUID().uuidString.lowercased()
        tasks.insert(DesktopTask(id: id, text: text, state: "queued", status: String(localized: "Sent to your computer")), at: 0)
        try await send(["type": "task.start", "taskId": id, "text": text], to: d, live: true)
        LiveActivityController.shared.start(title: String(localized: "Your computer is working"))
        start()
        return id
    }

    func decide(_ a: DesktopApproval, approved: Bool) async {
        approvals.removeAll { $0.id == a.id }
        guard let d = desktops.first(where: { $0.id == a.desktopId }) else { return }
        try? await send(["type": "approval.decision", "id": a.id, "approved": approved], to: d, live: true)
    }

    /// Private mode: the computer's own model answers. Words travel sealed both ways.
    func privateInfer(_ messages: [WireMessage]) async throws -> AsyncThrowingStream<StreamEvent, Error> {
        guard let d = desktop else { throw HTTPFailure(status: 409, code: "not_paired") }
        let req = UUID().uuidString.lowercased()
        let wire = messages.map { ["role": $0.role, "content": $0.content ?? ""] }
        let stream = AsyncThrowingStream<StreamEvent, Error> { cont in
            privateStreams[req] = cont
            cont.onTermination = { _ in Task { @MainActor in self.privateStreams[req] = nil } }
        }
        try await send(["type": "private.infer", "reqId": req, "messages": wire], to: d, live: true)
        start(fast: true)
        return stream
    }

    // MARK: Receiving

    private var fast = false
    func start(fast: Bool = false) {
        if fast { self.fast = true }
        guard paired, loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                try? await self.pull()
                let busy = self.fast || !self.privateStreams.isEmpty || self.tasks.contains { !["done", "failed", "stopped"].contains($0.state) }
                try? await Task.sleep(for: .seconds(busy ? 1 : 8))
            }
        }
    }

    func stop() { loop?.cancel(); loop = nil; fast = false }

    func pull() async throws {
        for var d in desktops {
            let items = try await relay.poll(d.channel, after: d.relayCursor)
            guard !items.isEmpty else { continue }
            let s = try session(d)
            for it in items {
                d.relayCursor = max(d.relayCursor, it.seq)
                let e = it.envelope
                guard e.from != "phone", e.seq > d.recvSeq, let plain = try? s.open(e),
                      let msg = try? JSONSerialization.jsonObject(with: plain) as? [String: Any] else { continue }
                d.recvSeq = e.seq
                handle(msg, from: &d)
            }
            if desktops.contains(where: { $0.id == d.id }) { save(d) }
            lastSync = Date()
        }
    }

    private func handle(_ m: [String: Any], from d: inout PairedDesktop) {
        func str(_ k: String) -> String { m[k] as? String ?? "" }
        switch str("type") {
        case "hello_ack":
            d.confirmed = true
        case "sync.chat":
            let id = str("id")
            var chat = store.chats().first(where: { $0.id == id }) ?? Chat(id: id, title: str("title"))
            chat.title = str("title")
            chat.updatedAt = Self.date(m["updatedAt"]) ?? Date()
            store.saveChat(chat)
            for o in m["messages"] as? [[String: Any]] ?? [] {
                guard let mid = o["id"] as? String, let role = Role(rawValue: o["role"] as? String ?? "") else { continue }
                store.saveMessage(Message(id: mid, chatId: id, role: role, text: o["text"] as? String ?? "",
                                          createdAt: Self.date(o["createdAt"]) ?? Date(),
                                          answeredBy: AnsweredBy(wire: o["ranOn"] as? String)))
            }
        case "sync.memory":
            for o in m["items"] as? [[String: Any]] ?? [] {
                guard let id = o["id"] as? String, let text = o["text"] as? String else { continue }
                store.saveBrain(BrainItem(id: id, kind: .memory, title: String(text.prefix(60)), body: text,
                                          createdAt: Self.date(o["createdAt"]) ?? Date()))
            }
        case "handoff":
            DeepLink.pending = .chat(str("chatId"))
        case "task.status":
            let id = str("taskId")
            if let i = tasks.firstIndex(where: { $0.id == id }) {
                tasks[i].state = str("state"); tasks[i].status = str("text"); tasks[i].updatedAt = Date()
            } else {
                tasks.insert(DesktopTask(id: id, text: "", state: str("state"), status: str("text")), at: 0)
            }
            if ["done", "failed", "stopped"].contains(str("state")) { LiveActivityController.shared.end() }
            else { LiveActivityController.shared.update(str("text")) }
        case "approval.request":
            let a = DesktopApproval(id: str("id"), kind: str("kind"), title: str("title"), detail: str("detail"), desktopId: d.id)
            if !approvals.contains(where: { $0.id == a.id }) { approvals.append(a) }
            NotificationScheduler.approvalIfBackground(a.title)
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "private.delta":
            if let t = m["text"] as? String, !t.isEmpty { privateStreams[str("reqId")]?.yield(.text(t)) }
        case "private.done":
            let r = str("reqId")
            privateStreams[r]?.yield(.done(stub: false))
            privateStreams[r]?.finish()
            privateStreams[r] = nil
            if privateStreams.isEmpty { fast = false }
        case "unpair":
            store.delete("peer", id: d.id)
            desktops = store.all("peer", PairedDesktop.self)
        default:
            break
        }
        NotificationCenter.default.post(name: .genteSynced, object: nil)
    }

    static func now() -> Int64 { ms(Date()) }
    static func ms(_ d: Date) -> Int64 { Int64(d.timeIntervalSince1970 * 1000) }
    static func date(_ v: Any?) -> Date? {
        if let n = v as? NSNumber { return Date(timeIntervalSince1970: n.doubleValue / 1000) }
        if let s = v as? String, let n = Double(s) { return Date(timeIntervalSince1970: n / 1000) }
        return nil
    }
}

extension AnsweredBy {
    /// "ranOn" values shared with Android and desktop.
    var wire: String {
        switch self { case .cloud: "cloud"; case .cloudPreview: "cloud_preview"; case .desktop: "desktop"; case .onDevice: "phone" }
    }
    init?(wire: String?) {
        switch wire {
        case "cloud": self = .cloud
        case "cloud_preview": self = .cloudPreview
        case "desktop": self = .desktop
        case "phone": self = .onDevice
        default: return nil
        }
    }
}

extension Notification.Name { static let genteSynced = Notification.Name("gente.synced") }
