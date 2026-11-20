// Copyright 2026 DeskHead Inc.
// Every user flow, end to end in the Simulator, against a local fake Gente Cloud.
import XCTest

class GenteUITestCase: XCTestCase {
    var cloud: MockCloud!
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        cloud = try MockCloud()
        app = XCUIApplication()
        app.launchArguments = ["-GenteUITest", "-GenteReset", "-GenteCloudBase", cloud.base]
        app.launchEnvironment["GENTE_TEST_TOKEN"] = "ui-test-token"
    }
    override func tearDown() { cloud.stop() }

    func launchSignedIn(seed: Bool = false, language: String? = nil) {
        app.launchArguments += ["-GenteOnboarded", "-GenteDemoSignedIn"]
        if seed { app.launchArguments += ["-GenteSeed"] }
        if let language { app.launchArguments += ["-AppleLanguages", "(\(language))", "-AppleLocale", language.replacingOccurrences(of: "-", with: "_")] }
        app.launch()
    }

    func send(_ text: String) {
        let field = app.textFields["composer.field"].exists ? app.textFields["composer.field"] : app.textViews["composer.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(text)
        app.buttons["composer.send"].tap()
    }

    func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s); a.name = name; a.lifetime = .keepAlways; add(a)
        if let dir = ProcessInfo.processInfo.environment["GENTE_SHOT_DIR"] ?? Optional("/tmp/gente-shots") {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        }
    }
}

