// Copyright 2026 DeskHead Inc.
import CryptoKit
import Foundation

/// AES-256-GCM for every stored row. The row id is bound in as associated data, so a ciphertext
/// copied onto another row will not open.
struct Sealer {
    let key: SymmetricKey
    func seal<T: Encodable>(_ value: T, id: String) throws -> Data {
        let plain = try JSONEncoder().encode(value)
        return try AES.GCM.seal(plain, using: key, authenticating: Data(id.utf8)).combined!
    }
    func open<T: Decodable>(_ type: T.Type, _ data: Data, id: String) throws -> T {
        let box = try AES.GCM.SealedBox(combined: data)
        return try JSONDecoder().decode(T.self, from: try AES.GCM.open(box, using: key, authenticating: Data(id.utf8)))
    }
}
