import WidgetKit
import SwiftUI
import EventKit

// MARK: - Entry
struct MonthCalendarEntry: TimelineEntry {
    let date: Date
    let eventDates: Set<Int> // days of month that have events
    let year: Int
    let month: Int
}

// MARK: - Provider
struct MonthCalendarProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> MonthCalendarEntry {
        let cal = Calendar.current
        let now = Date()
        return MonthCalendarEntry(
            date: now,
            eventDates: [3, 7, 12, 18, 25],
            year: cal.component(.year, from: now),
            month: cal.component(.month, from: now)
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (MonthCalendarEntry) -> Void) {
        completion(makeEntry(for: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MonthCalendarEntry>) -> Void) {
        let now = Date()
        let entry = makeEntry(for: now)

        // Update at midnight
        let cal = Calendar.current
        let tomorrow = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: now)!)
        let timeline = Timeline(entries: [entry], policy: .after(tomorrow))
        completion(timeline)
    }

    private func makeEntry(for date: Date) -> MonthCalendarEntry {
        let cal = Calendar.current
        let year = cal.component(.year, from: date)
        let month = cal.component(.month, from: date)
        let eventDays = fetchEventDays(year: year, month: month)
        return MonthCalendarEntry(date: date, eventDates: eventDays, year: year, month: month)
    }

    private func fetchEventDays(year: Int, month: Int) -> Set<Int> {
        let status = EKEventStore.authorizationStatus(for: .event)
        var hasAccess = status == .authorized
        if #available(iOSApplicationExtension 17.0, *) {
            hasAccess = hasAccess || status == .fullAccess
        }
        guard hasAccess else { return [] }

        let cal = Calendar.current
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = 1
        guard let startOfMonth = cal.date(from: comps) else { return [] }
        guard let range = cal.range(of: .day, in: .month, for: startOfMonth) else { return [] }
        guard let endOfMonth = cal.date(byAdding: .day, value: range.count, to: startOfMonth) else { return [] }

        let predicate = eventStore.predicateForEvents(withStart: startOfMonth, end: endOfMonth, calendars: nil)
        let events = eventStore.events(matching: predicate)

        var days = Set<Int>()
        for event in events {
            let day = cal.component(.day, from: event.startDate)
            days.insert(day)
        }
        return days
    }
}

// MARK: - View
struct MonthCalendarWidgetView: View {
    let entry: MonthCalendarEntry

    private let weekdaySymbols = ["日", "月", "火", "水", "木", "金", "土"]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var body: some View {
        VStack(spacing: 4) {
            // Month header
            Text(headerText)
                .font(.system(size: 14, weight: .bold))
                .frame(maxWidth: .infinity, alignment: .leading)

            // Weekday row
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(weekdaySymbols[i])
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(weekdayColor(i))
                        .frame(maxWidth: .infinity)
                }
            }

            // Calendar grid
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(calendarDays, id: \.id) { day in
                    dayCellView(day)
                }
            }
        }
        .padding(12)
    }

    private var headerText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "yyyy年M月"
        return formatter.string(from: entry.date)
    }

    private func weekdayColor(_ index: Int) -> Color {
        switch index {
        case 0: return .red
        case 6: return .blue
        default: return .secondary
        }
    }

    private var calendarDays: [CalendarDay] {
        let cal = Calendar.current
        var comps = DateComponents()
        comps.year = entry.year
        comps.month = entry.month
        comps.day = 1
        guard let firstOfMonth = cal.date(from: comps) else { return [] }

        // Sunday = 1 in Calendar
        let firstWeekday = cal.component(.weekday, from: firstOfMonth)
        let offset = firstWeekday - 1 // 0-indexed Sunday start

        guard let daysInMonth = cal.range(of: .day, in: .month, for: firstOfMonth)?.count else { return [] }

        let today = cal.component(.day, from: Date())
        let isCurrentMonth = cal.component(.month, from: Date()) == entry.month
            && cal.component(.year, from: Date()) == entry.year

        var result: [CalendarDay] = []

        // Blank cells before first day
        for i in 0..<offset {
            result.append(CalendarDay(id: "blank_\(i)", day: 0, isToday: false, hasEvent: false, weekdayIndex: i))
        }

        // Actual days
        for d in 1...daysInMonth {
            let wdIndex = (offset + d - 1) % 7
            result.append(CalendarDay(
                id: "day_\(d)",
                day: d,
                isToday: isCurrentMonth && d == today,
                hasEvent: entry.eventDates.contains(d),
                weekdayIndex: wdIndex
            ))
        }

        return result
    }

    @ViewBuilder
    private func dayCellView(_ day: CalendarDay) -> some View {
        if day.day == 0 {
            Color.clear
                .frame(height: 24)
        } else {
            VStack(spacing: 1) {
                ZStack {
                    if day.isToday {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 20, height: 20)
                    }

                    Text("\(day.day)")
                        .font(.system(size: 11, weight: day.isToday ? .bold : .regular))
                        .foregroundColor(day.isToday ? .white : dayTextColor(day.weekdayIndex))
                }
                .frame(height: 20)

                // Event dot
                Circle()
                    .fill(day.hasEvent ? Color.blue.opacity(0.8) : Color.clear)
                    .frame(width: 4, height: 4)
            }
            .frame(height: 26)
        }
    }

    private func dayTextColor(_ weekdayIndex: Int) -> Color {
        switch weekdayIndex {
        case 0: return .red
        case 6: return .blue
        default: return .primary
        }
    }
}

struct CalendarDay {
    let id: String
    let day: Int
    let isToday: Bool
    let hasEvent: Bool
    let weekdayIndex: Int
}

// MARK: - Widget
struct MonthCalendarWidget: Widget {
    let kind: String = "MonthCalendarWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MonthCalendarProvider()) { entry in
            if #available(iOS 17.0, *) {
                MonthCalendarWidgetView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                MonthCalendarWidgetView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("月間カレンダー")
        .description("月のカレンダーを表示します")
        .supportedFamilies([.systemLarge])
    }
}
