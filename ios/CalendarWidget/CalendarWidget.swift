import WidgetKit
import SwiftUI
import EventKit

struct CalendarEntry: TimelineEntry {
    let date: Date
    let events: [EventItem]
}

struct EventItem: Identifiable {
    let id: String
    let title: String
    let startDate: Date
    let endDate: Date
    let colorHex: String
    let isAllDay: Bool
}

struct CalendarWidgetProvider: TimelineProvider {
    private let eventStore = EKEventStore()

    func placeholder(in context: Context) -> CalendarEntry {
        CalendarEntry(date: Date(), events: [
            EventItem(id: "1", title: "サンプル予定", startDate: Date(), endDate: Date().addingTimeInterval(3600), colorHex: "#007AFF", isAllDay: false),
            EventItem(id: "2", title: "ミーティング", startDate: Date().addingTimeInterval(7200), endDate: Date().addingTimeInterval(10800), colorHex: "#FF3B30", isAllDay: false),
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarEntry) -> Void) {
        let entry = CalendarEntry(date: Date(), events: fetchTodayEvents())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarEntry>) -> Void) {
        let currentDate = Date()
        let events = fetchTodayEvents()
        let entry = CalendarEntry(date: currentDate, events: events)

        // Refresh every 30 minutes
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: currentDate)!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func fetchTodayEvents() -> [EventItem] {
        let status = EKEventStore.authorizationStatus(for: .event)
        guard status == .authorized || status == .fullAccess else {
            return []
        }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!

        let predicate = eventStore.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: nil)
        let ekEvents = eventStore.events(matching: predicate)

        return ekEvents
            .sorted { $0.startDate < $1.startDate }
            .prefix(5)
            .map { event in
                EventItem(
                    id: event.eventIdentifier ?? UUID().uuidString,
                    title: event.title ?? "(タイトルなし)",
                    startDate: event.startDate,
                    endDate: event.endDate,
                    colorHex: event.calendar.cgColor.flatMap { UIColor(cgColor: $0).toHex() } ?? "#007AFF",
                    isAllDay: event.isAllDay
                )
            }
    }
}
