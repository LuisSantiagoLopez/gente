// Copyright 2026 DeskHead Inc.
// Zero raw errors. Every failure becomes one calm sentence and, where it helps, one action.
import Foundation
import Network
import Observation

enum FriendlyAction: Equatable { case none, upgrade, signIn, retry, pair }

struct FriendlyError: Equatable, Identifiable {
    var id = UUID()
    var text: String
    var action: FriendlyAction
}

enum Friendly {
    static func from(_ error: Error) -> FriendlyError {
        if let f = error as? HTTPFailure {
            switch (f.status, f.code) {
            case (401, _): return .init(text: String(localized: "Please sign in again to keep going."), action: .signIn)
            case (402, "out_of_credit"): return .init(text: String(localized: "You're out of hours this month. Add hours to keep going."), action: .upgrade)
            case (402, _): return .init(text: String(localized: "Fast mode comes with Pro. You can also use Gente on your own computer for free."), action: .upgrade)
            case (503, "fast_off"): return .init(text: String(localized: "Fast mode is resting right now. Pair your computer to keep going, or try again later."), action: .pair)
            case (429, _): return .init(text: String(localized: "Gente is a little busy. Try again in a moment."), action: .retry)
            case (500..., _): return .init(text: String(localized: "Gente Cloud didn't answer. Your message is safe on your phone. Try again."), action: .retry)
            default: return .init(text: String(localized: "That didn't work. Try again."), action: .retry)
            }
        }
        if error is AuthError { return .init(text: String(localized: "Please sign in to use Fast mode."), action: .signIn) }
        if error is PrivacyViolation { return .init(text: String(localized: "Gente stopped a request that wasn't private. Nothing was sent."), action: .none) }
        if (error as? URLError)?.code == .notConnectedToInternet || (error as? URLError)?.code == .networkConnectionLost {
            return .init(text: String(localized: "You're offline. Your chats are still here. Send again when you're back."), action: .retry)
        }
        if error is CancellationError { return .init(text: String(localized: "Stopped."), action: .none) }
        return .init(text: String(localized: "That didn't work. Try again."), action: .retry)
    }

    static func toolFailure(_ f: HTTPFailure) -> String {
        f.status == 402 ? String(localized: "This tool needs a paid plan") : String(localized: "A tool didn't answer")
    }
}

@Observable
final class Connectivity {
    static let shared = Connectivity()
    var online = true
    private let monitor = NWPathMonitor()
    init() {
        monitor.pathUpdateHandler = { [weak self] p in
            DispatchQueue.main.async { self?.online = p.status == .satisfied }
        }
        monitor.start(queue: DispatchQueue(label: "gente.net"))
    }
}
