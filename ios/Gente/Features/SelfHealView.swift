// Copyright 2026 DeskHead Inc.
import SwiftUI

/// "Gente fixed itself": every automatic repair, in plain words.
struct SelfHealView: View {
    @State private var heal = SelfHeal.shared
    var body: some View {
        @Bindable var heal = heal
        List {
            Section {
                Text("When something goes wrong, Gente tries to fix it on its own and writes down what it did here.")
                    .font(.gente(.footnote)).foregroundStyle(G.muted)
            }
            Section {
                if heal.events.isEmpty {
                    Text("Nothing needed fixing yet.").foregroundStyle(G.muted)
                }
                ForEach(heal.events) { e in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: e.outcome == .fixed ? "checkmark.circle.fill" : e.outcome == .needsPerson ? "person.crop.circle.badge.exclamationmark" : "arrow.triangle.2.circlepath")
                            .foregroundStyle(e.outcome == .fixed ? G.success : G.warning)
                            .accessibilityHidden(true)
                        Text(SelfHeal.describe(e)).font(.gente(.subheadline))
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("selfheal.event")
                }
            }
            Section {
                Toggle(isOn: Binding(get: { heal.sendNotes }, set: { heal.sendNotes = $0 })) {
                    Text("Send anonymous repair notes")
                }
                .tint(G.primary)
            } footer: {
                Text("Each note says only what broke, what fixed it, how long it took, the app version and “iOS”. Never your words or your account. It helps fix the same problem for everyone.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Gente fixed itself")
    }
}
