// Copyright 2026 DeskHead Inc.
// Gente Link v1: phone <-> desktop, end-to-end encrypted. Same bytes as the Android app
// (android/.../sync/LinkCrypto.kt) and the desktop. Defined in gente-mobile-proof/SHARED.md.
//
// QR:      gente://link?v=1&id=<desktopId>&name=<name>&pk=<b64url X25519 public, 32 B>&s=<b64url secret, 16 B>
// Keys:    shared = X25519(phonePriv, desktopPk)
//          kP2D = HKDF-SHA256(shared, salt = s, info = "gente-link v1 phone->desktop", 32)
//          kD2P = HKDF-SHA256(shared, salt = s, info = "gente-link v1 desktop->phone", 32)
// Channel: b64url(SHA-256("gente-link v1 channel" || s)), first 22 characters
// Seal:    AES-256-GCM, random 12-byte nonce, AAD = "gente-link/v1|<channel>|<from>|<seq>"
// Safety:  2 bytes of HKDF(shared, s, "gente-link v1 sas") as a 16-bit number mod 10000, 4 digits
// The relay (Gente Cloud) only ever sees the envelope. It has no key that can open it.
import CryptoKit
import Foundation

struct LinkEnvelope: Codable, Equatable {
    var v = 1
    var from: String        // "phone" | "desktop"
    var seq: Int64          // sender counter; receivers drop anything at or below the last accepted
    var n: String           // b64url 12-byte nonce
    var ct: String          // b64url ciphertext || 16-byte tag
    var epk: String? = nil  // phone public key, only in the first hello
}

struct LinkOffer: Equatable {
    var desktopId: String
    var name: String
    var desktopPk: Data
    var secret: Data

    init(desktopId: String, name: String, desktopPk: Data, secret: Data) {
        self.desktopId = desktopId; self.name = name; self.desktopPk = desktopPk; self.secret = secret
    }

    init?(text: String) {
        guard let c = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              c.scheme == "gente", c.host == "link", let q = c.queryItems else { return nil }
        func v(_ k: String) -> String? { q.first(where: { $0.name == k })?.value }
        guard v("v") == "1", let id = v("id"), let pk = v("pk").flatMap(Data.init(base64URL:)), pk.count == 32,
              let s = v("s").flatMap(Data.init(base64URL:)), s.count >= 16 else { return nil }
        self.init(desktopId: id, name: v("name") ?? "Computer", desktopPk: pk, secret: s)
    }

    var qr: String {
        var c = URLComponents(); c.scheme = "gente"; c.host = "link"
        c.queryItems = [.init(name: "v", value: "1"), .init(name: "id", value: desktopId), .init(name: "name", value: name),
                        .init(name: "pk", value: desktopPk.base64URL), .init(name: "s", value: secret.base64URL)]
        return c.string!
    }
}

enum LinkError: Error { case badKey, replay, ownMessage, version }

struct LinkSession {
    let channel: String
    let me: String
    let safetyCode: String
    private let sendKey: SymmetricKey
    private let recvKey: SymmetricKey

    /// `iAmPhone` picks which direction key seals and which opens.
    init(myPrivate: Curve25519.KeyAgreement.PrivateKey, peerPublic: Data, secret: Data, iAmPhone: Bool) throws {
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: peerPublic)
        let shared = try myPrivate.sharedSecretFromKeyAgreement(with: peer)
        func k(_ info: String, _ n: Int) -> SymmetricKey {
            shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: secret, sharedInfo: Data(info.utf8), outputByteCount: n)
        }
        let p2d = k("gente-link v1 phone->desktop", 32), d2p = k("gente-link v1 desktop->phone", 32)
        sendKey = iAmPhone ? p2d : d2p
        recvKey = iAmPhone ? d2p : p2d
        me = iAmPhone ? "phone" : "desktop"
        channel = LinkSession.channel(secret)
        let sas = k("gente-link v1 sas", 2).withUnsafeBytes { Array($0) }
        safetyCode = String(format: "%04d", ((Int(sas[0]) << 8) | Int(sas[1])) % 10000)
    }

    static func channel(_ secret: Data) -> String {
        String(Data(SHA256.hash(data: Data("gente-link v1 channel".utf8) + secret)).base64URL.prefix(22))
    }

    private func aad(_ from: String, _ seq: Int64) -> Data { Data("gente-link/v1|\(channel)|\(from)|\(seq)".utf8) }

    func seal(_ plain: Data, seq: Int64, epk: Data? = nil) throws -> LinkEnvelope {
        let box = try AES.GCM.seal(plain, using: sendKey, nonce: AES.GCM.Nonce(), authenticating: aad(me, seq))
        return LinkEnvelope(from: me, seq: seq, n: Data(box.nonce).base64URL, ct: (box.ciphertext + box.tag).base64URL, epk: epk?.base64URL)
    }

    /// Throws if the envelope was changed, replayed under another counter, or sent by us.
    func open(_ e: LinkEnvelope) throws -> Data {
        guard e.v == 1 else { throw LinkError.version }
        guard e.from != me else { throw LinkError.ownMessage }
        guard let n = Data(base64URL: e.n), let ct = Data(base64URL: e.ct), ct.count >= 16 else { throw LinkError.badKey }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: n), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
        return try AES.GCM.open(box, using: recvKey, authenticating: aad(e.from, e.seq))
    }
}

extension Data {
    init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
}
