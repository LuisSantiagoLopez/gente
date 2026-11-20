// Copyright 2026 DeskHead Inc.
// Tools run from the phone through Gente Cloud proxies. Only the tool's own arguments leave
// (for example the search words), never the chat history.
import Foundation

enum ToolSpec {
    static func fn(_ name: String, _ desc: String, _ props: [String: Any], _ required: [String]) -> [String: Any] {
        ["type": "function", "function": ["name": name, "description": desc,
                                          "parameters": ["type": "object", "properties": props, "required": required]]]
    }
    static let all: [[String: Any]] = [
        fn("web_search", "Search the web for recent or factual information.",
           ["query": ["type": "string"]], ["query"]),
        fn("browse", "Use a cloud browser the person can watch live. action=read opens a URL and returns its text; action=click or type acts on the page.",
           ["action": ["type": "string", "enum": ["read", "click", "type"]], "url": ["type": "string"],
            "selector": ["type": "string"], "text": ["type": "string"]], ["action"]),
        fn("apps", "Work in the person's connected apps (Gmail, Calendar, Slack, Notion and more). To find an action, call tool COMPOSIO_SEARCH_TOOLS with arguments {\"queries\": [{\"use_case\": \"what you want to do\"}]}. Then call the action slug (for example GMAIL_SEND_EMAIL) with its arguments. If an app is not connected, tell the person to connect it in Settings > Connected apps.",
           ["tool": ["type": "string"], "arguments": ["type": "object"]], ["tool"]),
        fn("make_image", "Create an image from a description.", ["prompt": ["type": "string"]], ["prompt"]),
        fn("remember", "Save a short fact about the person to their phone's memory.", ["fact": ["type": "string"]], ["fact"]),
    ]
}

struct ToolOutcome {
    var text: String
    var step: String
    var sources: [Source] = []
}

@MainActor
final class ToolRunner {
    var api = CloudAPI.shared
    var browser: BrowserSession?
    var onBrowserOpened: (URL?) -> Void = { _ in }

    func run(_ call: ToolCall) async -> ToolOutcome {
        let args = (try? JSONSerialization.jsonObject(with: Data(call.arguments.utf8))) as? [String: Any] ?? [:]
        do {
            switch call.name {
            case "web_search":
                let q = args["query"] as? String ?? ""
                let r = try await api.search(q)
                let text = r.prefix(5).enumerated().map { i, x in
                    "[\(i + 1)] \(x.title ?? x.url) (\(x.url))\n\((x.text ?? "").prefix(900))"
                }.joined(separator: "\n\n")
                return ToolOutcome(text: text.isEmpty ? "No results." : text,
                                   step: String(localized: "Searched the web"),
                                   sources: r.prefix(5).map { Source(title: $0.title ?? $0.url, url: $0.url) })
            case "browse":
                if browser == nil {
                    let s = try await BrowserSession.start(api: api)
                    browser = s
                    onBrowserOpened(s.liveView)
                    LiveActivityController.shared.start(title: String(localized: "Gente is browsing"))
                }
                let action = args["action"] as? String ?? "read"
                let out: String
                switch action {
                case "click": out = try await browser!.click(args["selector"] as? String ?? "")
                case "type": out = try await browser!.type(args["selector"] as? String ?? "", args["text"] as? String ?? "")
                default: out = try await browser!.read(args["url"] as? String ?? "about:blank")
                }
                LiveActivityController.shared.update(String(localized: "Reading the page"))
                return ToolOutcome(text: String(out.prefix(8000)), step: String(localized: "Used the cloud browser"))
            case "apps":
                let name = args["tool"] as? String ?? ""
                let res = try await ConnectedApps.shared.run(name, arguments: args["arguments"] ?? [:])
                let data = try JSONSerialization.data(withJSONObject: res)
                return ToolOutcome(text: String(data: data, encoding: .utf8).map { String($0.prefix(8000)) } ?? "",
                                   step: String(localized: "Worked in your apps"))
            case "make_image":
                var job = try await api.makeImage(args["prompt"] as? String ?? "")
                for _ in 0..<30 where job.status != "completed" && job.status != "failed" {
                    try await Task.sleep(for: .seconds(2))
                    job = try await api.mediaJob(job.jobId)
                }
                if job.stub == true { return ToolOutcome(text: "Image generation is not available right now.", step: String(localized: "Tried to make an image")) }
                if let f = job.files?.first, let u = URL(string: f.url) {
                    let local = try await MediaSaver.save(u)
                    return ToolOutcome(text: "Image saved on the phone: \(local.lastPathComponent)", step: String(localized: "Made an image"))
                }
                return ToolOutcome(text: "The image did not finish.", step: String(localized: "Tried to make an image"))
            case "remember":
                let fact = args["fact"] as? String ?? ""
                EncryptedStore.shared.saveBrain(BrainItem(kind: .memory, title: String(fact.prefix(60)), body: fact))
                return ToolOutcome(text: "Saved.", step: String(localized: "Remembered this on your phone"))
            default:
                return ToolOutcome(text: "Unknown tool.", step: call.name)
            }
        } catch let f as HTTPFailure {
            return ToolOutcome(text: "The tool could not run (\(f.code ?? String(f.status))).", step: Friendly.toolFailure(f))
        } catch {
            return ToolOutcome(text: "The tool could not run.", step: String(localized: "A tool didn't answer"))
        }
    }

