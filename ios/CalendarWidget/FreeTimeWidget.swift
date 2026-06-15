import WidgetKit
import SwiftUI
import EventKit

// 今日これからの空き時間を、数値＋ゲージで見せるウィジェット。
struct FreeTimeEntry: TimelineEntry {
    let date: Date
    let freeMinutes: Int
    let busyMinutes: Int
}

struct FreeTimeProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> FreeTimeEntry {
        FreeTimeEntry(date: Date(), freeMinutes: 215, busyMinutes: 120)
    }

    func getSnapshot(in context: Context, completion: @escaping (FreeTimeEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FreeTimeEntry>) -> Void) {
        let in15 = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        completion(Timeline(entries: [makeEntry()], policy: .after(in15)))
    }

    private func makeEntry() -> FreeTimeEntry {
        let status = EKEventStore.authorizationStatus(for: .event)
        var ok = status == .authorized
        if #available(iOSApplicationExtension 17.0, *) { ok = ok || status == .fullAccess }
        guard ok else { return FreeTimeEntry(date: Date(), freeMinutes: 0, busyMinutes: 0) }

        let cal = Calendar.current
        let now = Date()
        guard let cap = cal.date(bySettingHour: 23, minute: 0, second: 0, of: now), now < cap else {
            return FreeTimeEntry(date: now, freeMinutes: 0, busyMinutes: 0)
        }
        let predicate = eventStore.predicateForEvents(withStart: now, end: cap, calendars: nil)
        let events = eventStore.events(matching: predicate).filter { !$0.isAllDay }
        var busy: TimeInterval = 0
        for e in events {
            let s = max(e.startDate, now)
            let en = min(e.endDate, cap)
            if en > s { busy += en.timeIntervalSince(s) }
        }
        let total = cap.timeIntervalSince(now)
        let free = max(0, total - busy)
        return FreeTimeEntry(date: now, freeMinutes: Int(free / 60), busyMinutes: Int(min(busy, total) / 60))
    }
}

struct FreeTimeWidgetEntryView: View {
    var entry: FreeTimeEntry

    var body: some View {
        let total = max(1, entry.freeMinutes + entry.busyMinutes)
        let ratio = Double(entry.freeMinutes) / Double(total)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: "cup.and.saucer.fill").font(.system(size: 11)).foregroundColor(.green)
                Text("今日の空き時間").font(.system(size: 10, weight: .semibold)).foregroundColor(.secondary)
            }
            Text(durationText(entry.freeMinutes))
                .font(.system(size: 30, weight: .heavy))
                .lineLimit(1).minimumScaleFactor(0.5)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.2)).frame(height: 8)
                    Capsule().fill(Color.green).frame(width: geo.size.width * ratio, height: 8)
                }
            }
            .frame(height: 8)
            Text("予定 \(durationText(entry.busyMinutes))").font(.system(size: 9)).foregroundColor(.secondary)
            Spacer(minLength: 0)
        }
        .padding(12)
    }

    private func durationText(_ minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        if h > 0 && m > 0 { return "\(h)時間\(m)分" }
        if h > 0 { return "\(h)時間" }
        return "\(m)分"
    }
}

struct FreeTimeWidget: Widget {
    let kind = "FreeTimeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FreeTimeProvider()) { entry in
            if #available(iOS 17.0, *) {
                FreeTimeWidgetEntryView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
            } else {
                FreeTimeWidgetEntryView(entry: entry).padding().background()
            }
        }
        .configurationDisplayName("今日の空き時間")
        .description("今日これからの空き時間を表示します")
        .supportedFamilies([.systemSmall])
    }
}
