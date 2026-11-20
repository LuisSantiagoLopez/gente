// Copyright 2026 DeskHead Inc.
import Foundation

enum Config {
    /// Gente Cloud. A launch argument can point a debug build at a local test server.
    static var cloudBase: URL {
        #if DEBUG
        if let s = UserDefaults.standard.string(forKey: "GenteCloudBase"), let u = URL(string: s) { return u }
        #endif
        return URL(string: "https://gente-cloud.vercel.app")!
    }
    /// Clerk (dev instance until the production instance exists).
    static let clerkFrontendAPI = URL(string: "https://cool-airedale-3945.clerk.accounts.dev")!
    /// Clerk OAuth application "Gente iOS" (public client, PKCE required).
    static let clerkClientID = "JhlOa2rDwLnLDhR9"
    static let redirectScheme = "com.deskhead.gente"
    static let redirectURI = "com.deskhead.gente://oauth/callback"

    // Live pages on Gente Cloud (checked 19 Nov 2026: 200). Terms: Apple's standard EULA until DeskHead publishes its own.
    static let privacyPolicy = URL(string: "https://gente-cloud.vercel.app/privacy")!
    static let support = URL(string: "https://gente-cloud.vercel.app/support")!
    static let deleteAccountWeb = URL(string: "https://gente-cloud.vercel.app/delete-account")!
    static let terms = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    /// The one system prompt. Kept byte-for-byte the same for everyone so the server can cache it.
    static let systemPrompt = """
    You are Gente, a private personal AI agent made by DeskHead Inc. You run for one person. \
    Answer in the language the person writes in (English, Spanish or Portuguese). Be warm, brief and plain. \
    Use tools when they help: web_search for anything recent, browse to read or act on a web page, \
    apps to work in the person's connected apps, make_image for pictures. \
    Never pay, buy, send messages as the person, delete their data, or accept legal terms without \
    their explicit approval; the app will ask them. If you are unsure, ask one short question.
    """
}
