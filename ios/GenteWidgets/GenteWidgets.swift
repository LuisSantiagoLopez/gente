// Copyright 2026 DeskHead Inc.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct GenteWidgetBundle: WidgetBundle {
    var body: some Widget {
        AskWidget()
        GenteLiveActivity()
    }
}

struct AskEntry: TimelineEntry { let date: Date }

struct AskProvider: TimelineProvider {
    func placeholder(in context: Context) -> AskEntry { AskEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (AskEntry) -> Void) { completion(AskEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AskEntry>) -> Void) {
        completion(Timeline(entries: [AskEntry(date: .now)], policy: .never))
    }
}

/// "Ask Gente" on the Home Screen and Lock Screen. It holds no chat content.
struct AskWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ask", provider: AskProvider()) { _ in
            AskWidgetView().containerBackground(G.background, for: .widget).widgetURL(URL(string: "gente://new"))
        }
        .configurationDisplayName("Ask Gente")
        .description("Start a private chat in one tap.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

struct AskWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var body: some View {
        switch family {
        case .accessoryCircular:
            GenteMark(size: 30, ink: .primary)
        case .accessoryRectangular:
            HStack { GenteMark(size: 22, ink: .primary); Text("Ask Gente").font(.gente(.headline)) }
        default:
            VStack(alignment: .leading) {
                GenteMark(size: 34)
                Spacer()
                Text("Ask Gente").font(.gente(.headline, weight: .bold)).foregroundStyle(G.foreground)
                Text("Private. On your iPhone.").font(.gente(.caption)).foregroundStyle(G.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct GenteLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GenteActivityAttributes.self) { ctx in
            HStack(spacing: 12) {
                GenteMark(size: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(ctx.attributes.title).font(.gente(.headline, weight: .semibold))
                    Text(ctx.state.status).font(.gente(.subheadline)).foregroundStyle(.secondary)
                }
                Spacer()
                Text(ctx.state.startedAt, style: .timer).font(.gente(.footnote)).monospacedDigit().frame(width: 56)
            }
            .padding(16)
            .activityBackgroundTint(G.background)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { GenteMark(size: 26, ink: .white) }
                DynamicIslandExpandedRegion(.trailing) { Text(ctx.state.startedAt, style: .timer).monospacedDigit().frame(width: 50) }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading) {
                        Text(ctx.attributes.title).font(.gente(.headline))
                        Text(ctx.state.status).font(.gente(.subheadline)).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: { GenteMark(size: 18, ink: .white) }
              compactTrailing: { Text(ctx.state.startedAt, style: .timer).monospacedDigit().frame(width: 40) }
              minimal: { GenteMark(size: 16, ink: .white) }
        }
    }
}