    func finish() async {
        if let b = browser { await b.close() }
        browser = nil
        LiveActivityController.shared.end()
    }
}

/// Saves cloud results to the phone at once. The cloud copy is only a handoff.
enum MediaSaver {
    static func save(_ url: URL) async throws -> URL {
        let (data, _) = try await GenteHTTP.shared.data(URLRequest(url: url), service: .media, carries: .none)
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Media", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(UUID().uuidString + ".png")
        try data.write(to: file, options: [.completeFileProtectionUntilFirstUserAuthentication])
        EncryptedStore.excludeFromBackup(dir)
        return file
    }
}

/// A Browserbase computer driven over the Chrome DevTools Protocol. The live view is shown to the person.
final class BrowserSession {
    let id: String
    let liveView: URL?
    private let ws: URLSessionWebSocketTask
    private var target: String?
    private var counter = 0
    private let api: CloudAPI
    private var beat: Task<Void, Never>?

    init(id: String, liveView: URL?, ws: URLSessionWebSocketTask, api: CloudAPI) {
        self.id = id; self.liveView = liveView; self.ws = ws; self.api = api
    }

    static func start(api: CloudAPI) async throws -> BrowserSession {
        let s = try await api.startBrowser()
        guard let c = s.connection.connectUrl, let u = URL(string: c) else { throw HTTPFailure(status: 502, code: "no_connect_url") }
        let ws = api.http.session.webSocketTask(with: u)
        ws.resume()
        api.http.record(URLRequest(url: u), service: .browser, carries: .toolInput, status: 101, bytesIn: 0)
        let b = BrowserSession(id: s.sessionId, liveView: s.connection.liveViewUrl.flatMap(URL.init(string:)), ws: ws, api: api)
        let every = UInt64(s.heartbeatEverySeconds ?? 30)
        b.beat = Task { [api] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: every * 1_000_000_000)
                try? await api.heartbeat(s.sessionId)
            }
        }
        return b
    }

    private func send(_ method: String, _ params: [String: Any] = [:], session: String? = nil) async throws -> [String: Any] {
        counter += 1
        let id = counter
        var msg: [String: Any] = ["id": id, "method": method, "params": params]
        if let session { msg["sessionId"] = session }
        let data = try JSONSerialization.data(withJSONObject: msg)
        try await ws.send(.string(String(data: data, encoding: .utf8)!))
        while true {
            let m = try await ws.receive()
            guard case .string(let s) = m, let o = try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { continue }
            if o["id"] as? Int == id { return o["result"] as? [String: Any] ?? [:] }
        }
    }

    private func page() async throws -> String {
        if let target { return target }
        let t = try await send("Target.createTarget", ["url": "about:blank"])
        let a = try await send("Target.attachToTarget", ["targetId": t["targetId"] as? String ?? "", "flatten": true])
        target = a["sessionId"] as? String
        return target ?? ""
    }

    private func eval(_ js: String) async throws -> String {
        let s = try await page()
        let r = try await send("Runtime.evaluate", ["expression": js, "awaitPromise": true, "returnByValue": true], session: s)
        return ((r["result"] as? [String: Any])?["value"]).map { "\($0)" } ?? ""
    }

    func read(_ url: String) async throws -> String {
        let s = try await page()
        _ = try await send("Page.navigate", ["url": url], session: s)
        try await Task.sleep(for: .seconds(2))
        return try await eval("document.title + '\\n' + document.body.innerText.slice(0, 8000)")
    }
    func click(_ selector: String) async throws -> String {
        try await eval("(()=>{const e=document.querySelector(\(Self.js(selector)));if(!e)return 'not found';e.click();return 'clicked'})()")
    }
    func type(_ selector: String, _ text: String) async throws -> String {
        try await eval("(()=>{const e=document.querySelector(\(Self.js(selector)));if(!e)return 'not found';e.focus();e.value=\(Self.js(text));e.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()")
    }
    static func js(_ s: String) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!.dropFirst().dropLast().description
    }

    func close() async {
        beat?.cancel()
        ws.cancel(with: .normalClosure, reason: nil)
        await api.stopSession(id)
    }
}
