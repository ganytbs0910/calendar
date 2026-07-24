import SwiftUI
import UIKit
import Foundation

// MARK: - Widget localization
//
// The widget is a separate process and can't read the app's in-app language
// override, so it follows the *device* language (matching the app's "Auto"
// default): Japanese device → Japanese, everything else → English.
private let widgetIsJa: Bool = (Locale.preferredLanguages.first ?? Locale.current.identifier).hasPrefix("ja")

/// Pick the string for the device language (ja or en fallback).
func wloc(_ ja: String, _ en: String) -> String { widgetIsJa ? ja : en }

/// Locale for date formatters — follows the device.
let widgetLocale: Locale = Locale.autoupdatingCurrent

/// Compact weekday header symbols, localized (Sun-first, index 0 = Sunday).
let widgetWeekdaySymbols: [String] = widgetIsJa
    ? ["日", "月", "火", "水", "木", "金", "土"]
    : ["S", "M", "T", "W", "T", "F", "S"]

// MARK: - Color from Hex
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 122, 255) // Default blue
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - UIColor to Hex
extension UIColor {
    func toHex() -> String {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}
