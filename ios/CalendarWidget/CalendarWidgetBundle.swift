import WidgetKit
import SwiftUI

struct CalendarAppWidget: Widget {
    let kind: String = "CalendarWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CalendarWidgetProvider()) { entry in
            if #available(iOS 17.0, *) {
                CalendarWidgetEntryView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                CalendarWidgetEntryView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("理想のカレンダー")
        .description("今日の予定を表示します")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct CalendarWidgetBundle: WidgetBundle {
    var body: some Widget {
        CalendarAppWidget()
    }
}