final class FlowTests: GenteUITestCase {
    func testOnboardingConsentAndSignInSheet() {
        app.launch()
        XCTAssertTrue(app.staticTexts["Gente"].waitForExistence(timeout: 5))
        shot("01-welcome")
        app.buttons["onboarding.continue"].tap()
        shot("02-privacy")
        app.buttons["onboarding.continue"].tap()
        let signIn = app.buttons["onboarding.signin"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 3))
        XCTAssertFalse(signIn.isEnabled, "sign-in waits for consent to the cloud services")
        app.switches["onboarding.consent"].switches.firstMatch.tap()
        XCTAssertTrue(signIn.isEnabled)
        shot("03-consent")
        signIn.tap()
        // Ephemeral ASWebAuthenticationSession opens Clerk's real sign-in page (dev instance) with no extra prompt.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.buttons["Continue"].waitForExistence(timeout: 3) { springboard.buttons["Continue"].tap() }
        sleep(6)
        shot("04-clerk-sign-in")
    }

    /// Real sign-in: Clerk (dev instance) through ASWebAuthenticationSession + PKCE, then a real
    /// Gente Cloud call. Needs TEST_RUNNER_GENTE_REVIEWER_PASSWORD; skipped without it.
    func testRealSignInWithReviewerAccount() throws {
        guard let pw = ProcessInfo.processInfo.environment["GENTE_REVIEWER_PASSWORD"], !pw.isEmpty else {
            throw XCTSkip("no reviewer password in the environment")
        }
        app.launchArguments = ["-GenteUITest", "-GenteReset"]
        app.launchEnvironment = [:]
        app.launch()
        app.buttons["onboarding.continue"].tap()
        app.buttons["onboarding.continue"].tap()
        app.switches["onboarding.consent"].switches.firstMatch.tap()
        app.buttons["onboarding.signin"].tap()
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if sb.buttons["Continue"].waitForExistence(timeout: 3) { sb.buttons["Continue"].tap() }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let email = web.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap(); email.typeText("reviewer+clerk_test@deskhead.app")
        web.buttons["Continue"].firstMatch.tap()
        let pass = web.secureTextFields.firstMatch
        XCTAssertTrue(pass.waitForExistence(timeout: 15))
        pass.tap(); pass.typeText(pw)
        web.buttons["Continue"].firstMatch.tap()
        // Clerk "new device" check (Client Trust). +clerk_test emails take the fixed test code 424242.
        if web.staticTexts["Check your email"].waitForExistence(timeout: 8) {
            shot("05-clerk-new-device-code")
            app.typeText("424242")
            if web.buttons["Continue"].firstMatch.waitForExistence(timeout: 2) && app.webViews.count > 0 {
                web.buttons["Continue"].firstMatch.tap()
            }
        }
        XCTAssertTrue(app.buttons["home.settings"].waitForExistence(timeout: 30), "back in the app, signed in")
        app.buttons["home.settings"].tap()
        let any = app.descendants(matching: .any)
        XCTAssertTrue(any.containing(NSPredicate(format: "label CONTAINS 'reviewer+clerk_test@deskhead.app'")).firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(any.containing(NSPredicate(format: "label CONTAINS 'Pro'")).firstMatch.waitForExistence(timeout: 15), "plan read live from Gente Cloud")
        sleep(2)
        shot("06-real-signed-in")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["home.new"].tap()
        send("Say hello in five words.")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'badge.'")).firstMatch.waitForExistence(timeout: 30), "real Fast mode answer")
        shot("07-real-fast-mode")
    }

    /// Live: pairs with scripts/link-desktop-reference.mjs through the real Gente Cloud relay.
    /// Needs a signed-in app (run testRealSignInWithReviewerAccount first) and TEST_RUNNER_LINK_QR.
    func testLivePairingWithReferenceDesktop() throws {
        guard let qr = ProcessInfo.processInfo.environment["LINK_QR"], let url = URL(string: qr) else {
            throw XCTSkip("no LINK_QR")
        }
        app.launchArguments = ["-GenteUITest", "-GenteOnboarded"]
        app.launchEnvironment = [:]
        app.launch()
        app.open(url)
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if sb.buttons["Open"].waitForExistence(timeout: 4) { sb.buttons["Open"].tap() }
        let code = app.staticTexts["devices.safety"]
        XCTAssertTrue(code.waitForExistence(timeout: 20), "paired: safety code shown")
        try? code.label.replacingOccurrences(of: " ", with: "").write(toFile: "/tmp/gente-live-code.txt", atomically: true, encoding: .utf8)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Paired'")).firstMatch.waitForExistence(timeout: 30), "desktop confirmed (hello_ack)")
        shot("21-live-paired")
        // Drive the desktop: start a task, get its approval on the phone, say no.
        let field = app.textFields["devices.taskField"].exists ? app.textFields["devices.taskField"] : app.textViews["devices.taskField"]
        field.tap(); field.typeText("Email Ana that Thursday works")
        app.buttons["devices.taskSend"].tap()
        let deny = app.buttons["desktopApproval.deny"]
        XCTAssertTrue(deny.waitForExistence(timeout: 30), "approval pushed from the desktop")
        shot("22-live-desktop-approval")
        deny.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'nothing was sent'")).firstMatch.waitForExistence(timeout: 30))
        shot("23-live-task-status")
        // The chat the desktop synced is on the phone.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["From the reference Mac"].waitForExistence(timeout: 10) ||
                      app.cells.containing(NSPredicate(format: "label CONTAINS 'From the reference Mac'")).firstMatch.waitForExistence(timeout: 10))
        // Private mode: the desktop answers, sealed end to end.
        app.buttons["home.new"].tap()
        app.buttons["Where the AI runs"].tap()
        app.buttons["On my computer"].tap()
        send("Hello computer")
        XCTAssertTrue(app.descendants(matching: .any)["badge.desktop"].waitForExistence(timeout: 40), "answered on your computer")
        shot("24-live-private-mode")
    }

    func testSkipSignInStillOpensApp() {
        app.launch()
        app.buttons["onboarding.continue"].tap()
        app.buttons["onboarding.continue"].tap()
        app.buttons["onboarding.skip"].tap()
        XCTAssertTrue(app.navigationBars["Gente"].waitForExistence(timeout: 5))
    }

    func testChatStreamsAnswerWithBadge() {
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("Help me plan my week")
        XCTAssertTrue(app.descendants(matching: .any)["badge.cloud"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'hardest task'")).firstMatch.exists)
        shot("10-chat-answer")
        // Only inference got the words.
        XCTAssertTrue(cloud.received("/v1/inference").contains { $0.contains("Help me plan my week") })
        XCTAssertFalse(cloud.requests.filter { !$0.path.hasPrefix("/v1/inference") }.contains { $0.body.contains("plan my week") })
    }

    func testWebSearchTool() {
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("What's the weather this weekend?")
        XCTAssertTrue(app.descendants(matching: .any)["badge.cloud"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Searched the web"].exists)
        XCTAssertEqual(cloud.received("/v1/proxy/search").count, 1)
        shot("11-search")
    }

    func testApprovalAllow() {
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("Email Ana that Thursday works")
        let allow = app.buttons["approval.allow"]
        XCTAssertTrue(allow.waitForExistence(timeout: 10))
        shot("12-approval")
        XCTAssertTrue(cloud.received("/v1/proxy/composio").isEmpty, "nothing runs before the yes")
        allow.tap()
        XCTAssertTrue(app.descendants(matching: .any)["badge.cloud"].waitForExistence(timeout: 10))
        XCTAssertTrue(cloud.received("/v1/proxy/composio").contains { $0.contains("GMAIL_SEND_EMAIL") }, "the action ran after the yes")
    }

    func testApprovalDeny() {
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("Email Ana that Thursday works")
        XCTAssertTrue(app.buttons["approval.deny"].waitForExistence(timeout: 10))
        app.buttons["approval.deny"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS \"didn't send\"")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(cloud.received("/v1/proxy/composio").isEmpty)
    }

    func testVoiceReadAloudFallsBackToLocalVoice() {
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("Help me plan my week")
        XCTAssertTrue(app.descendants(matching: .any)["badge.cloud"].waitForExistence(timeout: 10))
        app.buttons["Read aloud"].firstMatch.tap()
        // Cloud voice answers 402 on this account, so the iPhone voice reads it. No error is shown.
        sleep(2)
        XCTAssertEqual(cloud.received("/v1/proxy/tts").count, 1)
        XCTAssertFalse(app.descendants(matching: .any)["chat.error"].exists)
        // The mic button is there for talking (speech to text runs on the phone).
        XCTAssertTrue(app.buttons["Talk"].exists)
    }

    func testOfflineShowsCalmMessage() {
        app.launchArguments = ["-GenteUITest", "-GenteReset", "-GenteCloudBase", "http://127.0.0.1:9"]
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("Hello")
        XCTAssertTrue(app.descendants(matching: .any)["chat.error"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Try again"].exists)
        shot("13-offline")
    }

    func testPrivacyScreens() {
        launchSignedIn()
        app.buttons["home.new"].tap()
        send("Help me plan my week")
        XCTAssertTrue(app.descendants(matching: .any)["badge.cloud"].waitForExistence(timeout: 10))
        app.descendants(matching: .any)["badge.cloud"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'forgot it'")).firstMatch.waitForExistence(timeout: 3))
        shot("14-badge")
        app.buttons["See what left your phone"].tap()
        XCTAssertTrue(app.staticTexts["Fast mode (AI)"].firstMatch.waitForExistence(timeout: 5))
        shot("15-egress")
        // Fresh start for the data center (keeps the same encrypted store: no reset).
        app.terminate()
        app.launchArguments.removeAll { $0 == "-GenteReset" }
        app.launch()
        app.buttons["home.settings"].tap()
        app.buttons["settings.data"].tap()
        XCTAssertTrue(app.staticTexts["Chats"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Signature checked"].exists == false, "fake receipt must not verify")
        shot("16-data-center")
    }

    func testDeleteAccount() {
        launchSignedIn(seed: true)
        app.buttons["home.settings"].tap()
        let del = app.buttons["settings.deleteAccount"]
        app.swipeUp(); app.swipeUp()
        XCTAssertTrue(del.waitForExistence(timeout: 5))
        del.tap()
        app.buttons["Delete account and data"].tap()
        XCTAssertTrue(app.buttons["onboarding.continue"].waitForExistence(timeout: 10), "back to the start, signed out")
        XCTAssertEqual(cloud.requests.filter { $0.path == "/v1/me" }.count, 1)
        XCTAssertTrue(cloud.requests.first { $0.path == "/v1/me" }!.body.contains("DELETE"))
    }

    func testPaywallShowsPlansAndRestore() {
        launchSignedIn()
        app.buttons["home.settings"].tap()
        app.buttons["settings.paywall"].tap()
        XCTAssertTrue(app.buttons["paywall.pro"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["paywall.max"].exists)
        XCTAssertTrue(app.buttons["paywall.max_plus"].exists)
        XCTAssertTrue(app.buttons["paywall.restore"].exists)
        XCTAssertTrue(app.links["Terms"].exists || app.buttons["Terms"].exists)
        shot("17-paywall")
        let price = app.staticTexts.containing(NSPredicate(format: "label CONTAINS '23.99'")).firstMatch
        if price.waitForExistence(timeout: 5) {
            app.buttons["paywall.subscribe"].tap()
            // StoreKit testing sheet
            let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let buy = sb.buttons["Subscribe"]
            if buy.waitForExistence(timeout: 8) { shot("18-storekit-sheet"); buy.tap() }
        }
        app.buttons["paywall.restore"].tap()
    }

    func testRoutinesAndMemory() {
        launchSignedIn(seed: true)
        app.buttons["home.settings"].tap()
        app.buttons["Routines"].tap()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS 'Morning brief'")).firstMatch.waitForExistence(timeout: 5))
        shot("19-routines")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Memory, skills and projects"].tap()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS 'Lives in Mexico City'")).firstMatch.waitForExistence(timeout: 5))
    }

    func testConnectAnApp() {
        launchSignedIn()
        app.buttons["home.settings"].tap()
        app.buttons["settings.apps"].tap()
        let connect = app.buttons["apps.connect.gmail"].firstMatch
        XCTAssertTrue(connect.waitForExistence(timeout: 5))
        shot("25-connected-apps")
        connect.tap()
        // The app's own sign-in page opens in Safari inside Gente.
        let done = app.buttons.matching(NSPredicate(format: "label IN {'Done', 'Close'}")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15), "sign-in page opened")
        sleep(2)
        shot("26-connect-signin-page")
        done.tap()
        XCTAssertTrue(app.staticTexts["Connected"].firstMatch.waitForExistence(timeout: 10) ||
                      app.descendants(matching: .any).containing(NSPredicate(format: "label CONTAINS 'Connected'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(cloud.received("/v1/proxy/composio").filter { $0.contains("COMPOSIO_MANAGE_CONNECTIONS") }.count, 2)
        shot("27-app-connected")
    }

    func testDevicesScreen() {
        launchSignedIn()
        app.buttons["home.settings"].tap()
        app.buttons["Your devices"].tap()
        XCTAssertTrue(app.buttons["devices.pair"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["This iPhone"].exists)
        shot("20-devices")
    }

    func testAccessibilityAudit() throws {
        launchSignedIn(seed: true)
        try app.performAccessibilityAudit(for: [.dynamicType, .sufficientElementDescription, .hitRegion]) { issue in
            // System search field placeholder is Apple's own control.
            issue.element?.identifier == "" && issue.auditType == .hitRegion
        }
        app.cells.containing(NSPredicate(format: "label CONTAINS 'Mexico City'")).firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["badge.cloud"].waitForExistence(timeout: 8))
        try app.performAccessibilityAudit(for: [.dynamicType, .sufficientElementDescription])
    }
}

final class PerformanceTests: XCTestCase {
    func testLaunchTime() {
        let app = XCUIApplication()
        app.launchArguments = ["-GenteUITest", "-GenteOnboarded", "-GenteDemoSignedIn", "-GenteSeed"]
        measure(metrics: [XCTApplicationLaunchMetric()], options: { let o = XCTMeasureOptions(); o.iterationCount = 3; return o }()) {
            app.launch()
        }
    }

    func testMemoryWhileScrollingChats() {
        let app = XCUIApplication()
        app.launchArguments = ["-GenteUITest", "-GenteOnboarded", "-GenteDemoSignedIn", "-GenteSeed"]
        app.launch()
        let o = XCTMeasureOptions(); o.iterationCount = 3
        measure(metrics: [XCTMemoryMetric(application: app), XCTCPUMetric(application: app)], options: o) {
            app.cells.firstMatch.tap()
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
    }
}

/// Store screenshots: 6.9" (iPhone 17 Pro Max) and 6.5" sizes, in English, Spanish and Portuguese.
final class StoreScreenshots: GenteUITestCase {
    func relaunch() {
        app.terminate()
        app.launchArguments.removeAll { $0 == "-GenteReset" || $0 == "-GenteSeed" }
        app.launch()
        XCTAssertTrue(app.cells.firstMatch.waitForExistence(timeout: 8))
    }

    func capture(_ lang: String, _ tag: String) {
        // Real Gente Cloud (public plans call only), test chats, not signed in: no fake hosts in the log.
        app.launchArguments = ["-GenteUITest", "-GenteReset", "-GenteOnboarded", "-GenteSeed",
                               "-AppleLanguages", "(\(lang))", "-AppleLocale", lang.replacingOccurrences(of: "-", with: "_")]
        app.launchEnvironment = [:]
        app.launch()
        XCTAssertTrue(app.cells.firstMatch.waitForExistence(timeout: 8))
        sleep(1)
        shot("store-\(tag)-1-home")
        app.cells.element(boundBy: 1).tap()
        sleep(2)
        shot("store-\(tag)-2-chat")
        relaunch()
        app.cells.element(boundBy: 0).tap()
        sleep(1)
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'badge.'")).firstMatch.tap()
        sleep(2)
        shot("store-\(tag)-3-not-stored")
        relaunch()
        app.buttons["home.settings"].tap()
        app.buttons["settings.egress"].tap()
        sleep(1)
        shot("store-\(tag)-4-what-left")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["settings.data"].tap()
        sleep(1)
        shot("store-\(tag)-5-data")
        relaunch()
        app.buttons["home.settings"].tap()
        sleep(1)
        shot("store-\(tag)-6-settings")
    }
    func testEnglish() { capture("en", "en") }
    func testSpanish() { capture("es", "es") }
    func testPortuguese() { capture("pt-BR", "pt") }
}
