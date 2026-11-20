// Copyright 2026 DeskHead Inc.
import SwiftUI
import UserNotifications

@main
struct GenteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var engine: ChatEngine
    @State private var auth: Auth
    @State private var purchases: Purchases
    @State private var sync: SyncEngine
    @State private var net: Connectivity

    init() {
        // Test launch arguments must run before anything reads the store.
        UITestSupport.prepare()
        _engine = State(initialValue: ChatEngine.shared)
        _auth = State(initialValue: Auth.shared)
        _purchases = State(initialValue: Purchases.shared)
        _sync = State(initialValue: SyncEngine.shared)
        _net = State(initialValue: Connectivity.shared)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(engine)
                .environment(auth)
                .environment(purchases)
                .environment(sync)
                .environment(net)
                .tint(G.primary)
                .onOpenURL { url in if let l = DeepLink.parse(url) { DeepLink.pending = l } }
                .onContinueUserActivity("com.deskhead.gente.chat") { a in
                    if let id = a.userInfo?["chatId"] as? String { DeepLink.pending = .chat(id) }
                }
                .task { purchases.start(); sync.start() }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// APNs token. Sent to Gente Cloud once push is set up there (needs the Apple Developer account).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        UserDefaults.standard.set(deviceToken.map { String(format: "%02x", $0) }.joined(), forKey: "apnsToken")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if let id = response.notification.request.content.userInfo["routine"] as? String,
           let r = EncryptedStore.shared.routines().first(where: { $0.id == id }) {
            await MainActor.run { DeepLink.pending = .ask(r.prompt) }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

/// Launch arguments used by UI tests and the screenshot run. They only change test state.
enum UITestSupport {
    static var isUITest: Bool { ProcessInfo.processInfo.arguments.contains("-GenteUITest") }
    static func prepare() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-GenteReset") {
            EncryptedStore.shared.eraseEverything()
            UserDefaults.standard.removePersistentDomain(forName: Bundle.main.bundleIdentifier!)
        }
        if let i = args.firstIndex(of: "-GenteCloudBase"), i + 1 < args.count {
            UserDefaults.standard.set(args[i + 1], forKey: "GenteCloudBase")
        }
        if args.contains("-GenteOnboarded") { UserDefaults.standard.set(true, forKey: "onboarded") }
        if args.contains("-GenteSeed") { DemoSeed.seed() }
        #endif
    }
}
