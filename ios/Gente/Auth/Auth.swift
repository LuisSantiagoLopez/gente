// Copyright 2026 DeskHead Inc.
// Sign-in with Clerk through ASWebAuthenticationSession and OAuth 2.0 + PKCE (S256).
// Gente Cloud accepts Clerk OAuth access tokens (src/lib/auth.ts: acceptsToken oauth_token).
import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import UIKit

struct OAuthTokens: Codable {
    var accessToken: String
    var refreshToken: String?
    var expiresAt: Date
}

enum AuthError: Error { case cancelled, badCallback, signedOut, server(String) }

@MainActor @Observable
final class Auth: NSObject {
    static let shared = Auth()
    private let keys = KeyStore(service: "com.deskhead.gente.auth")
    private(set) var signedIn = false
    var email: String?

    override init() {
        super.init()
        signedIn = (try? keys.read("tokens")) != nil
        email = (try? keys.read("email")).flatMap { $0.flatMap { String(data: $0, encoding: .utf8) } }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-GenteDemoSignedIn") { signedIn = true; email = "reviewer@gente.test" }
        #endif
    }

    // MARK: PKCE

    static func verifier() -> String {
        var b = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
        return Data(b).base64URL
    }
    static func challenge(_ v: String) -> String { Data(SHA256.hash(data: Data(v.utf8))).base64URL }

    func authorizeURL(verifier: String, state: String) -> URL {
        var c = URLComponents(url: Config.clerkFrontendAPI.appendingPathComponent("/oauth/authorize"), resolvingAgainstBaseURL: false)!
        c.queryItems = [
            .init(name: "response_type", value: "code"),
            .init(name: "client_id", value: Config.clerkClientID),
            .init(name: "redirect_uri", value: Config.redirectURI),
            .init(name: "scope", value: "profile email offline_access"),
            .init(name: "code_challenge", value: Self.challenge(verifier)),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
        ]
        return c.url!
    }

    func signIn() async throws {
        let verifier = Self.verifier()
        let state = Self.verifier()
        let url = authorizeURL(verifier: verifier, state: state)
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callback: .customScheme(Config.redirectScheme)) { url, err in
                if let url { cont.resume(returning: url) }
                else if let e = err as? ASWebAuthenticationSessionError, e.code == .canceledLogin { cont.resume(throwing: AuthError.cancelled) }
                else { cont.resume(throwing: err ?? AuthError.badCallback) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = true
            s.start()
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw AuthError.badCallback }
        try await exchange(["grant_type": "authorization_code", "code": code, "redirect_uri": Config.redirectURI,
                            "client_id": Config.clerkClientID, "code_verifier": verifier])
        await loadEmail()
        signedIn = true
    }

    private func exchange(_ form: [String: String]) async throws {
        var r = URLRequest(url: Config.clerkFrontendAPI.appendingPathComponent("/oauth/token"))
        r.httpMethod = "POST"
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        r.httpBody = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await GenteHTTP.shared.data(r, service: .signIn, carries: .account)
        guard resp.statusCode == 200,
              let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = o["access_token"] as? String else { throw AuthError.server("token \(resp.statusCode)") }
        let t = OAuthTokens(accessToken: access, refreshToken: o["refresh_token"] as? String ?? form["refresh_token"],
                            expiresAt: Date().addingTimeInterval((o["expires_in"] as? Double ?? 3600) - 30))
        try keys.write("tokens", try JSONEncoder().encode(t))
    }

    private func loadEmail() async {
        guard let tok = try? await accessToken() else { return }
        var r = URLRequest(url: Config.clerkFrontendAPI.appendingPathComponent("/oauth/userinfo"))
        r.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        if let (d, _) = try? await GenteHTTP.shared.data(r, service: .signIn, carries: .account),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let e = o["email"] as? String {
            email = e
            try? keys.write("email", Data(e.utf8))
        }
    }

    /// A fresh access token, refreshed when it is about to expire.
    func accessToken() async throws -> String {
        #if DEBUG
        if let demo = ProcessInfo.processInfo.environment["GENTE_TEST_TOKEN"] { return demo }
        #endif
        guard let data = try keys.read("tokens") else { throw AuthError.signedOut }
        var t = try JSONDecoder().decode(OAuthTokens.self, from: data)
        if t.expiresAt < Date(), let refresh = t.refreshToken {
            try await exchange(["grant_type": "refresh_token", "refresh_token": refresh, "client_id": Config.clerkClientID])
            t = try JSONDecoder().decode(OAuthTokens.self, from: try keys.read("tokens")!)
        }
        return t.accessToken
    }

    /// Renews the access token now (used when Gente Cloud says it expired early).
    func forceRefresh() async throws {
        guard let data = try keys.read("tokens") else { throw AuthError.signedOut }
        let t = try JSONDecoder().decode(OAuthTokens.self, from: data)
        guard let refresh = t.refreshToken else { throw AuthError.signedOut }
        try await exchange(["grant_type": "refresh_token", "refresh_token": refresh, "client_id": Config.clerkClientID])
    }

    func signOut() {
        keys.eraseAll()
        email = nil
        signedIn = false
    }
}

extension Auth: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
