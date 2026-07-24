import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';

const WIDGET_BG = '#F2F2F7';
const WIDGET_SURFACE = '#FFFFFF';
const BLUE = '#007AFF';
const RED = '#FF3B30';
const GREEN = '#34C759';
const ORANGE = '#FF9500';
const PURPLE = '#AF52DE';

// Small Widget: Today's events
export function SmallWidgetPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.widgetSmall}>
      <View style={s.widgetInner}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Text style={{fontSize: 22, fontWeight: '700', color: BLUE}}>17</Text>
          <View style={{marginLeft: 6}}>
            <Text style={{fontSize: 9, fontWeight: '600', color: '#888'}}>{months[1]}</Text>
            <Text style={{fontSize: 9, color: '#888'}}>{wd[1]}</Text>
          </View>
        </View>
        <View style={{marginTop: 6, gap: 4}}>
          {[
            {color: BLUE, title: t('wpEvMeeting'), time: '10:00'},
            {color: RED, title: t('wpEvLunch'), time: '12:00'},
            {color: GREEN, title: t('wpEvReview'), time: '15:00'},
          ].map((e, i) => (
            <View key={i} style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
              <View style={{width: 2.5, height: 16, borderRadius: 1, backgroundColor: e.color}} />
              <View>
                <Text style={{fontSize: 9, fontWeight: '500', color: '#333'}} numberOfLines={1}>{e.title}</Text>
                {i === 0 ? (
                  <Text style={{fontSize: 7.5, fontWeight: '700', color: BLUE}}>{t('wpIn')} 57:50</Text>
                ) : (
                  <Text style={{fontSize: 7, color: '#999'}}>{e.time}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Medium Widget: Today's events
export function MediumWidgetPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.widgetMedium}>
      <View style={[s.widgetInner, {flexDirection: 'row'}]}>
        <View style={{alignItems: 'center', width: 50}}>
          <Text style={{fontSize: 9, fontWeight: '600', color: '#888'}}>{months[1]}</Text>
          <Text style={{fontSize: 28, fontWeight: '700', color: BLUE}}>17</Text>
          <Text style={{fontSize: 9, color: '#888'}}>{wd[1]}</Text>
        </View>
        <View style={{width: 1, backgroundColor: '#E5E5EA', marginHorizontal: 8, marginVertical: 4}} />
        <View style={{flex: 1, gap: 3}}>
          {[
            {color: BLUE, title: t('wpEvMeeting'), time: '10:00 - 11:00'},
            {color: RED, title: t('wpEvLunch'), time: '12:00 - 13:00'},
            {color: GREEN, title: t('wpEvCodeReview'), time: '15:00 - 16:00'},
            {color: ORANGE, title: '1on1', time: '17:00 - 17:30'},
          ].map((e, i) => (
            <View key={i} style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
              <View style={{width: 3, height: 20, borderRadius: 1.5, backgroundColor: e.color}} />
              <View style={{flex: 1}}>
                <Text style={{fontSize: 10, fontWeight: '500', color: '#333'}} numberOfLines={1}>{e.title}</Text>
                <Text style={{fontSize: 7.5, color: '#999'}}>{e.time}</Text>
              </View>
              {i === 0 && (
                <View style={{alignItems: 'flex-end'}}>
                  <Text style={{fontSize: 6.5, color: '#999'}}>{t('wpUntilStart')}</Text>
                  <Text style={{fontSize: 11, fontWeight: '700', color: BLUE}}>57:50</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Month Calendar Widget
export function MonthCalendarPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  const weekdays = wd;
  const days = [
    [0, 0, 0, 0, 0, 0, 1],
    [2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20, 21, 22],
    [23, 24, 25, 26, 27, 28, 0],
  ];
  const eventDays = new Set([3, 7, 10, 14, 17, 21, 25]);
  const today = 17;

  return (
    <View style={s.widgetLarge}>
      <View style={s.widgetInner}>
        <Text style={{fontSize: 11, fontWeight: '700', color: '#333', marginBottom: 4}}>{t('yearMonthFormat', {year: 2025, month: months[1]})}</Text>
        <View style={{flexDirection: 'row', marginBottom: 2}}>
          {weekdays.map((wd, i) => (
            <Text key={i} style={{
              flex: 1, textAlign: 'center', fontSize: 8, fontWeight: '600',
              color: i === 0 ? RED : i === 6 ? BLUE : '#888',
            }}>{wd}</Text>
          ))}
        </View>
        {days.map((week, wi) => (
          <View key={wi} style={{flexDirection: 'row', marginVertical: 1}}>
            {week.map((day, di) => (
              <View key={di} style={{flex: 1, alignItems: 'center', height: 22}}>
                {day > 0 && (
                  <>
                    <View style={day === today ? {
                      backgroundColor: BLUE, borderRadius: 8, width: 16, height: 16,
                      justifyContent: 'center', alignItems: 'center',
                    } : {justifyContent: 'center', alignItems: 'center', height: 16}}>
                      <Text style={{
                        fontSize: 9,
                        fontWeight: day === today ? '700' : '400',
                        color: day === today ? '#fff' : di === 0 ? RED : di === 6 ? BLUE : '#333',
                      }}>{day}</Text>
                    </View>
                    {eventDays.has(day) && (
                      <View style={{width: 3, height: 3, borderRadius: 1.5, backgroundColor: BLUE, marginTop: 1, opacity: 0.7}} />
                    )}
                  </>
                )}
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// Upcoming Events Widget
export function UpcomingEventsPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.widgetMedium}>
      <View style={s.widgetInner}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4}}>
          <Text style={{fontSize: 10, fontWeight: '700', color: '#333'}}>{t('wpUpcoming')}</Text>
          <Text style={{fontSize: 8, color: '#888'}}>{t('wpDays', {n: 3})}</Text>
        </View>
        {[
          {label: t('wpToday'), events: [{color: BLUE, title: t('wpEvMeeting'), time: '10:00'}]},
          {label: t('wpTomorrow'), events: [{color: RED, title: t('wpEvPresentation'), time: '14:00'}]},
          {label: `2/19 (${wd[3]})`, events: [{color: PURPLE, title: t('wpEvStudy'), time: '19:00'}]},
        ].map((group, gi) => (
          <View key={gi} style={{marginBottom: 3}}>
            <Text style={{fontSize: 8.5, fontWeight: '600', color: BLUE, marginBottom: 1}}>{group.label}</Text>
            {group.events.map((e, ei) => (
              <View key={ei} style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
                <View style={{width: 2.5, height: 16, borderRadius: 1, backgroundColor: e.color}} />
                <View>
                  <Text style={{fontSize: 9, fontWeight: '500', color: '#333'}}>{e.title}</Text>
                  <Text style={{fontSize: 7, color: '#999'}}>{e.time}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// Lock Screen Widgets
export function LockScreenCircularPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.lockCircular}>
      <Text style={{fontSize: 8, fontWeight: '600', color: '#fff'}}>{wd[1]}</Text>
      <Text style={{fontSize: 18, fontWeight: '700', color: '#fff'}}>17</Text>
    </View>
  );
}

export function LockScreenRectangularPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.lockRectangular}>
      <Text style={{fontSize: 9, fontWeight: '600', color: '#fff'}}>{isJa ? '2月17日 (月)' : `${months[1]} 17 (${wd[1]})`}</Text>
      <View style={{flexDirection: 'row', gap: 4, marginTop: 2}}>
        <Text style={{fontSize: 9, fontWeight: '500', color: '#ddd'}}>10:00</Text>
        <Text style={{fontSize: 9, color: '#ccc'}} numberOfLines={1}>{t('wpEvMeeting')}</Text>
      </View>
    </View>
  );
}

export function LockScreenInlinePreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.lockInline}>
      <Text style={{fontSize: 10, color: '#fff'}}>10:00 {t('wpEvMeeting')}</Text>
    </View>
  );
}

// Countdown Widget: time until the next event
export function CountdownWidgetPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.widgetMedium}>
      <View style={[s.widgetInner, {flexDirection: 'row', alignItems: 'center'}]}>
        <View style={{justifyContent: 'center'}}>
          <Text style={{fontSize: 9, fontWeight: '600', color: '#888'}}>{t('wpTimeToNext')}</Text>
          <Text style={{fontSize: 30, fontWeight: '800', color: BLUE}}>57:50</Text>
        </View>
        <View style={{width: 1, backgroundColor: '#E5E5EA', marginHorizontal: 10, marginVertical: 6}} />
        <View style={{flex: 1, gap: 6}}>
          {[{color: BLUE, title: t('wpEvMeeting'), time: '10:00 - 11:00'}, {color: RED, title: t('wpEvLunch'), time: '12:00 - 13:00'}].map((e, i) => (
            <View key={i} style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
              <View style={{width: 3, height: 22, borderRadius: 1.5, backgroundColor: e.color}} />
              <View style={{flex: 1}}>
                <Text style={{fontSize: 11, fontWeight: '500', color: '#333'}} numberOfLines={1}>{e.title}</Text>
                <Text style={{fontSize: 8, color: '#999'}}>{e.time}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Free Time Widget: remaining free time today
export function FreeTimeWidgetPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  return (
    <View style={s.widgetSmall}>
      <View style={s.widgetInner}>
        <Text style={{fontSize: 9, fontWeight: '600', color: '#888'}}>{`☕ ${t('wpFreeTime')}`}</Text>
        <Text style={{fontSize: 24, fontWeight: '800', color: '#333', marginTop: 8}}>{isJa ? '3時間35分' : '3h 35m'}</Text>
        <View style={{height: 7, borderRadius: 4, backgroundColor: '#E5E5EA', marginTop: 10, overflow: 'hidden'}}>
          <View style={{width: '64%', height: '100%', backgroundColor: GREEN}} />
        </View>
        <Text style={{fontSize: 8, color: '#999', marginTop: 8}}>{t('wpBusy', {t: isJa ? '2時間' : '2h'})}</Text>
      </View>
    </View>
  );
}

// Week Widget: this week's events as 7 columns
export function WeekWidgetPreview() {
  const {t, i18n} = useTranslation();
  const months = t('monthNames', {returnObjects: true}) as unknown as string[];
  const wd = t('weekdaysSingle', {returnObjects: true}) as unknown as string[];
  const isJa = i18n.language === 'ja';
  const nums = [8, 9, 10, 11, 12, 13, 14];
  const today = 12;
  const dots: Record<number, string[]> = {9: [BLUE], 10: [BLUE, RED], 11: [GREEN], 12: [BLUE, ORANGE, RED], 13: [PURPLE], 14: [BLUE]};
  return (
    <View style={s.widgetMedium}>
      <View style={[s.widgetInner, {flexDirection: 'row', gap: 2}]}>
        {nums.map((n, i) => (
          <View key={n} style={{flex: 1, alignItems: 'center', gap: 3}}>
            <Text style={{fontSize: 8, fontWeight: '600', color: i === 0 ? RED : i === 6 ? BLUE : '#888'}}>{wd[i]}</Text>
            <View style={{width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: n === today ? BLUE : 'transparent'}}>
              <Text style={{fontSize: 11, fontWeight: n === today ? '700' : '400', color: n === today ? '#fff' : '#333'}}>{n}</Text>
            </View>
            <View style={{gap: 2, alignItems: 'center'}}>
              {(dots[n] || []).map((c, di) => (
                <View key={di} style={{width: 5, height: 5, borderRadius: 2.5, backgroundColor: c}} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  widgetSmall: {
    width: 130,
    height: 130,
    borderRadius: 18,
    backgroundColor: WIDGET_SURFACE,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  widgetMedium: {
    width: '100%',
    maxWidth: 280,
    height: 130,
    borderRadius: 18,
    backgroundColor: WIDGET_SURFACE,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  widgetLarge: {
    width: '100%',
    maxWidth: 280,
    height: 260,
    borderRadius: 18,
    backgroundColor: WIDGET_SURFACE,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  widgetInner: {
    flex: 1,
    padding: 12,
  },
  lockCircular: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockRectangular: {
    width: 150,
    height: 48,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  lockInline: {
    height: 20,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
});
