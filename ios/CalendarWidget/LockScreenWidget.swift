import WidgetKit
import SwiftUI
import EventKit

// MARK: - Entry
struct LockScreenEntry: TimelineEntry {
    let date: Date
    let nextEvent: EventItem?
}

// MARK: - Provider
struct LockScreenProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> LockScreenEntry {
        LockScreenEntry(
            date: Date(),
            nextEvent: EventItem(id: "1", title: "ミーティング", startDate: Date().addingTimeInterval(3600), endDate: Date().addingTimeInterval(7200), colorHex: "#007AFF", isAllDay: false)
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (LockScreenEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LockScreenEntry>) -> Void) {
        let entry = makeEntry()

        let cal = Calendar.current
        let now = Date()
        let midnight = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: now)!)

        let nextUpdate: Date
        if let event = entry.nextEvent, event.startDate > now {
            nextUpdate = min(event.startDate, midnight)
        } else {
            nextUpdate = midnight
        }

        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func makeEntry() -> LockScreenEntry {
        let nextEvent = fetchNextEvent()
        return LockScreenEntry(date: Date(), nextEvent: nextEvent)
    }

    private func fetchNextEvent() -> EventItem? {
        let status = EKEventStore.authorizationStatus(for: .event)
        var hasAccess = status == .authorized
        if #available(iOSApplicationExtension 17.0, *) {
            hasAccess = hasAccess || status == .fullAccess
        }
        guard hasAccess else { return nil }

        let cal = Calendar.current
        let now = Date()
        let endOfDay = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: now)!)

        let predicate = eventStore.predicateForEvents(withStart: now, end: endOfDay, calendars: nil)
        let events = eventStore.events(matching: predicate)
            .filter { !$0.isAllDay }
            .sorted { $0.startDate < $1.startDate }

        guard let next = events.first else { return nil }

        return EventItem(
            id: next.eventIdentifier ?? UUID().uuidString,
            title: next.title ?? "(タイトルなし)",
            startDate: next.startDate,
            endDate: next.endDate,
            colorHex: next.calendar.cgColor.flatMap { UIColor(cgColor: $0).toHex() } ?? "#007AFF",
            isAllDay: next.isAllDay
        )
    }
}

// MARK: - Wrapper View (handles availability)
struct LockScreenEntryViewWrapper: View {
    let entry: LockScreenEntry

    var body: some View {
        if #available(iOSApplicationExtension 16.0, *) {
            LockScreenEntryContent(entry: entry)
        } else {
            EmptyView()
        }
    }
}

// MARK: - Entry Content Router
@available(iOSApplicationExtension 16.0, *)
struct LockScreenEntryContent: View {
    let entry: LockScreenEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            LockScreenCircularView(entry: entry)
        case .accessoryRectangular:
            LockScreenRectangularView(entry: entry)
        case .accessoryInline:
            LockScreenInlineView(entry: entry)
        default:
            LockScreenCircularView(entry: entry)
        }
    }
}

// MARK: - Circular View (weekday + date)
@available(iOSApplicationExtension 16.0, *)
struct LockScreenCircularView: View {
    let entry: LockScreenEntry

    var body: some View {
        VStack(spacing: 1) {
            Text(weekdayString)
                .font(.system(size: 10, weight: .semibold))
                .widgetAccentable()
            Text(dayString)
                .font(.system(size: 22, weight: .bold))
        }
    }

    private var weekdayString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "E"
        return formatter.string(from: entry.date)
    }

    private var dayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: entry.date)
    }
}

// MARK: - Rectangular View (date + next event)
@available(iOSApplicationExtension 16.0, *)
struct LockScreenRectangularView: View {
    let entry: LockScreenEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(dateString)
                .font(.system(size: 12, weight: .semibold))
                .widgetAccentable()

            if let event = entry.nextEvent {
                HStack(spacing: 4) {
                    Text(formatTime(event.startDate))
                        .font(.system(size: 12, weight: .medium))
                    Text(event.title)
                        .font(.system(size: 12))
                        .lineLimit(1)
                }
            } else {
                Text("予定なし")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var dateString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M月d日 (E)"
        return formatter.string(from: entry.date)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Inline View
@available(iOSApplicationExtension 16.0, *)
struct LockScreenInlineView: View {
    let entry: LockScreenEntry

    var body: some View {
        if let event = entry.nextEvent {
            Text("\(formatTime(event.startDate)) \(event.title)")
        } else {
            Text("予定なし")
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Widget
struct LockScreenWidget: Widget {
    let kind: String = "LockScreenWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LockScreenProvider()) { entry in
            LockScreenEntryViewWrapper(entry: entry)
        }
        .configurationDisplayName("ロック画面")
        .description("ロック画面に日付と次の予定を表示します")
        .supportedFamilies(lockScreenFamilies)
    }

    private var lockScreenFamilies: [WidgetFamily] {
        if #available(iOSApplicationExtension 16.0, *) {
            return [.accessoryCircular, .accessoryRectangular, .accessoryInline]
        } else {
            return []
        }
    }
}
