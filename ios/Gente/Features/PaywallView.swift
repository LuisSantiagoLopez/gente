// Copyright 2026 DeskHead Inc.
import StoreKit
import SwiftUI

struct PaywallView: View {
    @Environment(Purchases.self) private var purchases
    @State private var yearly = false
    @State private var selected = ProductID.proMonth

    struct Tier: Identifiable { var id: String; var name: String; var hours: Int; var blurb: LocalizedStringKey }
    let tiers: [Tier] = [
        .init(id: "pro", name: "Pro", hours: 37, blurb: "Fast mode, web search, voice and cloud browsers."),
        .init(id: "max", name: "Max", hours: 215, blurb: "For people who hand Gente real work every day."),
        .init(id: "max_plus", name: "Max Plus", hours: 430, blurb: "The most hours, for long tasks and teams of agents."),
    ]

    func productID(_ tier: String) -> String {
        switch tier {
        case "pro": yearly ? ProductID.proYear : ProductID.proMonth
        case "max": ProductID.maxMonth
        default: ProductID.maxPlusMonth
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                GenteMark(size: 56, breathing: true).padding(.top, 12)
                Text("Get more done with Gente").font(.gente(.title, weight: .bold)).multilineTextAlignment(.center)
                Text("Your chats stay on your iPhone on every plan.").font(.gente(.body)).foregroundStyle(G.muted)

                Picker("", selection: $yearly) {
                    Text("Monthly").tag(false)
                    Text("Yearly").tag(true)
                }
                .pickerStyle(.segmented)
                .onChange(of: yearly) { _, _ in if selected.hasPrefix("com.deskhead.gente.pro") { selected = productID("pro") } }

                ForEach(tiers.filter { !yearly || $0.id == "pro" }) { t in
                    let pid = productID(t.id)
                    let p = purchases.product(pid)
                    Button { withAnimation(G.snappy) { selected = pid } } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(t.name).font(.gente(.title3, weight: .bold))
                                Spacer()
                                Text(p.map { "\($0.displayPrice)\(yearly ? String(localized: " / year") : String(localized: " / month"))" } ?? " ")
                                    .font(.gente(.headline))
                            }
                            Text("\(t.hours) online hours a month").font(.gente(.subheadline, weight: .medium)).foregroundStyle(G.link)
                            Text(t.blurb).font(.gente(.subheadline)).foregroundStyle(G.muted)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .genteCard()
                        .overlay(RoundedRectangle(cornerRadius: G.radius, style: .continuous)
                            .stroke(selected == pid ? G.primary : .clear, lineWidth: 2))
                    }
                    .buttonStyle(PressableStyle())
                    .foregroundStyle(G.foreground)
                    .accessibilityAddTraits(selected == pid ? .isSelected : [])
                    .accessibilityIdentifier("paywall.\(t.id)")
                }

                Button {
                    if let p = purchases.product(selected) { Task { await purchases.buy(p) } }
                } label: {
                    if purchases.busy { ProgressView().tint(G.onPrimary) } else { Text("Subscribe") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(purchases.product(selected) == nil || purchases.busy)
                .accessibilityIdentifier("paywall.subscribe")

                if let h = purchases.product(ProductID.hours8) {
                    Button { Task { await purchases.buy(h) } } label: {
                        Text("Add 8 hours for \(h.displayPrice)").font(.gente(.body, weight: .semibold))
                    }
                    .foregroundStyle(G.link)
                    .accessibilityIdentifier("paywall.hours")
                }

                if purchases.webCheckoutAllowed {
                    Button {
                        Task {
                            let plan = selected == ProductID.maxMonth ? "max" : selected == ProductID.maxPlusMonth ? "max_plus" : "pro"
                            if let u = try? await CloudAPI.shared.checkoutURL(plan: plan, interval: selected == ProductID.proYear ? "year" : "month") {
                                await UIApplication.shared.open(u)
                            }
                        }
                    } label: { Label("Or pay on the web", systemImage: "arrow.up.right.square") }
                    .font(.gente(.footnote, weight: .medium)).foregroundStyle(G.muted)
                    .accessibilityIdentifier("paywall.web")
                }

                if let m = purchases.message {
                    Text(m).font(.gente(.footnote)).foregroundStyle(G.muted).multilineTextAlignment(.center)
                }

                Text("Subscriptions renew automatically until you cancel in your Apple Account settings, at least 24 hours before the period ends. Payment is charged to your Apple Account. Free users can use Gente from their own computer at no cost.")
                    .font(.gente(.caption)).foregroundStyle(G.faint).multilineTextAlignment(.center)
                HStack(spacing: 18) {
                    Button("Restore purchases") { Task { await purchases.restore() } }.accessibilityIdentifier("paywall.restore")
                    Link("Terms", destination: Config.terms)
                    Link("Privacy", destination: Config.privacyPolicy)
                }
                .font(.gente(.footnote, weight: .medium)).foregroundStyle(G.link)
            }
            .padding(20)
        }
        .background(G.background)
        .navigationTitle("Plans")
        .navigationBarTitleDisplayMode(.inline)
        .task { if purchases.products.isEmpty { await purchases.load() } }
        .manageSubscriptionsSheet(isPresented: .constant(false))
    }
}
