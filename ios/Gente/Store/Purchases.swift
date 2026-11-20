// Copyright 2026 DeskHead Inc.
// In-app purchase with StoreKit 2 (App Review Guideline 3.1.1). Plans mirror Gente Cloud:
// Pro (month or year), Max, Max Plus as auto-renewing subscriptions in one group, and 8-hour packs
// as a consumable. Every transaction is sent to Gente Cloud, which checks it with the App Store
// Server API before granting hours.
import Foundation
import Observation
import StoreKit

enum ProductID {
    // Same ids as Gente Cloud's STORE_PRODUCTS (src/config.ts) and the Android app.
    static let proMonth = "gente_pro_month"
    static let proYear = "gente_pro_year"
    static let maxMonth = "gente_max_month"
    static let maxPlusMonth = "gente_max_plus_month"
    static let hours8 = "gente_hours_8"
    static let subscriptions = [proMonth, proYear, maxMonth, maxPlusMonth]
    static let all = subscriptions + [hours8]

    static func plan(_ id: String) -> String? {
        switch id {
        case proMonth, proYear: "pro"
        case maxMonth: "max"
        case maxPlusMonth: "max_plus"
        default: nil
        }
    }
}

@MainActor @Observable
final class Purchases {
    static let shared = Purchases()
    var products: [Product] = []
    var activePlan: String?
    var busy = false
    var message: String?
    private var updates: Task<Void, Never>?

    func start() {
        guard updates == nil else { return }
        updates = Task {
            for await result in Transaction.updates { await handle(result) }
        }
        Task { await load(); await refresh(); await checkStorefront() }
    }

    func load() async {
        products = ((try? await Product.products(for: ProductID.all)) ?? []).sorted { $0.price < $1.price }
    }

    func product(_ id: String) -> Product? { products.first { $0.id == id } }

    /// The US storefront may also link to web checkout (Guideline 3.1.1(a), US only).
    var webCheckoutAllowed = false
    func checkStorefront() async {
        guard let country = (await Storefront.current)?.countryCode else { return }
        let plans = try? await CloudAPI.shared.storePlans(storefront: country)
        webCheckoutAllowed = plans?.webCheckoutLinkOut?.allowed == true
    }

    func buy(_ p: Product) async {
        busy = true; message = nil
        defer { busy = false }
        do {
            var opts: Set<Product.PurchaseOption> = []
            if let fresh = try? await CloudAPI.shared.appleAccountToken() { AccountToken.current = fresh }
            if let token = AccountToken.current { opts.insert(.appAccountToken(token)) }
            switch try await p.purchase(options: opts) {
            case .success(let r): await handle(r)
            case .userCancelled: break
            case .pending: message = String(localized: "Waiting for approval. We'll add it when it's approved.")
            @unknown default: break
            }
        } catch {
            message = String(localized: "The purchase didn't go through. You weren't charged.")
        }
    }

    func restore() async {
        busy = true; defer { busy = false }
        try? await AppStore.sync()
        await refresh()
        message = activePlan == nil ? String(localized: "No purchases to restore on this Apple Account.") : String(localized: "Restored.")
    }

    func refresh() async {
        var plan: String?
        for await r in Transaction.currentEntitlements {
            if case .verified(let t) = r, t.revocationDate == nil, let p = ProductID.plan(t.productID) { plan = p }
        }
        activePlan = plan
    }

    private func handle(_ r: VerificationResult<Transaction>) async {
        guard case .verified(let t) = r else { message = String(localized: "Apple couldn't verify that purchase."); return }
        // Server check first, then finish. If the server is unreachable we keep it unfinished and
        // StoreKit will hand it to us again on the next launch.
        do {
            try await CloudAPI.shared.verifyAppStore(signedTransaction: r.jwsRepresentation)
            await t.finish()
        } catch {
            message = String(localized: "Purchase received. Hours will appear as soon as Gente Cloud confirms it.")
        }
        await refresh()
    }
}

/// The appAccountToken ties an App Store purchase to the Gente account without sharing an email.
enum AccountToken {
    static var current: UUID? {
        get { UserDefaults.standard.string(forKey: "appAccountToken").flatMap(UUID.init(uuidString:)) }
        set { UserDefaults.standard.set(newValue?.uuidString, forKey: "appAccountToken") }
    }
}
