// Copyright 2026 DeskHead Inc.
import Foundation

struct Chat: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var title: String
    var createdAt = Date()
    var updatedAt = Date()
    var pinned = false
}

enum Role: String, Codable { case system, user, assistant, tool }

/// Where an answer was made. Drives the per-message badge.
enum AnsweredBy: String, Codable {
    /// Gente Cloud Fast mode. The server answered in memory and kept nothing.
    case cloud
    /// The person's own Gente computer, over the end-to-end encrypted relay.
    case desktop
    /// A model on this iPhone (off until Santi approves it).
    case onDevice
}

struct ToolCall: Codable, Hashable {
    var id: String
    var name: String
    var arguments: String
}

struct Source: Codable, Hashable { var title: String; var url: String }

struct Message: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var chatId: String
    var role: Role
    var text: String
    var createdAt = Date()
    var answeredBy: AnsweredBy?
    var toolCalls: [ToolCall]? = nil
    var toolCallId: String? = nil
    var toolName: String? = nil
    var sources: [Source]? = nil
    /// Short, plain status lines shown under a reply ("Searched the web", "Opened a browser").
    var steps: [String]? = nil
}

/// Memory, skills, brains, projects and files all live on the phone as brain items.
enum BrainKind: String, Codable, CaseIterable { case memory, skill, project, file }

struct BrainItem: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var kind: BrainKind
    var title: String
    var body: String
    var createdAt = Date()
    var updatedAt = Date()
}

struct Routine: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var title: String
    var prompt: String
    var hour: Int
    var minute: Int
    var weekdays: [Int] = [1, 2, 3, 4, 5, 6, 7]
    var enabled = true
}

/// One line in "What left your phone". Sizes and services only. Never content.
struct EgressRecord: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var at = Date()
    var service: String
    var method: String
    var host: String
    var path: String
    var bytesOut: Int
    var bytesIn: Int
    var status: Int
    /// What kind of thing left: "chat context", "search words", "text to speak", "account", ...
    var carries: String
    var stored: String
}
