// Copyright 2026 DeskHead Inc.
// Gente Cloud endpoints the phone uses. See gente-cloud/cloud/API.md.
import Foundation

struct PlanStatus: Codable, Equatable {
    var id: String
    var status: String?
    var cloud: Bool?
    var monthlyOnlineHours: Double?
    var messagesLimit: Int?
    var messagesUsed: Int?
}

struct Balance: Codable, Equatable { var planSeconds: Double; var topupSeconds: Double; var totalSeconds: Double; var totalHours: Double }

struct SearchResult: Codable, Hashable { var title: String?; var url: String; var publishedDate: String?; var text: String? }

struct SessionStart: Codable {
    struct Connection: Codable { var connectUrl: String?; var liveViewUrl: String?; var sandboxId: String?; var envdAccessToken: String?; var domain: String? }
    var sessionId: String
    var leaseUntil: String?
    var heartbeatEverySeconds: Int?
    var connection: Connection
}

final class CloudAPI {
    static let shared = CloudAPI()
    var http = GenteHTTP.shared
    var tokens: () async throws -> String = { try await Auth.shared.accessToken() }
    var base: URL { Config.cloudBase }

    func request(_ path: String, method: String = "GET", json: Any? = nil) async throws -> URLRequest {
        var r = URLRequest(url: URL(string: path, relativeTo: base)!.absoluteURL)
        r.httpMethod = method
        r.setValue("Bearer \(try await tokens())", forHTTPHeaderField: "Authorization")
        r.setValue("Gente-iOS/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1")", forHTTPHeaderField: "User-Agent")
        if let json {
            r.httpBody = try JSONSerialization.data(withJSONObject: json)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    func call<T: Decodable>(_ path: String, method: String = "GET", json: Any? = nil, service: Service, carries: Carries = .none, as: T.Type) async throws -> T {
        let r = try await request(path, method: method, json: json)
        let (data, resp) = try await http.data(r, service: service, carries: carries)
        guard (200..<300).contains(resp.statusCode) else { throw Self.failure(resp.statusCode, data) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func failure(_ status: Int, _ data: Data) -> HTTPFailure {
        let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return HTTPFailure(status: status, code: o?["error"] as? String, message: o?["message"] as? String)
    }

    func plan() async throws -> PlanStatus { try await call("/v1/me/plan", service: .account, carries: .account, as: PlanStatus.self) }
    func balance() async throws -> Balance { try await call("/v1/balance", service: .account, carries: .account, as: Balance.self) }

    func search(_ query: String) async throws -> [SearchResult] {
        struct R: Codable { var results: [SearchResult] }
        return try await call("/v1/proxy/search", method: "POST", json: ["query": query, "numResults": 5, "includeText": true],
                              service: .search, carries: .toolInput, as: R.self).results
    }

    func startBrowser() async throws -> SessionStart {
        try await call("/v1/sessions", method: "POST", json: ["vendor": "browserbase", "taskKind": "browser"],
                       service: .browser, carries: .none, as: SessionStart.self)
    }
    func heartbeat(_ id: String) async throws {
        struct R: Codable { var ending: Bool? }
        _ = try await call("/v1/sessions/\(id)/heartbeat", method: "POST", json: [:], service: .browser, as: R.self)
    }
    func stopSession(_ id: String) async {
        struct R: Codable {}
        _ = try? await call("/v1/sessions/\(id)/stop", method: "POST", json: [:], service: .browser, as: R.self)
    }

    /// Composio MCP JSON-RPC. Returns the result object.
    var mcpSession: String?
    func composio(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        var r = try await request("/v1/proxy/composio/mcp", method: "POST",
                                  json: ["jsonrpc": "2.0", "id": UUID().uuidString, "method": method, "params": params])
        r.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        if let mcpSession { r.setValue(mcpSession, forHTTPHeaderField: "mcp-session-id") }
        let (data, resp) = try await http.data(r, service: .apps, carries: .toolInput)
        if let s = resp.value(forHTTPHeaderField: "mcp-session-id") { mcpSession = s }
        guard (200..<300).contains(resp.statusCode) else { throw Self.failure(resp.statusCode, data) }
        var body = data
        if let text = String(data: data, encoding: .utf8), text.hasPrefix("event:") || text.contains("\ndata:") || text.hasPrefix("data:") {
            let line = text.split(separator: "\n").last(where: { $0.hasPrefix("data:") }) ?? ""
            body = Data(line.dropFirst(5).utf8)
        }
        let o = (try JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        return o["result"] as? [String: Any] ?? o
    }

    struct MediaJob: Codable { var jobId: String; var status: String; var stub: Bool?; var files: [MediaFile]? }
    struct MediaFile: Codable { var url: String; var contentType: String? }
    enum FastStatus: String, Codable { case warm, waking, off }
    /// Cold start check before a Fast reply (SHARED.md).
    func inferenceStatus() async -> FastStatus {
        struct R: Codable { var state: FastStatus }
        return (try? await call("/v1/inference/status", service: .inference, carries: .none, as: R.self).state) ?? .warm
    }

    func makeImage(_ prompt: String) async throws -> MediaJob {
        try await call("/v1/proxy/media", method: "POST", json: ["model": "flux-schnell", "prompt": prompt, "imageSize": "square_hd"],
                       service: .media, carries: .toolInput, as: MediaJob.self)
    }
    func mediaJob(_ id: String) async throws -> MediaJob { try await call("/v1/proxy/media/\(id)", service: .media, as: MediaJob.self) }

    func checkoutURL(plan: String, interval: String) async throws -> URL {
        struct R: Codable { var url: String }
        return URL(string: try await call("/v1/billing/checkout", method: "POST", json: ["plan": plan, "interval": interval],
                                          service: .billing, carries: .account, as: R.self).url)!
    }

    /// Sends a StoreKit signed transaction to Gente Cloud, which checks it with the App Store Server API.
    func verifyAppStore(signedTransaction: String) async throws {
        struct R: Codable { var ok: Bool? }
        _ = try await call("/v1/billing/apple/verify", method: "POST", json: ["signedTransaction": signedTransaction],
                           service: .billing, carries: .account, as: R.self)
    }

    struct DeleteResult: Codable { var receiptId: String?; var cancelInStore: [String]? }
    /// Deletes the Gente account on the server (Clerk sign-in, plan, ledger, relay). Chats were never there.
    func deleteAccount() async throws -> DeleteResult {
        try await call("/v1/me", method: "DELETE", json: ["confirm": "DELETE"], service: .account, carries: .account, as: DeleteResult.self)
    }

    struct AccountTokens: Codable { var appleAppAccountToken: String? }
    /// The UUID Apple attaches to purchases so Gente Cloud knows whose they are, without an email.
    func appleAccountToken() async throws -> UUID? {
        try await call("/v1/store/account-token", service: .billing, carries: .account, as: AccountTokens.self)
            .appleAppAccountToken.flatMap(UUID.init(uuidString:))
    }

    struct StorePlans: Codable {
        struct P: Codable { var id: String; var onlineHours: Double? }
        var plans: [P]
        struct T: Codable { var onlineHours: Double? }
        var topup: T?
        struct Link: Codable { var allowed: Bool? }
        var webCheckoutLinkOut: Link?
    }
    /// Hours per plan and whether web checkout may be offered, for this App Store storefront.
    /// Prices themselves always come from StoreKit.
    func storePlans(storefront: String) async throws -> StorePlans {
        let r = URLRequest(url: URL(string: "/v1/billing/plans?channel=appstore&storefront=\(storefront)", relativeTo: base)!.absoluteURL)
        let (data, resp) = try await http.data(r, service: .billing, carries: .none)
        guard resp.statusCode == 200 else { throw Self.failure(resp.statusCode, data) }
        return try JSONDecoder().decode(StorePlans.self, from: data)
    }
}
