import WidgetKit
import SwiftUI
import EventKit

// MARK: - Entry
struct UpcomingEventsEntry: TimelineEntry {
    let date: Date
    let dayGroups: [DayGroup]
}

struct DayGroup: Identifiable {
    let id: String
    let label: String
    let events: [EventItem]
}

// MARK: - Provider
struct UpcomingEventsProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> UpcomingEventsEntry {
        UpcomingEventsEntry(date: Date(), dayGroups: [
            DayGroup(id: "today", label: "今日", events: [
                EventItem(id: "1", title: "ミーティング", startDate: Date(), endDate: Date().addingTimeInterval(3600), colorHex: "#007AFF", isAllDay: false),
            ]),
            DayGroup(id: "tomorrow", label: "明日", events: [
                EventItem(id: "2", title: "ランチ", startDate: Date().addingTimeInterval(86400), endDate: Date().addingTimeInterval(90000), colorHex: "#FF3B30", isAllDay: false),
            ]),
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (UpcomingEventsEntry) -> Void) {
        let days = context.family == .systemLarge ? 7 : 3
        let entry = makeEntry(days: days)
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingEventsEntry>) -> Void) {
        let days = context.family == .systemLarge ? 7 : 3
        let entry = makeEntry(days: days)

        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func makeEntry(days: Int) -> UpcomingEventsEntry {
        let groups = fetchUpcomingEvents(days: days)
        return UpcomingEventsEntry(date: Date(), dayGroups: groups)
    }

    private func fetchUpcomingEvents(days: Int) -> [DayGroup] {
        let status = EKEventStore.authorizationStatus(for: .event)
        var hasAccess = status == .authorized
        if #available(iOSApplicationExtension 17.0, *) {
            hasAccess = hasAccess || status == .fullAccess
        }
        guard hasAccess else { return [] }

        let cal = Calendar.current
        let now = Date()
        let startOfToday = cal.startOfDay(for: now)
        guard let endDate = cal.date(byAdding: .day, value: days, to: startOfToday) else { return [] }

        let predicate = eventStore.predicateForEvents(withStart: startOfToday, end: endDate, calendars: nil)
        let ekEvents = eventStore.events(matching: predicate).sorted { $0.startDate < $1.startDate }

        var groups: [DayGroup] = []
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")

        for dayOffset in 0..<days {
            guard let dayStart = cal.date(byAdding: .day, value: dayOffset, to: startOfToday),
                  let dayEnd = cal.date(byAdding: .day, value: 1, to: dayStart) else { continue }

            let dayEvents = ekEvents.filter { event in
                event.startDate < dayEnd && event.endDate > dayStart
            }

            if dayEvents.isEmpty { continue }

            let label: String
            if dayOffset == 0 {
                label = "今日"
            } else if dayOffset == 1 {
                label = "明日"
            } else {
                formatter.dateFormat = "M/d (E)"
                label = formatter.string(from: dayStart)
            }

            let items = dayEvents.prefix(5).map { event in
                EventItem(
                    id: event.eventIdentifier ?? UUID().uuidString,
                    title: event.title ?? "(タイトルなし)",
                    startDate: event.startDate,
                    endDate: event.endDate,
                    colorHex: event.calendar.cgColor.flatMap { UIColor(cgColor: $0).toHex() } ?? "#007AFF",
                    isAllDay: event.isAllDay
                )
            }

            groups.append(DayGroup(id: "day_\(dayOffset)", label: label, events: items))
        }

        return groups
    }
}

// MARK: - Views
struct UpcomingEventsWidgetView: View {
    let entry: UpcomingEventsEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                Text("今後の予定")
                    .font(.system(size: 13, weight: .bold))
                Spacer()
                Text(daysLabel)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            if entry.dayGroups.isEmpty {
                Spacer()
                Text("予定なし")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                let maxGroups = family == .systemLarge ? entry.dayGroups.count : min(entry.dayGroups.count, 2)
                ForEach(entry.dayGroups.prefix(maxGroups)) { group in
                    dayGroupView(group)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(12)
    }

    private var daysLabel: String {
        family == .systemLarge ? "7日間" : "3日間"
    }

    @ViewBuilder
    private func dayGroupView(_ group: DayGroup) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(group.label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.blue)

            let maxEvents = family == .systemLarge ? 3 : 2
            ForEach(group.events.prefix(maxEvents)) { event in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color(hex: event.colorHex))
                        .frame(width: 3, height: 22)

                    VStack(alignment: .leading, spacing: 0) {
                        Text(event.title)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                        Text(event.isAllDay ? "終日" : formatTime(event.startDate))
                            .font(.system(size: 9))
                            .foregroundColor(.secondary)
                    }
                }
            }

            if group.events.count > maxEvents {
                Text("他 \(group.events.count - maxEvents)件")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                    .padding(.leading, 8)
            }
        }
    }

    private var maxEvents: Int {
        family == .systemLarge ? 3 : 2
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Widget
struct UpcomingEventsWidget: Widget {
    let kind: String = "UpcomingEventsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpcomingEventsProvider()) { entry in
            if #available(iOS 17.0, *) {
                UpcomingEventsWidgetView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                UpcomingEventsWidgetView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("今後の予定")
        .description("複数日にわたる予定を表示します")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
