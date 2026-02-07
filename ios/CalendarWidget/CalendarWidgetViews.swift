import SwiftUI
import WidgetKit

// MARK: - Small Widget
struct SmallWidgetView: View {
    let entry: CalendarEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Date header
            HStack {
                Text(dayString)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.blue)
                VStack(alignment: .leading, spacing: 0) {
                    Text(monthString)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                    Text(weekdayString)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary)
                }
                Spacer()
            }

            // Events (max 3)
            if entry.events.isEmpty {
                Text("予定なし")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ForEach(entry.events.prefix(3)) { event in
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Color(hex: event.colorHex))
                            .frame(width: 3, height: 20)

                        VStack(alignment: .leading, spacing: 0) {
                            Text(event.title)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                            Text(event.isAllDay ? "終日" : formatTime(event.startDate))
                                .font(.system(size: 9))
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(12)
    }

    private var dayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: entry.date)
    }

    private var monthString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M月"
        return formatter.string(from: entry.date)
    }

    private var weekdayString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "EEEE"
        return formatter.string(from: entry.date)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Medium Widget
struct MediumWidgetView: View {
    let entry: CalendarEntry

    var body: some View {
        HStack(spacing: 12) {
            // Left: date display
            VStack(spacing: 2) {
                Text(monthString)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.secondary)
                Text(dayString)
                    .font(.system(size: 40, weight: .bold))
                    .foregroundColor(.blue)
                Text(weekdayString)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
            }
            .frame(width: 70)

            // Divider
            Rectangle()
                .fill(Color.secondary.opacity(0.2))
                .frame(width: 1)
                .padding(.vertical, 8)

            // Right: events list (max 4)
            VStack(alignment: .leading, spacing: 4) {
                if entry.events.isEmpty {
                    Spacer()
                    Text("予定なし")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                    Spacer()
                } else {
                    ForEach(entry.events.prefix(4)) { event in
                        HStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color(hex: event.colorHex))
                                .frame(width: 4, height: 28)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(event.title)
                                    .font(.system(size: 13, weight: .medium))
                                    .lineLimit(1)
                                Text(event.isAllDay ? "終日" : "\(formatTime(event.startDate)) - \(formatTime(event.endDate))")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                            }

                            Spacer(minLength: 0)
                        }
                    }

                    if entry.events.count > 4 {
                        Text("他 \(entry.events.count - 4)件")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                }

                Spacer(minLength: 0)
            }
        }
        .padding(12)
    }

    private var dayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: entry.date)
    }

    private var monthString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M月"
        return formatter.string(from: entry.date)
    }

    private var weekdayString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "EEEE"
        return formatter.string(from: entry.date)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Widget Entry View
struct CalendarWidgetEntryView: View {
    var entry: CalendarEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}
