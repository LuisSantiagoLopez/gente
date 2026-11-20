// Copyright 2026 DeskHead Inc.
// Gente device-to-device encryption, protocol "gente-relay-v1" (defined in gente-mobile-proof/SHARED.md).
// X25519 key agreement + HKDF-SHA256 + ChaCha20-Poly1305 (IETF, 12-byte nonce), signed with Ed25519.
// A fresh ephemeral key per envelope (like a libsodium sealed box), so every message has its own key.
// Gente Cloud only relays these envelopes. It has no key that can open them.
import CryptoKit
import Foundation

struct DevicePublic: Codable, Hashable, Identifiable {
    var id: String          // device id, 16 random bytes base64url
    var name: String
    var platform: String    // "ios" | "android" | "mac" | "windows" | "linux"
    var x25519: String      // base64url raw public key (32 bytes)
    var ed25519: String     // base64url raw public key (32 bytes)
    var addedAt = Date()
}

struct Envelope: Codable, Hashable {
    var v = 1
    var id: String
    var from: String
    var to: String
    var eph: String
    var nonce: String
    var ct: String
    var sig: String
    var sent: Int64
    /// Live messages (task progress, Private mode words) expire from the relay after 10 minutes.
    /// Not part of the envelope on the wire.
    var live = false
    enum CodingKeys: String, CodingKey { case v, id, from, to, eph, nonce, ct, sig, sent }
}

/// What is inside an envelope once it is opened on a device.
struct SyncPayload: Codable, Equatable {
    var type: String        // see SHARED.md: chat.upsert, message.upsert, brain.upsert, delete, handoff.open, ...
    var id: String
    var at: Int64
    var body: Data          // JSON of the record
}

enum RelayCryptoError: Error { case badKey, badSignature, notForMe }

struct DeviceIdentity {
    let id: String
    /// True once Gente Cloud gave this device its relay id (a UUID).
    var registered: Bool { UUID(uuidString: id) != nil }
    let agreement: Curve25519.KeyAgreement.PrivateKey
    let signing: Curve25519.Signing.PrivateKey

    var publicInfo: DevicePublic {
        DevicePublic(id: id, name: "iPhone", platform: "ios",
                     x25519: agreement.publicKey.rawRepresentation.base64URL,
                     ed25519: signing.publicKey.rawRepresentation.base64URL)
    }

    func withServerId(_ sid: String, keys: KeyStore = KeyStore(service: "com.deskhead.gente.device")) -> DeviceIdentity {
        let n = DeviceIdentity(id: sid, agreement: agreement, signing: signing)
        n.save(keys)
        return n
    }

    private struct Stored: Codable { var id: String; var a: Data; var s: Data }
    func save(_ keys: KeyStore) {
        let s = Stored(id: id, a: agreement.rawRepresentation, s: signing.rawRepresentation)
        try? keys.write("identity", try JSONEncoder().encode(s))
    }

    static func generate() -> DeviceIdentity {
        var b = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &b)
        return DeviceIdentity(id: Data(b).base64URL, agreement: .init(), signing: .init())
    }

    /// Loads this phone's identity from the Keychain (this device only), or makes one.
    static func load(_ keys: KeyStore = KeyStore(service: "com.deskhead.gente.device")) -> DeviceIdentity {
        if let d = try? keys.read("identity"), let s = try? JSONDecoder().decode(Stored.self, from: d),
           let a = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: s.a),
           let g = try? Curve25519.Signing.PrivateKey(rawRepresentation: s.s) {
            return DeviceIdentity(id: s.id, agreement: a, signing: g)
        }
        let n = generate()
        n.save(keys)
        return n
    }
}

enum RelayCrypto {
    static let info = Data("gente-relay-v1".utf8)

    static func aad(from: String, to: String, id: String, sent: Int64) -> Data {
        Data("gente-relay-v1|\(from)|\(to)|\(id)|\(sent)".utf8)
    }

