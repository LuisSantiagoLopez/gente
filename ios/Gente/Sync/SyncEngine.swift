// Copyright 2026 DeskHead Inc.
// Keeps chats, memory, projects and skills the same on all of the person's own devices.
// Each change is sealed once per paired device and handed to the relay. Last write wins per record.
import Foundation
import Observation

@MainActor @Observable
final class SyncEngine {
    static let shared = SyncEngine()

    var me = DeviceIdentity.load()
    var relay: RelayTransport = CloudRelay()
    var store = EncryptedStore.shared
    private(set) var peers: [DevicePublic] = []
    var lastSync: Date?
    /// Called when a paired desktop streams a Private mode answer or task progress.
    var onPayload: (SyncPayload, DevicePublic) -> Void = { _, _ in }
    private var loop: Task<Void, Never>?

    var paired: Bool { !peers.isEmpty }
    var desktop: DevicePublic? { peers.first(where: { $0.platform != "ios" && $0.platform != "android" }) }

    init() { peers = store.all("peer", DevicePublic.self) }

    // MARK: Pairing

    /// Phone side of pairing after scanning the desktop's QR code. Returns the safety code to compare.
    func pair(with invite: PairingInvite) async throws -> String {
        try await registerIfNeeded()
        let hello = SyncPayload(type: "pair.hello", id: UUID().uuidString, at: now(),
                                body: try JSONEncoder().encode(PairHello(device: me.publicInfo, proof: RelayCrypto.pairingProof(me.publicInfo, secret: invite.secret))))
        try await relay.send([try RelayCrypto.seal(hello, from: me, to: invite.desktop)])
        addPeer(invite.desktop)
        return RelayCrypto.safetyCode(me.publicInfo, invite.desktop, secret: invite.secret)
    }

    func addPeer(_ d: DevicePublic) {
        store.put("peer", id: d.id, sort: d.addedAt.timeIntervalSince1970, d)
        peers = store.all("peer", DevicePublic.self)
        start()
    }

    /// Removes a lost or old device: it gets nothing new, and the relay drops its mailbox.
    func remove(_ d: DevicePublic) async {
        let note = SyncPayload(type: "device.removed", id: d.id, at: now(), body: Data(d.id.utf8))
        let others = peers.filter { $0.id != d.id }
        try? await relay.send(others.compactMap { try? RelayCrypto.seal(note, from: me, to: $0) })
        try? await relay.remove(device: d.id)
        store.delete("peer", id: d.id)
        peers = store.all("peer", DevicePublic.self)
    }

    /// The relay names devices by a server id. The phone takes that id as its own once.
    func registerIfNeeded() async throws {
        guard !me.registered else { return }
        let id = try await relay.register(me.publicInfo)
        me = me.withServerId(id)
    }

    // MARK: Outgoing

    func publish<T: Encodable>(_ type: String, id: String, _ value: T) {
        guard paired, let body = try? JSONEncoder().encode(value) else { return }
        let p = SyncPayload(type: type, id: id, at: now(), body: body)
        let env = peers.compactMap { try? RelayCrypto.seal(p, from: me, to: $0) }
        Task { try? await relay.send(env); lastSync = Date() }
    }

    func send(_ payload: SyncPayload, to peer: DevicePublic) async throws {
        try await registerIfNeeded()
        var e = try RelayCrypto.seal(payload, from: me, to: peer)
        e.live = payload.type.hasPrefix("infer.") || payload.type.hasPrefix("task.") || payload.type.hasPrefix("approval.")
        try await relay.send([e])
    }

    // MARK: Incoming

    func start() {
        guard paired, loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do { try await self.pull() } catch { try? await Task.sleep(for: .seconds(5)) }
            }
        }
    }

    func stop() { loop?.cancel(); loop = nil }

    func pull() async throws {
        let got = try await relay.inbox(device: me.id, after: nil)
        var done: [String] = []
        for d in got {
            let e = d.envelope
            defer { done.append(d.serverId) }
            guard let sender = peers.first(where: { $0.id == e.from }),
                  let p = try? RelayCrypto.open(e, me: me, sender: sender) else { continue }
            apply(p, from: sender)
        }
        if !done.isEmpty { try await relay.ack(device: me.id, ids: done); lastSync = Date() }
        else { try await Task.sleep(for: .seconds(2)) }
    }

    func apply(_ p: SyncPayload, from sender: DevicePublic) {
        let dec = JSONDecoder()
        switch p.type {
        case "chat.upsert": if let c = try? dec.decode(Chat.self, from: p.body) { store.saveChat(c) }
        case "message.upsert": if let m = try? dec.decode(Message.self, from: p.body) { store.saveMessage(m) }
        case "brain.upsert": if let b = try? dec.decode(BrainItem.self, from: p.body) { store.saveBrain(b) }
        case "chat.delete": store.deleteChat(p.id)
        case "brain.delete": store.deleteBrain(p.id)
        case "device.removed":
            store.delete("peer", id: p.id)
            peers = store.all("peer", DevicePublic.self)
        default: onPayload(p, sender)
        }
        NotificationCenter.default.post(name: .genteSynced, object: nil)
    }

    private func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

struct PairHello: Codable { var device: DevicePublic; var proof: String }

extension Notification.Name { static let genteSynced = Notification.Name("gente.synced") }

/// Private mode: the paired computer runs its local AI. The request and every word of the answer
/// travel sealed through the relay, so Gente Cloud never sees them.
@MainActor
final class DesktopBrain {
    var sync = SyncEngine.shared

    struct InferRequest: Codable { var requestId: String; var messages: [WireMessageCodable]; var chatId: String }
    struct WireMessageCodable: Codable { var role: String; var content: String? }
    struct InferDelta: Codable { var requestId: String; var text: String?; var done: Bool? }

    func stream(_ messages: [WireMessage], chatId: String) async throws -> AsyncThrowingStream<StreamEvent, Error> {
        guard let desk = sync.desktop else { throw HTTPFailure(status: 409, code: "not_paired") }
        let rid = UUID().uuidString
        let req = InferRequest(requestId: rid, messages: messages.map { .init(role: $0.role, content: $0.content) }, chatId: chatId)
        let p = SyncPayload(type: "infer.request", id: rid, at: Int64(Date().timeIntervalSince1970 * 1000), body: try JSONEncoder().encode(req))
        try await sync.send(p, to: desk)
        return AsyncThrowingStream { cont in
            let previous = sync.onPayload
            sync.onPayload = { payload, from in
                guard payload.type == "infer.delta", from.id == desk.id,
                      let d = try? JSONDecoder().decode(InferDelta.self, from: payload.body), d.requestId == rid else { previous(payload, from); return }
                if let t = d.text { cont.yield(.text(t)) }
                if d.done == true { cont.yield(.done(stub: false)); cont.finish() }
            }
            sync.start()
            cont.onTermination = { _ in Task { @MainActor in self.sync.onPayload = previous } }
        }
    }
}
