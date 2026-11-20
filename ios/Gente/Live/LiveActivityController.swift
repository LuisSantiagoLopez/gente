// Copyright 2026 DeskHead Inc.
import ActivityKit
import Foundation

@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()
    private var activity: Activity<GenteActivityAttributes>?
    private var step = 0
    private var started = Date()

    func start(title: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, activity == nil else { return }
        step = 0; started = Date()
        activity = try? Activity.request(attributes: GenteActivityAttributes(title: title),
                                         content: .init(state: .init(status: String(localized: "Starting…"), step: 0, startedAt: started), staleDate: nil))
    }

    func update(_ status: String) {
        step += 1
        let s = GenteActivityAttributes.ContentState(status: status, step: step, startedAt: started)
        Task { await activity?.update(.init(state: s, staleDate: nil)) }
    }

    func end() {
        let a = activity
        activity = nil
        Task { await a?.end(.init(state: .init(status: String(localized: "Done"), step: step, startedAt: started), staleDate: nil), dismissalPolicy: .after(.now + 5)) }
    }
}
