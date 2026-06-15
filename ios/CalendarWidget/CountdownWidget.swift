import WidgetKit
import SwiftUI
import EventKit

// 次の予定までのカウントダウンに特化したウィジェット。
struct CountdownEntry: TimelineEntry {
    let date: Date
    let next: EventItem?
    let following: EventItem?
}

struct CountdownProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> CountdownEntry {
        CountdownEntry(
            date: Date(),
            next: EventItem(id: "1", title: "チームMTG", startDate: Date().addingTimeInterval(3470), endDate: Date().addingTimeInterval(7070), colorHex: "#007AFF", isAllDay: false),
            following: EventItem(id: "2", title: "ランチ", startDate: Date().addingTimeInterval(10800), endDate: Date().addingTimeInterval(14400), colorHex: "#FF3B30", isAllDay: false)
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (CountdownEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CountdownEntry>) -> Void) {
        let entry = makeEntry()
        let in30 = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        let nextUpdate = [entry.next?.startDate, in30].compactMap { $0 }.min() ?? in30
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }

    private func hasAccess() -> Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        var ok = status == .authorized
        if #available(iOSApplicationExtension 17.0, *) { ok = ok || status == .fullAccess }
        return ok
    }

    private func makeEntry() -> CountdownEntry {
        guard hasAccess() else { return CountdownEntry(date: Date(), next: nil, following: nil) }
        let cal = Calendar.current
        let now = Date()
        let endOfDay = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now))!
        let predicate = eventStore.predicateForEvents(withStart: now, end: endOfDay, calendars: nil)
        let upcoming = eventStore.events(matching: predicate)
            .filter { !$0.isAllDay && $0.startDate > now }
            .sorted { $0.startDate < $1.startDate }
        func item(_ e: EKEvent) -> EventItem {
            EventItem(
                id: e.eventIdentifier ?? UUID().uuidString,
                title: e.title ?? "(タイトルなし)",
                startDate: e.startDate,
                endDate: e.endDate,
                colorHex: e.calendar.cgColor.flatMap { UIColor(cgColor: $0).toHex() } ?? "#007AFF",
                isAllDay: e.isAllDay
            )
        }
        return CountdownEntry(date: now, next: upcoming.first.map(item), following: upcoming.dropFirst().first.map(item))
    }
}

struct CountdownWidgetEntryView: View {
    var entry: CountdownEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if let next = entry.next {
            if family == .systemSmall {
                smallView(next)
            } else {
                mediumView(next)
            }
        } else {
            VStack(spacing: 4) {
                Image(systemName: "checkmark.circle").font(.system(size: 22)).foregroundColor(.secondary)
                Text("この後の予定なし").font(.system(size: 12)).foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func smallView(_ next: EventItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("次の予定まで").font(.system(size: 10, weight: .semibold)).foregroundColor(.secondary)
            Text(next.startDate, style: .timer)
                .font(.system(size: 26, weight: .heavy)).foregroundColor(.blue)
                .lineLimit(1).minimumScaleFactor(0.5)
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 2).fill(Color(hex: next.colorHex)).frame(width: 3, height: 14)
                Text(next.title).font(.system(size: 11, weight: .medium)).lineLimit(1)
            }
            Text(formatTime(next.startDate)).font(.system(size: 9)).foregroundColor(.secondary)
            Spacer(minLength: 0)
        }
        .padding(12)
    }

    private func mediumView(_ next: EventItem) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("次の予定まで").font(.system(size: 11, weight: .semibold)).foregroundColor(.secondary)
                Text(next.startDate, style: .timer)
                    .font(.system(size: 34, weight: .heavy)).foregroundColor(.blue)
                    .lineLimit(1).minimumScaleFactor(0.5)
            }
            Rectangle().fill(Color.secondary.opacity(0.2)).frame(width: 1).padding(.vertical, 8)
            VStack(alignment: .leading, spacing: 6) {
                eventRow(next)
                if let f = entry.following {
                    eventRow(f)
                } else {
                    Text("この後の予定なし").font(.system(size: 10)).foregroundColor(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
    }

    private func eventRow(_ e: EventItem) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(Color(hex: e.colorHex)).frame(width: 4, height: 26)
            VStack(alignment: .leading, spacing: 1) {
                Text(e.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
                Text("\(formatTime(e.startDate)) - \(formatTime(e.endDate))").font(.system(size: 10)).foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    private func formatTime(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "H:mm"; return f.string(from: d)
    }
}

struct CountdownWidget: Widget {
    let kind = "CountdownWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CountdownProvider()) { entry in
            if #available(iOS 17.0, *) {
                CountdownWidgetEntryView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
            } else {
                CountdownWidgetEntryView(entry: entry).padding().background()
            }
        }
        .configurationDisplayName("次の予定まで")
        .description("次の予定までの残り時間をカウントダウン表示します")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
