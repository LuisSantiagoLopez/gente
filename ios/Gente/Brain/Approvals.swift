// Copyright 2026 DeskHead Inc.
// Approval rules, same as desktop: money, sending as the person, deleting data and legal terms
// ALWAYS ask. Nothing in this file can be turned off by the model.
import Foundation

enum ApprovalReason: String, Codable, CaseIterable {
    case money, sendAsYou, deleteData, legalTerms

    var title: String {
        switch self {
        case .money: String(localized: "This spends money")
        case .sendAsYou: String(localized: "This sends something as you")
        case .deleteData: String(localized: "This deletes data")
        case .legalTerms: String(localized: "This accepts legal terms")
        }
    }
    var symbol: String {
        switch self {
        case .money: "creditcard"
        case .sendAsYou: "paperplane"
        case .deleteData: "trash"
        case .legalTerms: "signature"
        }
    }
}

enum ApprovalRules {
    private static let patterns: [(ApprovalReason, [String])] = [
        (.money, ["pay", "purchase", "buy", "checkout", "order", "transfer", "invoice", "charge", "subscribe",
                  "book", "payment", "refund", "wire", "venmo", "paypal", "stripe", "comprar", "pagar", "pagamento"]),
        (.sendAsYou, ["send", "reply", "post", "tweet", "publish", "message", "email", "mail", "comment", "invite",
                      "share", "dm", "forward", "enviar", "responder", "publicar"]),
        (.deleteData, ["delete", "remove", "trash", "erase", "drop", "destroy", "purge", "wipe", "archive", "unsubscribe",
                       "borrar", "eliminar", "apagar", "excluir"]),
        (.legalTerms, ["terms", "agree", "accept", "consent", "sign", "contract", "tos", "eula", "license", "aceptar", "aceitar", "firmar", "assinar"]),
    ]

    /// Every reason this tool call needs a yes from the person. Empty means it may run.
    static func reasons(tool: String, arguments: String) -> [ApprovalReason] {
        if tool == "web_search" || tool == "make_image" || tool == "remember" { return [] }
        // Composio's own helpers only look things up or make sign-in links.
        if tool == "apps", let d = arguments.data(using: .utf8),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let name = o["tool"] as? String,
           ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_CHECK_ACTIVE_CONNECTION",
            "COMPOSIO_CHECK_ACTIVE_CONNECTIONS", "COMPOSIO_LIST_TOOLKITS"].contains(name) { return [] }
        // Reading a page is safe; acting on one (click, type, submit) is checked.
        let hay = (tool + " " + arguments).lowercased()
        let tokens = Set(hay.split(whereSeparator: { !$0.isLetter }).map(String.init))
        var out: [ApprovalReason] = []
        for (reason, words) in patterns where words.contains(where: { w in tokens.contains(w) || tokens.contains(where: { $0.hasPrefix(w) && w.count > 4 }) }) {
            out.append(reason)
        }
        if tool == "browse", let d = arguments.data(using: .utf8),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], (o["action"] as? String ?? "read") == "read" {
            return []
        }
        return out
    }
}
