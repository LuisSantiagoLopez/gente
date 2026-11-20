// Copyright 2026 DeskHead Inc.
// Every request Gente makes goes through here. That is what makes "What left your phone" honest:
// one door, one log. The log keeps time, size, service and what kind of thing left. Never content.
import Foundation

/// What a request is allowed to carry. Chat context may only go to Fast mode inference.
enum Carries: String, Codable {
    case chatContext = "Chat context (recent turns and memory)"
    case toolInput = "Tool words you approved (for example a search)"
    case speech = "Text to speak"
    case encrypted = "Sealed data only your devices can open"
    case account = "Account and plan details"
    case none = "No personal content"

    var label: String { String(localized: String.LocalizationValue(rawValue)) }
}

enum Service: String, Codable {
    case inference = "Fast mode (AI)"
    case search = "Web search"
    case tts = "Voice"
    case browser = "Cloud browser"
    case apps = "Apps (Composio)"
    case media = "Images and video"
    case relay = "Encrypted relay"
    case account = "Account"
    case billing = "Plans"
    case signIn = "Sign-in"
}

struct HTTPFailure: Error, LocalizedError {
    var status: Int
    var code: String?
    var message: String?
    var errorDescription: String? { message ?? code ?? "HTTP \(status)" }
}

/// Chat content tried to leave through a door that is not inference. This is a bug, so it stops.
struct PrivacyViolation: Error {}

final class GenteHTTP: @unchecked Sendable {
    static let shared = GenteHTTP()

    let session: URLSession
    var recorder: (EgressRecord) -> Void

    init(configuration: URLSessionConfiguration = GenteHTTP.privateConfiguration(),
         recorder: ((EgressRecord) -> Void)? = nil) {
        session = URLSession(configuration: configuration)
        self.recorder = recorder ?? { EncryptedStore.shared.saveEgress($0) }
    }

    /// No disk cache, no cookies, no credential store: nothing about a request lingers on disk.
    static func privateConfiguration() -> URLSessionConfiguration {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCredentialStorage = nil
        c.timeoutIntervalForRequest = 60
        c.waitsForConnectivity = false
        c.tlsMinimumSupportedProtocolVersion = .TLSv12
        return c
    }

    static func isInference(_ url: URL?) -> Bool {
        url?.path.hasPrefix("/v1/inference/") ?? false
    }

    func check(_ req: URLRequest, carries: Carries) throws {
        if carries == .chatContext && !Self.isInference(req.url) { throw PrivacyViolation() }
        #if DEBUG
        let localTest = req.url?.host == "127.0.0.1" || req.url?.host == "localhost"
        #else
        let localTest = false
        #endif
        guard req.url?.scheme == "https" || req.url?.scheme == "wss" || localTest else { throw PrivacyViolation() }
    }

    func record(_ req: URLRequest, service: Service, carries: Carries, status: Int, bytesIn: Int) {
        let stored: String
        switch service {
        case .inference: stored = String(localized: "Not stored")
        case .relay: stored = String(localized: "Sealed; deleted once your device picks it up")
        case .media: stored = String(localized: "Result kept 30 days, then deleted")
        case .account, .billing, .signIn:
            stored = carries == .none ? String(localized: "Not stored by Gente") : String(localized: "Account record")
        default: stored = String(localized: "Not stored by Gente")
        }
        recorder(EgressRecord(service: service.rawValue, method: req.httpMethod ?? "GET",
                              host: req.url?.host ?? "", path: req.url?.path ?? "",
                              bytesOut: req.httpBody?.count ?? 0, bytesIn: bytesIn, status: status,
                              carries: carries.rawValue, stored: stored))
    }

    func data(_ req: URLRequest, service: Service, carries: Carries) async throws -> (Data, HTTPURLResponse) {
        try check(req, carries: carries)
        do {
            let (data, resp) = try await session.data(for: req)
            let http = resp as! HTTPURLResponse
            record(req, service: service, carries: carries, status: http.statusCode, bytesIn: data.count)
            return (data, http)
        } catch {
            record(req, service: service, carries: carries, status: 0, bytesIn: 0)
            throw error
        }
    }

    /// Streams a response line by line (server-sent events). Logs once the stream ends.
    func lines(_ req: URLRequest, service: Service, carries: Carries) async throws -> (AsyncThrowingStream<String, Error>, HTTPURLResponse) {
        try check(req, carries: carries)
        let (bytes, resp) = try await session.bytes(for: req)
        let http = resp as! HTTPURLResponse
        let stream = AsyncThrowingStream<String, Error> { cont in
            let task = Task {
                var count = 0
                do {
                    for try await line in bytes.lines {
                        count += line.utf8.count + 1
                        cont.yield(line)
                    }
                    self.record(req, service: service, carries: carries, status: http.statusCode, bytesIn: count)
                    cont.finish()
                } catch {
                    self.record(req, service: service, carries: carries, status: http.statusCode, bytesIn: count)
                    cont.finish(throwing: error)
                }
            }
            cont.onTermination = { _ in task.cancel() }
        }
        return (stream, http)
    }

    /// Raw byte stream, for voice playback.
    func bytes(_ req: URLRequest, service: Service, carries: Carries) async throws -> (URLSession.AsyncBytes, HTTPURLResponse) {
        try check(req, carries: carries)
        let (bytes, resp) = try await session.bytes(for: req)
        let http = resp as! HTTPURLResponse
        record(req, service: service, carries: carries, status: http.statusCode, bytesIn: Int(http.expectedContentLength))
        return (bytes, http)
    }
}
