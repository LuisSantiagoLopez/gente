// Copyright 2026 DeskHead Inc.
// The database key. It never leaves this iPhone and is never synced or backed up.
//
// On a real iPhone the 256-bit key is wrapped by a Secure Enclave P-256 key: the wrapped key sits
// in the Keychain, and only this phone's Secure Enclave can unwrap it. The Simulator has no Secure
// Enclave, so there the key sits in the Keychain directly (still "this device only").
import CryptoKit
import Foundation
import Security

enum KeyStoreError: Error { case keychain(OSStatus), corrupt }

struct KeyStore {
    let service: String
    init(service: String = "com.deskhead.gente.vault") { self.service = service }

    /// Whether the key is protected by the Secure Enclave on this device.
    var usesSecureEnclave: Bool { SecureEnclave.isAvailable }

    func databaseKey() throws -> SymmetricKey {
        if let blob = try read("db-key") {
            return try unwrap(blob)
        }
        let key = SymmetricKey(size: .bits256)
        try write("db-key", try wrap(key))
        return key
    }

    /// Deletes every key. Used by "Delete account" and "Erase this phone's Gente data".
    func eraseAll() {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(q as CFDictionary)
    }

    // MARK: Wrapping

    private struct Wrapped: Codable { var se: Data?; var eph: Data?; var box: Data? ; var raw: Data? }

    private func wrap(_ key: SymmetricKey) throws -> Data {
        let raw = key.withUnsafeBytes { Data($0) }
        guard SecureEnclave.isAvailable else { return try JSONEncoder().encode(Wrapped(raw: raw)) }
        let se = try SecureEnclave.P256.KeyAgreement.PrivateKey()
        let eph = P256.KeyAgreement.PrivateKey()
        let kek = try Self.kek(try eph.sharedSecretFromKeyAgreement(with: se.publicKey))
        let box = try AES.GCM.seal(raw, using: kek).combined!
        return try JSONEncoder().encode(Wrapped(se: se.dataRepresentation, eph: eph.publicKey.x963Representation, box: box))
    }

    private func unwrap(_ blob: Data) throws -> SymmetricKey {
        let w = try JSONDecoder().decode(Wrapped.self, from: blob)
        if let raw = w.raw { return SymmetricKey(data: raw) }
        guard let seData = w.se, let ephData = w.eph, let box = w.box else { throw KeyStoreError.corrupt }
        let se = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: seData)
        let eph = try P256.KeyAgreement.PublicKey(x963Representation: ephData)
        let kek = try Self.kek(try se.sharedSecretFromKeyAgreement(with: eph))
        return SymmetricKey(data: try AES.GCM.open(try AES.GCM.SealedBox(combined: box), using: kek))
    }

    private static func kek(_ s: SharedSecret) throws -> SymmetricKey {
        s.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data("gente-db-kek-v1".utf8), sharedInfo: Data(), outputByteCount: 32)
    }

    // MARK: Keychain (this device only, never in iCloud Keychain or backups)

    func read(_ account: String) throws -> Data? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var out: AnyObject?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess else { throw KeyStoreError.keychain(st) }
        return out as? Data
    }

    func write(_ account: String, _ data: Data) throws {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrSynchronizable as String] = false
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw KeyStoreError.keychain(st) }
    }

    func delete(_ account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}
