// Copyright 2026 DeskHead Inc.
// The store-and-forward relay on Gente Cloud, "channel" shape (SHARED.md, shared with Android
// and desktop):
//   POST /v1/devices {platform, publicKey}                 -> {deviceId}   (once per install)
//   POST /v1/relay/inbox-<recipientDeviceId>               raw envelope bytes, octet-stream,
//        header x-gente-device-id: <sender>                (wakes the recipient with an empty push)
//   GET  /v1/relay/inbox-<myDeviceId>?after=<seq>          -> {envelopes:[{seq, envelope(base64)}]}
//   DELETE /v1/devices/:id and /v1/relay/inbox-<id>        when a device is removed
// Each envelope is one gente-relay-v1 JSON object. The server never parses it and keeps it at
// most 72 hours (7 days max); live task messages use a 10-minute TTL.
import Foundation

struct Delivered { var serverId: String; var envelope: Envelope }

protocol RelayTransport {
    /// Registers this device's public keys; returns the server's device id.
    func register(_ d: DevicePublic) async throws -> String
    func remove(device: String) async throws
    func send(_ envelopes: [Envelope]) async throws
    func inbox(device: String, after: String?) async throws -> [Delivered]
    func ack(device: String, ids: [String]) async throws
}

extension DevicePublic {
    /// One string for the server: base64url(x25519 raw 32 bytes || ed25519 raw 32 bytes).
    var serverPublicKey: String { ((Data(base64URL: x25519) ?? Data()) + (Data(base64URL: ed25519) ?? Data())).base64URL }
}

enum RelayChannel {
    static func inbox(_ deviceId: String) -> String { "inbox-\(deviceId)" }
}

final class CloudRelay: RelayTransport {
    var api = CloudAPI.shared
    /// Highest sequence number already handled, per inbox (kept on the phone).
    private var lastSeq: Int {
        get { UserDefaults.standard.integer(forKey: "relay.lastSeq") }
        set { UserDefaults.standard.set(newValue, forKey: "relay.lastSeq") }
    }

    private func call(_ r: URLRequest) async throws -> Data {
        let (data, resp) = try await api.http.data(r, service: .relay, carries: .encrypted)
        guard (200..<300).contains(resp.statusCode) else { throw CloudAPI.failure(resp.statusCode, data) }
        return data
    }

    func register(_ d: DevicePublic) async throws -> String {
        struct R: Codable { var deviceId: String }
        let r = try await api.request("/v1/devices", method: "POST", json: ["platform": "ios", "publicKey": d.serverPublicKey])
        return try JSONDecoder().decode(R.self, from: try await call(r)).deviceId
    }

    func remove(device: String) async throws {
        _ = try await call(try await api.request("/v1/devices/\(device)", method: "DELETE"))
        _ = try? await call(try await api.request("/v1/relay/\(RelayChannel.inbox(device))", method: "DELETE"))
    }

    func send(_ envelopes: [Envelope]) async throws {
        for e in envelopes {
            var r = try await api.request("/v1/relay/\(RelayChannel.inbox(e.to))", method: "POST")
            if e.live { r.url = URL(string: r.url!.absoluteString + "?ttl=600") }
            r.httpBody = try JSONEncoder().encode(e)
            r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            r.setValue(e.from, forHTTPHeaderField: "x-gente-device-id")
            _ = try await call(r)
        }
    }

    func inbox(device: String, after: String?) async throws -> [Delivered] {
        struct E: Codable { var seq: Int; var envelope: String }
        struct R: Codable { var envelopes: [E] }
        let r = try await api.request("/v1/relay/\(RelayChannel.inbox(device))?after=\(after.flatMap(Int.init) ?? lastSeq)")
        let got = try JSONDecoder().decode(R.self, from: try await call(r))
        return got.envelopes.compactMap { x in
            guard let d = Data(base64Encoded: x.envelope), let e = try? JSONDecoder().decode(Envelope.self, from: d) else { return nil }
            return Delivered(serverId: String(x.seq), envelope: e)
        }
    }

    /// Channel relay has no per-message delete: we remember the last sequence handled, and the
    /// server drops envelopes when their TTL ends.
    func ack(device: String, ids: [String]) async throws {
        if let m = ids.compactMap(Int.init).max(), m > lastSeq { lastSeq = m }
    }
}
