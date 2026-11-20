// Copyright 2026 DeskHead Inc.
// Opt-in encrypted export. Everything Gente keeps on the phone, sealed with a passphrase the
// person picks: PBKDF2-HMAC-SHA256 (600,000 rounds) -> AES-256-GCM. Format "gente-export-v1".
import CommonCrypto
import CryptoKit
import Foundation

struct ExportBundle: Codable {
    var version = 1
    var exportedAt = Date()
    var chats: [Chat]
    var messages: [Message]
    var brain: [BrainItem]
    var routines: [Routine]
}

enum Exporter {
    static let rounds: UInt32 = 600_000

    static func bundle(_ s: EncryptedStore) -> ExportBundle {
        let chats = s.chats()
        return ExportBundle(chats: chats, messages: chats.flatMap { s.messages(chat: $0.id) }, brain: s.brain(), routines: s.routines())
    }

    static func derive(_ pass: String, salt: Data) -> SymmetricKey {
        var out = [UInt8](repeating: 0, count: 32)
        let pw = Array(pass.utf8)
        _ = salt.withUnsafeBytes { s in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw.map { Int8(bitPattern: $0) }, pw.count,
                                 s.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                 CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), rounds, &out, 32)
        }
        return SymmetricKey(data: out)
    }

    static func seal(_ b: ExportBundle, passphrase: String) throws -> Data {
        var salt = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, 16, &salt)
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601
        let box = try AES.GCM.seal(try enc.encode(b), using: derive(passphrase, salt: Data(salt)), authenticating: Data("gente-export-v1".utf8))
        let header: [String: Any] = ["format": "gente-export-v1", "kdf": "pbkdf2-sha256", "rounds": rounds,
                                     "salt": Data(salt).base64EncodedString(), "data": box.combined!.base64EncodedString()]
        return try JSONSerialization.data(withJSONObject: header, options: [.prettyPrinted, .sortedKeys])
    }

    static func open(_ file: Data, passphrase: String) throws -> ExportBundle {
        let o = try JSONSerialization.jsonObject(with: file) as! [String: Any]
        let salt = Data(base64Encoded: o["salt"] as! String)!
        let box = try AES.GCM.SealedBox(combined: Data(base64Encoded: o["data"] as! String)!)
        let plain = try AES.GCM.open(box, using: derive(passphrase, salt: salt), authenticating: Data("gente-export-v1".utf8))
        let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
        return try dec.decode(ExportBundle.self, from: plain)
    }
}
