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
        CalendarAppWidget()      // 今日の予定（リスト）
        CountdownWidget()        // 次の予定までのカウントダウン
        FreeTimeWidget()         // 今日の空き時間
        WeekWidget()             // 今週の予定（横並び）
        MonthCalendarWidget()    // 月間カレンダー
        UpcomingEventsWidget()   // 今後の予定（複数日）
        LockScreenWidget()       // ロック画面
    }
}
