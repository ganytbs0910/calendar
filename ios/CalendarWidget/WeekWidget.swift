import WidgetKit
import SwiftUI
import EventKit

// 今週7日間を横並びで見せるウィジェット（リストや月グリッドとは別の見せ方）。
struct WeekEntry: TimelineEntry {
    let date: Date
    let days: [WeekDayColumn]
}

struct WeekDayColumn: Identifiable {
    let id = UUID()
    let date: Date
    let isToday: Bool
    let events: [EventItem]
}

struct WeekProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> WeekEntry {
        WeekEntry(date: Date(), days: makeDays(access: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (WeekEntry) -> Void) {
        completion(WeekEntry(date: Date(), days: makeDays(access: hasAccess())))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WeekEntry>) -> Void) {
        let entry = WeekEntry(date: Date(), days: makeDays(access: hasAccess()))
        let cal = Calendar.current
        let nextUpdate = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: Date())!)
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }

    private func hasAccess() -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        var ok = status == .authorized
        if #available(iOSApplicationExtension 17.0, *) { ok = ok || status == .fullAccess }
        return ok
    }

    private func makeDays(access: Bool) -> [WeekDayColumn] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let weekday = cal.component(.weekday, from: today) // 1 = Sunday
        let start = cal.date(byAdding: .day, value: -(weekday - 1), to: today)!
        var columns: [WeekDayColumn] = []
        let all: [EKEvent]
        if access {
            let end = cal.date(byAdding: .day, value: 7, to: start)!
            all = eventStore.events(matching: eventStore.predicateForEvents(withStart: start, end: end, calendars: nil))
        } else {
            all = []
        }
        for i in 0..<7 {
            let dStart = cal.date(byAdding: .day, value: i, to: start)!
            let dEnd = cal.date(byAdding: .day, value: 1, to: dStart)!
            let evs = all
                .filter { $0.startDate < dEnd && $0.endDate > dStart && !$0.isAllDay }
                .sorted { $0.startDate < $1.startDate }
                .prefix(6)
                .map {
                    EventItem(
                        id: $0.eventIdentifier ?? UUID().uuidString,
                        title: $0.title ?? "",
                        startDate: $0.startDate,
                        endDate: $0.endDate,
                        colorHex: $0.calendar.cgColor.flatMap { UIColor(cgColor: $0).toHex() } ?? "#007AFF",
                        isAllDay: false
                    )
                }
            columns.append(WeekDayColumn(date: dStart, isToday: cal.isDate(dStart, inSameDayAs: today), events: Array(evs)))
        }
        return columns
    }
}

struct WeekWidgetEntryView: View {
    var entry: WeekEntry
    @Environment(\.widgetFamily) var family
    private let wd = ["日", "月", "火", "水", "木", "金", "土"]

    var body: some View {
        let isLarge = family == .systemLarge
        let maxItems = isLarge ? 6 : 3
        HStack(spacing: 4) {
            ForEach(entry.days) { day in
                VStack(spacing: 3) {
                    Text(wd[Calendar.current.component(.weekday, from: day.date) - 1])
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(weekdayColor(day.date))
                    Text(dayNum(day.date))
                        .font(.system(size: 13, weight: day.isToday ? .bold : .regular))
                        .foregroundColor(day.isToday ? .white : .primary)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(day.isToday ? Color.blue : Color.clear))
                    VStack(spacing: 2) {
                        ForEach(Array(day.events.prefix(maxItems))) { e in
                            if isLarge {
                                Text(e.title)
                                    .font(.system(size: 7))
                                    .lineLimit(1)
                                    .padding(.horizontal, 2).padding(.vertical, 1)
                                    .frame(maxWidth: .infinity)
                                    .background(RoundedRectangle(cornerRadius: 2).fill(Color(hex: e.colorHex).opacity(0.25)))
                            } else {
                                Circle().fill(Color(hex: e.colorHex)).frame(width: 5, height: 5)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(10)
    }

    private func weekdayColor(_ d: Date) -> Color {
        let w = Calendar.current.component(.weekday, from: d)
        if w == 1 { return .red }
        if w == 7 { return .blue }
        return .secondary
    }

    private func dayNum(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "d"; return f.string(from: d)
    }
}

struct WeekWidget: Widget {
    let kind = "WeekWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WeekProvider()) { entry in
            if #available(iOS 17.0, *) {
                WeekWidgetEntryView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
            } else {
                WeekWidgetEntryView(entry: entry).padding().background()
            }
        }
        .configurationDisplayName("今週の予定")
        .description("今週7日間の予定を横並びで表示します")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
