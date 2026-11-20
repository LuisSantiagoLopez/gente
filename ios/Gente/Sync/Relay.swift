// Copyright 2026 DeskHead Inc.
// Gente Cloud's channel relay (SHARED.md): the server stores opaque envelopes per channel and
// never parses them. POST /v1/relay/:channel (raw envelope), GET ?after=<server seq>, DELETE.
import Foundation

struct RelayItem { var seq: Int64; var envelope: LinkEnvelope }

protocol RelayTransport: AnyObject {
    func post(_ channel: String, _ env: LinkEnvelope, live: Bool) async throws
    func poll(_ channel: String, after: Int64) async throws -> [RelayItem]
    func delete(_ channel: String) async throws
}

final class CloudRelay: RelayTransport {
    var api = CloudAPI.shared

    private func call(_ r: URLRequest) async throws -> Data {
        let (data, resp) = try await api.http.data(r, service: .relay, carries: .encrypted)
        guard (200..<300).contains(resp.statusCode) else { throw CloudAPI.failure(resp.statusCode, data) }
        return data
    }

    func post(_ channel: String, _ env: LinkEnvelope, live: Bool) async throws {
        // Live messages (task status, Private mode words) expire after 10 minutes.
        var r = try await api.request("/v1/relay/\(channel)" + (live ? "?ttl=600" : ""), method: "POST")
        r.httpBody = try JSONEncoder().encode(env)
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let id = UserDefaults.standard.string(forKey: "relay.deviceId") { r.setValue(id, forHTTPHeaderField: "x-gente-device-id") }
        _ = try await call(r)
    }

    func poll(_ channel: String, after: Int64) async throws -> [RelayItem] {
        struct E: Codable { var seq: Int64; var envelope: String }
        struct R: Codable { var envelopes: [E] }
        let r = try await api.request("/v1/relay/\(channel)?after=\(after)")
        return try JSONDecoder().decode(R.self, from: try await call(r)).envelopes.compactMap { x in
            guard let d = Data(base64Encoded: x.envelope), let e = try? JSONDecoder().decode(LinkEnvelope.self, from: d) else { return nil }
            return RelayItem(seq: x.seq, envelope: e)
        }
    }

    func delete(_ channel: String) async throws {
        _ = try await call(try await api.request("/v1/relay/\(channel)", method: "DELETE"))
    }

    /// Once per install: lets Gente Cloud wake this phone with an empty push. No names, no content.
    func registerDevice(publicKey: Data, pushToken: String?) async {
        guard UserDefaults.standard.string(forKey: "relay.deviceId") == nil else { return }
        struct R: Codable { var deviceId: String }
        var body: [String: Any] = ["platform": "ios", "publicKey": publicKey.base64URL]
        if let pushToken { body["pushToken"] = pushToken }
        guard let r = try? await api.request("/v1/devices", method: "POST", json: body),
              let d = try? await call(r), let id = try? JSONDecoder().decode(R.self, from: d).deviceId else { return }
        UserDefaults.standard.set(id, forKey: "relay.deviceId")
    }
}
