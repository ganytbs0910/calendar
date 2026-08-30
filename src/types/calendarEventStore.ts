import {CalendarEventReadable} from 'react-native-calendar-events';

export interface CalendarEventDraft {
  id?: string;
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  color?: string;
  recurrence?: string;
  creatorId?: string;
  notes?: string;
  /** 絶対起床アラーム(着信画面風通知)を有効にするか。allDayイベントには適用不可。 */
  mustWake?: boolean;
  /** 発火オフセット(分、開始時刻からの相対値。0またはnullは開始時刻ちょうど)。 */
  mustWakeOffsetMinutes?: number | null;
}

/** Storage boundary used by the home calendar UI when it is opened for a shared calendar. */
export interface CalendarEventStore {
  events: CalendarEventReadable[];
  colors: Record<string, string>;
  save: (draft: CalendarEventDraft) => Promise<string>;
  remove: (eventId: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Present only for a cloud-backed shared calendar. */
  sharedCalendarId?: string;
  /** Viewers may inspect events and answer attendance, but cannot mutate content. */
  readOnly?: boolean;
}
