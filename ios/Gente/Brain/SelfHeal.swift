// Copyright 2026 DeskHead Inc.
// Self-healing on the phone. Failure ids, outcomes and the repair-event shape follow the shared
// contract in docs/gente/self-heal-catalog.md (desktop, cloud, iOS, Android), so fleet learning
// groups the same failure across platforms. Every repair becomes one plain line in
// "Gente fixed itself". Nothing here carries chat content.
import Foundation
import Observation
import UIKit

enum FailureID: String, Codable, CaseIterable {
    case signInExpired = "sign-in-expired"
    case relayDown = "relay-down"
    case cloudModelUnavailable = "cloud-model-unavailable"
    case slowReplies = "slow-replies"
}

/// Step ids. Shared ids where the step is the same; phone-only ids where the phone does something else.
enum RepairStep: String, Codable {
    case refreshSignIn = "refresh-sign-in"
    case restartRelay = "restart-relay"
    case answerOnYourComputer = "answer-on-your-computer"
    case waitForCloud = "wait-for-cloud"
}

enum RepairOutcome: String, Codable { case fixed, reported, needsPerson = "needs-person", stillTrying = "still-trying" }

struct RepairEvent: Codable, Identifiable, Hashable {
    var id = UUID().uuidString
    var at = Date()
    var failureId: FailureID
    var outcome: RepairOutcome
    var fixedBy: RepairStep?
    var ms: Int?
}

@MainActor @Observable
final class SelfHeal {
    static let shared = SelfHeal()
    var store: EncryptedStore = .shared
    /// Where anonymous repair notes go (Info.plist GenteSelfHealURL). Empty: nothing is ever sent.
    var reportURL: URL? = (Bundle.main.object(forInfoDictionaryKey: "GenteSelfHealURL") as? String)
        .flatMap { $0.isEmpty ? nil : URL(string: $0) }
    var http: GenteHTTP = .shared
    private(set) var events: [RepairEvent] = []
    var lastSent: [String: Any]?
    private var lastRecorded: [FailureID: Date] = [:]

    init() { events = EncryptedStore.shared.all("repair", RepairEvent.self, newestFirst: true, limit: 200) }

    /// Off by default. The person turns it on in Settings > Gente fixed itself.
    var sendNotes: Bool {
        get { UserDefaults.standard.bool(forKey: "selfheal.send") }
        set { UserDefaults.standard.set(newValue, forKey: "selfheal.send") }
    }

    static var installId: String {
        if let id = UserDefaults.standard.string(forKey: "selfheal.installId") { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: "selfheal.installId")
        return id
    }

    @discardableResult
    func record(_ failure: FailureID, _ outcome: RepairOutcome, fixedBy: RepairStep? = nil, since start: Date? = nil,
                quietFor: TimeInterval = 0) -> RepairEvent? {
        if quietFor > 0, let last = lastRecorded[failure], Date().timeIntervalSince(last) < quietFor { return nil }
        lastRecorded[failure] = Date()
        let e = RepairEvent(failureId: failure, outcome: outcome, fixedBy: fixedBy,
                            ms: start.map { Int(Date().timeIntervalSince($0) * 1000) })
        store.put("repair", id: e.id, sort: e.at.timeIntervalSince1970, e)
        events.insert(e, at: 0)
        send(e)
        return e
    }

    /// The contract's repair event. No content, no personal data, no account id.
    static func payload(_ e: RepairEvent) -> [String: Any] {
        var p: [String: Any] = ["kind": "repair", "failureId": e.failureId.rawValue, "outcome": e.outcome.rawValue,
                                "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0",
                                "platform": "ios", "installId": installId]
        if let f = e.fixedBy { p["fixedBy"] = f.rawValue }
        if let ms = e.ms { p["ms"] = ms }
        return p
    }

    private func send(_ e: RepairEvent) {
        guard sendNotes, let url = reportURL else { return }
        let p = Self.payload(e)
        lastSent = p
        var r = URLRequest(url: url.appendingPathComponent("diagnostics"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: p)
        Task { _ = try? await http.data(r, service: .account, carries: .none) }
    }

    // MARK: Plain words (same sentence shape as the desktop: "9:41 AM: ___, so I ___ (2 s).")

    static func what(_ f: FailureID) -> String {
        switch f {
        case .signInExpired: String(localized: "your sign-in ran out")
        case .relayDown: String(localized: "the link to your computer dropped")
        case .cloudModelUnavailable: String(localized: "Gente Cloud was warming up")
        case .slowReplies: String(localized: "replies were slow because the model was busy")
        }
    }

    static func did(_ s: RepairStep) -> String {
        switch s {
        case .refreshSignIn: String(localized: "renewed your sign-in")
        case .restartRelay: String(localized: "reconnected to your computer")
        case .answerOnYourComputer: String(localized: "answered on your computer instead")
        case .waitForCloud: String(localized: "waited for it and then answered")
        }
    }

    static func calm(_ f: FailureID) -> String {
        switch f {
        case .signInExpired: String(localized: "Please sign in to Gente again. Your chats are safe.")
        case .relayDown: String(localized: "Gente can't reach your computer right now. It keeps trying.")
        default: String(localized: "I'm still working on it.")
        }
    }

    static func describe(_ e: RepairEvent) -> String {
        let time = e.at.formatted(date: .omitted, time: .shortened)
        let secs = max(1, Int(((Double(e.ms ?? 0)) / 1000).rounded()))
        if (e.outcome == .fixed || e.outcome == .reported), let step = e.fixedBy {
            return String(localized: "\(time): \(what(e.failureId)), so I \(did(step)) (\(secs) s).")
        }
        return String(localized: "\(time): \(what(e.failureId)). \(calm(e.failureId))")
    }
}