    static func key(shared: SharedSecret, eph: Data, recipient: Data) -> SymmetricKey {
        shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: eph + recipient, sharedInfo: info, outputByteCount: 32)
    }

    static func seal(_ payload: SyncPayload, from me: DeviceIdentity, to peer: DevicePublic) throws -> Envelope {
        guard let rx = Data(base64URL: peer.x25519) else { throw RelayCryptoError.badKey }
        let recipient = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: rx)
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let k = key(shared: try eph.sharedSecretFromKeyAgreement(with: recipient), eph: eph.publicKey.rawRepresentation, recipient: rx)
        let id = UUID().uuidString.lowercased()
        let sent = Int64(Date().timeIntervalSince1970 * 1000)
        let ad = aad(from: me.id, to: peer.id, id: id, sent: sent)
        let nonce = ChaChaPoly.Nonce()
        let box = try ChaChaPoly.seal(try JSONEncoder().encode(payload), using: k, nonce: nonce, authenticating: ad)
        let ephRaw = eph.publicKey.rawRepresentation
        let signed = ad + ephRaw + Data(nonce) + box.ciphertext + box.tag
        let sig = try me.signing.signature(for: signed)
        return Envelope(id: id, from: me.id, to: peer.id, eph: ephRaw.base64URL, nonce: Data(nonce).base64URL,
                        ct: (box.ciphertext + box.tag).base64URL, sig: sig.base64URL, sent: sent)
    }

    static func open(_ e: Envelope, me: DeviceIdentity, sender: DevicePublic) throws -> SyncPayload {
        guard e.to == me.id else { throw RelayCryptoError.notForMe }
        guard let ephRaw = Data(base64URL: e.eph), let nonceRaw = Data(base64URL: e.nonce), let ct = Data(base64URL: e.ct),
              let sig = Data(base64URL: e.sig), let spk = Data(base64URL: sender.ed25519), ct.count >= 16 else { throw RelayCryptoError.badKey }
        let ad = aad(from: e.from, to: e.to, id: e.id, sent: e.sent)
        let signer = try Curve25519.Signing.PublicKey(rawRepresentation: spk)
        guard signer.isValidSignature(sig, for: ad + ephRaw + nonceRaw + ct) else { throw RelayCryptoError.badSignature }
        let eph = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: ephRaw)
        let k = key(shared: try me.agreement.sharedSecretFromKeyAgreement(with: eph), eph: ephRaw,
                    recipient: me.agreement.publicKey.rawRepresentation)
        let box = try ChaChaPoly.SealedBox(nonce: ChaChaPoly.Nonce(data: nonceRaw), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
        return try JSONDecoder().decode(SyncPayload.self, from: try ChaChaPoly.open(box, using: k, authenticating: ad))
    }

    /// Six digits both screens show while pairing. If they match, no one is in the middle.
    static func safetyCode(_ a: DevicePublic, _ b: DevicePublic, secret: Data) -> String {
        let keys = [a.x25519 + a.ed25519, b.x25519 + b.ed25519].sorted().joined(separator: "|")
        let h = SHA256.hash(data: Data(keys.utf8) + secret)
        let n = h.prefix(4).reduce(UInt32(0)) { $0 << 8 | UInt32($1) } % 1_000_000
        return String(format: "%06d", n)
    }

    /// Proof the phone saw the QR code: HMAC-SHA256(secret, phone keys).
    static func pairingProof(_ phone: DevicePublic, secret: Data) -> String {
        Data(HMAC<SHA256>.authenticationCode(for: Data((phone.x25519 + phone.ed25519).utf8), using: SymmetricKey(data: secret))).base64URL
    }
}

/// The QR code the desktop shows: gente://pair?v=1&d=<id>&n=<name>&p=<platform>&x=<x25519>&s=<ed25519>&c=<secret>
struct PairingInvite: Equatable {
    var desktop: DevicePublic
    var secret: Data

    init(desktop: DevicePublic, secret: Data) { self.desktop = desktop; self.secret = secret }

    init?(url: URL) {
        guard url.scheme == "gente", url.host == "pair",
              let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func v(_ k: String) -> String? { q.first(where: { $0.name == k })?.value }
        guard v("v") == "1", let d = v("d"), let x = v("x"), let s = v("s"), let c = v("c"),
              let secret = Data(base64URL: c), secret.count >= 16,
              Data(base64URL: x)?.count == 32, Data(base64URL: s)?.count == 32 else { return nil }
        desktop = DevicePublic(id: d, name: v("n") ?? "Computer", platform: v("p") ?? "mac", x25519: x, ed25519: s)
        self.secret = secret
    }

    var url: URL {
        var c = URLComponents()
        c.scheme = "gente"; c.host = "pair"
        c.queryItems = [.init(name: "v", value: "1"), .init(name: "d", value: desktop.id), .init(name: "n", value: desktop.name),
                        .init(name: "p", value: desktop.platform), .init(name: "x", value: desktop.x25519),
                        .init(name: "s", value: desktop.ed25519), .init(name: "c", value: secret.base64URL)]
        return c.url!
    }
}

extension Data {
    init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
}
