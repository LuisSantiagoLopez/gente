// Copyright 2026 DeskHead Inc.
import ActivityKit
import Foundation

/// Live Activity for long tasks (cloud browser, desktop tasks). Shared with the widget extension.
struct GenteActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var status: String
        var step: Int
        var startedAt: Date
    }
    var title: String
}
