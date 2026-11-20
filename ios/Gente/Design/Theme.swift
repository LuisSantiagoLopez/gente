// Copyright 2026 DeskHead Inc.
// Gente's flat warm look. Values mirror packages/ui-tokens/src/tokens.css (desktop).
import SwiftUI
import UIKit

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
    /// A color that follows light and dark mode.
    static func gente(light: UInt32, dark: UInt32, lightAlpha: Double = 1, darkAlpha: Double = 1) -> Color {
        Color(UIColor { trait in
            let (hex, a) = trait.userInterfaceStyle == .dark ? (dark, darkAlpha) : (light, lightAlpha)
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
                           green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255,
                           alpha: a)
        })
    }
}

enum G {
    // Surfaces
    static let background = Color.gente(light: 0xFBF6EC, dark: 0x14110D)
    static let card = Color.gente(light: 0xF4ECDD, dark: 0x231E17)
    static let dialog = Color.gente(light: 0xFFFFFF, dark: 0x1C1813)
    static let foreground = Color.gente(light: 0x1C1710, dark: 0xF7F0E4)
    static let muted = Color.gente(light: 0x1C1710, dark: 0xF7F0E4, lightAlpha: 0.68, darkAlpha: 0.66)
    static let faint = Color.gente(light: 0x1C1710, dark: 0xF7F0E4, lightAlpha: 0.63, darkAlpha: 0.54)
    static let border = Color.gente(light: 0x1C1710, dark: 0xF7F0E4, lightAlpha: 0.12, darkAlpha: 0.10)
    // Marigold
    static let primary = Color.gente(light: 0xE8951A, dark: 0xF5A524)
    static let onPrimary = Color.gente(light: 0x1C1206, dark: 0x1A1206)
    /// Marigold for text and small marks; passes 4.5:1 on the light background.
    static let link = Color.gente(light: 0x94530A, dark: 0xF7B955)
    static let userBubble = Color.gente(light: 0x1C1710, dark: 0x3A2D18)
    static let onUserBubble = Color.gente(light: 0xFFFFFF, dark: 0xF7F0E4)
    static let success = Color.gente(light: 0x00783F, dark: 0x3DBE7A)
    static let warning = Color.gente(light: 0x935500, dark: 0xE28600)
    static let destructive = Color.gente(light: 0xC32A1F, dark: 0xFF6B5E)

    static let radius: CGFloat = 12
    static let bigRadius: CGFloat = 22

    /// One spring for everything, so motion feels like one hand.
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let snappy = Animation.spring(response: 0.28, dampingFraction: 0.86)
}

extension Font {
    /// Rounded type that scales with Dynamic Type.
    static func gente(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        .system(style, design: .rounded, weight: weight)
    }
}

struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(G.card, in: RoundedRectangle(cornerRadius: G.radius, style: .continuous))
    }
}

extension View {
    func genteCard() -> some View { modifier(CardBackground()) }
}

/// A gentle press that shrinks a little, with a soft tap.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(G.snappy, value: configuration.isPressed)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.gente(.headline, weight: .semibold))
            .foregroundStyle(G.onPrimary)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(G.primary, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(G.snappy, value: configuration.isPressed)
    }
}
