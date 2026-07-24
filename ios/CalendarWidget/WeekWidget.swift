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
    private let wd = widgetWeekdaySymbols

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
        .configurationDisplayName(wloc("今週の予定", "This week"))
        .description(wloc("今週7日間の予定を横並びで表示します", "Shows this week's 7 days side by side"))
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - 2週間ウィジェット（ホーム画面のように予定をびっしり）
// 今週の日曜から14日間を 7列×2段のグリッドで表示し、各日に予定タイトルをチップで並べる。
struct TwoWeekEntry: TimelineEntry {
    let date: Date
    let days: [WeekDayColumn] // 14個（2週間分）
}

struct TwoWeekProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> TwoWeekEntry {
        TwoWeekEntry(date: Date(), days: makeDays(access: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (TwoWeekEntry) -> Void) {
        completion(TwoWeekEntry(date: Date(), days: makeDays(access: hasAccess())))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TwoWeekEntry>) -> Void) {
        let entry = TwoWeekEntry(date: Date(), days: makeDays(access: hasAccess()))
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
            let end = cal.date(byAdding: .day, value: 14, to: start)!
            all = eventStore.events(matching: eventStore.predicateForEvents(withStart: start, end: end, calendars: nil))
        } else {
            all = []
        }
        for i in 0..<14 {
            let dStart = cal.date(byAdding: .day, value: i, to: start)!
            let dEnd = cal.date(byAdding: .day, value: 1, to: dStart)!
            let evs = all
                .filter { $0.startDate < dEnd && $0.endDate > dStart }
                .sorted { ($0.isAllDay ? 0 : 1, $0.startDate) < ($1.isAllDay ? 0 : 1, $1.startDate) }
                .prefix(4)
                .map {
                    EventItem(
                        id: $0.eventIdentifier ?? UUID().uuidString,
                        title: $0.title ?? "",
                        startDate: $0.startDate,
                        endDate: $0.endDate,
                        colorHex: $0.calendar.cgColor.flatMap { UIColor(cgColor: $0).toHex() } ?? "#007AFF",
                        isAllDay: $0.isAllDay
                    )
                }
            columns.append(WeekDayColumn(date: dStart, isToday: cal.isDate(dStart, inSameDayAs: today), events: Array(evs)))
        }
        return columns
    }
}

struct TwoWeekWidgetEntryView: View {
    var entry: TwoWeekEntry
    private let wd = widgetWeekdaySymbols

    var body: some View {
        VStack(spacing: 5) {
            // ヘッダー：期間表示
            HStack {
                Text(rangeText)
                    .font(.system(size: 13, weight: .bold))
                Spacer()
                Text(wloc("2週間", "2 weeks"))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.secondary)
            }
            // 曜日見出し（2週とも同じ列に揃う）
            HStack(spacing: 3) {
                ForEach(0..<7, id: \.self) { i in
                    Text(wd[i])
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(headerColor(i))
                        .frame(maxWidth: .infinity)
                }
            }
            // 2段の週グリッド
            ForEach(0..<2, id: \.self) { row in
                HStack(spacing: 3) {
                    ForEach(Array(entry.days[(row * 7)..<(row * 7 + 7)])) { day in
                        dayCell(day)
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
        .padding(12)
    }

    @ViewBuilder
    private func dayCell(_ day: WeekDayColumn) -> some View {
        VStack(spacing: 2) {
            Text(dayNum(day.date))
                .font(.system(size: 12, weight: day.isToday ? .bold : .regular))
                .foregroundColor(day.isToday ? .white : numberColor(day.date))
                .frame(width: 19, height: 19)
                .background(Circle().fill(day.isToday ? Color.blue : Color.clear))
            VStack(spacing: 2) {
                ForEach(day.events.prefix(3)) { e in
                    Text(e.title)
                        .font(.system(size: 7.5))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundColor(.primary)
                        .padding(.horizontal, 2).padding(.vertical, 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 3).fill(Color(hex: e.colorHex).opacity(0.28)))
                }
                if day.events.count > 3 {
                    Text("+\(day.events.count - 3)")
                        .font(.system(size: 7, weight: .semibold))
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(day.isToday ? Color.blue.opacity(0.08) : Color.clear)
        )
    }

    private var rangeText: String {
        guard let first = entry.days.first?.date, let last = entry.days.last?.date else { return "" }
        let f = DateFormatter(); f.locale = widgetLocale; f.dateFormat = "M/d"
        return "\(f.string(from: first)) 〜 \(f.string(from: last))"
    }

    private func headerColor(_ i: Int) -> Color {
        if i == 0 { return .red }
        if i == 6 { return .blue }
        return .secondary
    }

    private func numberColor(_ d: Date) -> Color {
        let w = Calendar.current.component(.weekday, from: d)
        if w == 1 { return .red }
        if w == 7 { return .blue }
        return .primary
    }

    private func dayNum(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "d"; return f.string(from: d)
    }
}

struct TwoWeekWidget: Widget {
    let kind = "TwoWeekWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TwoWeekProvider()) { entry in
            if #available(iOS 17.0, *) {
                TwoWeekWidgetEntryView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
            } else {
                TwoWeekWidgetEntryView(entry: entry).padding().background()
            }
        }
        .configurationDisplayName(wloc("2週間の予定", "Two weeks"))
        .description(wloc("今週から2週間分の予定をカレンダーのように一覧表示します", "Shows two weeks at a glance like a calendar"))
        .supportedFamilies([.systemLarge])
    }
}
