// Copyright 2026 DeskHead Inc.
import SwiftUI

struct RootView: View {
    @AppStorage("onboarded") private var onboarded = false
    var body: some View {
        ZStack {
            G.background.ignoresSafeArea()
            if onboarded {
                HomeView().transition(.opacity.combined(with: .scale(scale: 0.98)))
            } else {
                OnboardingView { withAnimation(G.spring) { onboarded = true } }
                    .transition(.opacity)
            }
        }
        .animation(G.spring, value: onboarded)
    }
}

struct OnboardingView: View {
    var done: () -> Void
    @Environment(Auth.self) private var auth
    @State private var page = 0
    @State private var consent = false
    @State private var signingIn = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                welcome.tag(0)
                privacy.tag(1)
                cloudConsent.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(G.spring, value: page)

            HStack(spacing: 8) {
                ForEach(0..<3) { i in
                    Capsule().fill(i == page ? G.primary : G.border)
                        .frame(width: i == page ? 22 : 8, height: 8)
                }
            }
            .animation(G.spring, value: page)
            .padding(.bottom, 20)
            .accessibilityHidden(true)

            VStack(spacing: 12) {
                if let error { Text(error).font(.gente(.footnote)).foregroundStyle(G.destructive).multilineTextAlignment(.center) }
                if page < 2 {
                    Button { withAnimation(G.spring) { page += 1 } } label: { Text("Continue") }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("onboarding.continue")
                } else {
                    Button {
                        Task {
                            signingIn = true; error = nil
                            do { try await auth.signIn(); UserDefaults.standard.set(consent, forKey: "cloudConsent"); done() }
                            catch AuthError.cancelled {}
                            catch { self.error = String(localized: "Sign-in didn't finish. Try again.") }
                            signingIn = false
                        }
                    } label: {
                        if signingIn { ProgressView().tint(G.onPrimary) } else { Text("Sign in or create account") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!consent)
                    .opacity(consent ? 1 : 0.5)
                    .accessibilityIdentifier("onboarding.signin")
                    Button("Not now") { UserDefaults.standard.set(consent, forKey: "cloudConsent"); done() }
                        .font(.gente(.subheadline, weight: .medium))
                        .foregroundStyle(G.muted)
                        .accessibilityIdentifier("onboarding.skip")
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
        }
        .background(G.background)
    }

    var welcome: some View {
        VStack(spacing: 22) {
            Spacer()
            GenteMark(size: 96, breathing: true)
            Text("Gente").font(.gente(.largeTitle, weight: .bold))
            Text("Your private AI that gets things done.")
                .font(.gente(.title3)).foregroundStyle(G.muted).multilineTextAlignment(.center)
            Spacer()
        }.padding(32)
    }

    var privacy: some View {
        VStack(alignment: .leading, spacing: 22) {
            Spacer()
            Image(systemName: "lock.iphone").font(.system(size: 54, weight: .light)).foregroundStyle(G.primary)
                .accessibilityHidden(true)
            Text("Your chats stay on this iPhone").font(.gente(.title, weight: .bold))
            row("lock.fill", "Encrypted on the phone, with a key only this iPhone holds.")
            row("icloud.slash", "Not in iCloud backups. Not on our servers.")
            row("bolt.horizontal", "Each question sends only what it needs. Our servers answer and keep nothing.")
            row("list.bullet.rectangle", "See everything that left your phone, any time.")
            Spacer()
        }.padding(32)
    }

    var cloudConsent: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            Image(systemName: "hand.raised.fill").font(.system(size: 48, weight: .light)).foregroundStyle(G.primary)
                .accessibilityHidden(true)
            Text("Before Gente uses the cloud").font(.gente(.title, weight: .bold))
            Text("When you ask, Gente sends the words it needs to these services, and nothing more:")
                .font(.gente(.body)).foregroundStyle(G.muted)
            VStack(alignment: .leading, spacing: 8) {
                bullet("Gente Cloud (DeskHead Inc.): the AI answer. Not stored, not used for training.")
                bullet("Exa: web search words.")
                bullet("ElevenLabs: text to read aloud, if you turn on the cloud voice.")
                bullet("Browserbase and E2B: cloud browsers and computers for tasks.")
                bullet("Composio: actions in apps you connect.")
                bullet("fal.ai: pictures you ask for.")
            }
            Toggle(isOn: $consent) { Text("I agree to send these when I ask").font(.gente(.body, weight: .semibold)) }
                .tint(G.primary)
                .accessibilityIdentifier("onboarding.consent")
            Spacer()
        }.padding(28)
    }

    func row(_ symbol: String, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol).frame(width: 26).foregroundStyle(G.link).accessibilityHidden(true)
            Text(text).font(.gente(.body))
        }
    }
    func bullet(_ text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(G.primary).frame(width: 6, height: 6).padding(.top, 8).accessibilityHidden(true)
            Text(text).font(.gente(.subheadline))
        }
    }
}
