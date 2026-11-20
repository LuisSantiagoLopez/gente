// Renders the app icon and launch mark from brand/gente-mark.svg paths. Run: swift make-icons.swift <out-dir>
import AppKit
import CoreGraphics

let accent = "M14.13 3.09 Q14.27 3.92 13.83 4.69 Q13.39 5.45 12.51 6.08 Q11.62 6.70 10.93 6.44 Q10.25 6.18 9.81 5.35 Q9.38 4.52 9.51 3.43 Q9.64 2.34 10.16 1.86 Q10.69 1.37 11.67 1.23 Q12.65 1.08 13.32 1.68 Q13.99 2.27 14.13 3.09 Z"
let src = try! String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
let others = src.components(separatedBy: "d=\"").dropFirst().map { $0.components(separatedBy: "\"")[0] }.filter { $0 != accent }

func path(_ d: String, scale s: CGFloat, dx: CGFloat, dy: CGFloat, h: CGFloat) -> CGPath {
    let t = d.split(separator: " ")
    let p = CGMutablePath(); var i = 0
    func n(_ x: Substring) -> CGFloat { CGFloat(Double(x)!) }
    func pt(_ x: Substring, _ y: Substring) -> CGPoint { CGPoint(x: dx + n(x) * s, y: h - (dy + n(y) * s)) }
    while i < t.count {
        let k = t[i]
        if k.hasPrefix("M") { p.move(to: pt(k.dropFirst(), t[i+1])); i += 2 }
        else if k.hasPrefix("Q") { p.addQuadCurve(to: pt(t[i+2], t[i+3]), control: pt(k.dropFirst(), t[i+1])); i += 4 }
        else if k == "Z" { p.closeSubpath(); i += 1 } else { i += 1 }
    }
    return p
}

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}

func render(_ size: Int, bg: CGColor?, ink: CGColor, mark: CGColor, fraction: CGFloat, to file: String) {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: (bg == nil ? CGImageAlphaInfo.premultipliedLast : CGImageAlphaInfo.noneSkipLast).rawValue)!
    let S = CGFloat(size)
    if let bg { ctx.setFillColor(bg); ctx.fill(CGRect(x: 0, y: 0, width: S, height: S)) }
    let side = S * fraction, s = side / 24, off = (S - side) / 2
    ctx.setFillColor(ink)
    for d in others { ctx.addPath(path(d, scale: s, dx: off, dy: off, h: S)); ctx.fillPath() }
    ctx.setFillColor(mark)
    ctx.addPath(path(accent, scale: s, dx: off, dy: off, h: S)); ctx.fillPath()
    let img = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: img)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: file))
}

let out = CommandLine.arguments[1]
// App icon: light, dark and tinted (iOS 18), 1024 px. Xcode makes every smaller size from these.
render(1024, bg: color(0xFBF6EC), ink: color(0x1C1914), mark: color(0xE8951A), fraction: 0.66, to: "\(out)/AppIcon.appiconset/icon-light.png")
render(1024, bg: nil, ink: color(0xF7F0E4), mark: color(0xF5A524), fraction: 0.66, to: "\(out)/AppIcon.appiconset/icon-dark.png")
render(1024, bg: nil, ink: color(0xFFFFFF, 0.72), mark: color(0xFFFFFF), fraction: 0.66, to: "\(out)/AppIcon.appiconset/icon-tinted.png")
// Launch mark
for (scale, suffix) in [(1, ""), (2, "@2x"), (3, "@3x")] {
    render(96 * scale, bg: nil, ink: color(0x1C1914), mark: color(0xE8951A), fraction: 1, to: "\(out)/LaunchMark.imageset/mark-light\(suffix).png")
    render(96 * scale, bg: nil, ink: color(0xF7F0E4), mark: color(0xF5A524), fraction: 1, to: "\(out)/LaunchMark.imageset/mark-dark\(suffix).png")
}
// Store marketing icon (no alpha) for App Store Connect
render(1024, bg: color(0xFBF6EC), ink: color(0x1C1914), mark: color(0xE8951A), fraction: 0.66, to: CommandLine.arguments[3])
