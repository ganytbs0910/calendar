package com.calenderappGan

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Schedules the wake-alarm entirely with plain Android APIs (AlarmManager +
 * NotificationCompat.setFullScreenIntent), bypassing notifee for this one
 * notification type. notifee's fullScreenAction launches a custom Activity by
 * stashing the notification in an internal, undocumented parcelable extra
 * ("notifee.notification") — relying on that to recover eventId/title would
 * mean depending on notifee's private serialization format. Building the
 * PendingIntent ourselves means we control every extra on it.
 */
class WakeAlarmModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "WakeAlarmModule"

  companion object {
    const val CHANNEL_ID = "wake-alarm"
    const val ACTION_FIRE = "com.calenderappGan.WAKE_ALARM_FIRE"
  }

  @ReactMethod
  fun ensureChannel(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager =
          reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
          val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
          val channel = NotificationChannel(
            CHANNEL_ID,
            "絶対起床アラーム",
            NotificationManager.IMPORTANCE_HIGH,
          ).apply {
            description = "マナーモードでも鳴る着信画面風の通知"
            enableVibration(true)
            setBypassDnd(true)
            setSound(
              RingtoneManager.getActualDefaultRingtoneUri(
                reactApplicationContext,
                RingtoneManager.TYPE_ALARM,
              ),
              audioAttributes,
            )
          }
          manager.createNotificationChannel(channel)
        }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WAKE_ALARM_CHANNEL_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        val manager =
          reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        promise.resolve(manager.canUseFullScreenIntent())
      } else {
        promise.resolve(true)
      }
    } catch (e: Exception) {
      promise.resolve(true)
    }
  }

  private fun firePendingIntent(eventId: String): PendingIntent {
    val intent = Intent(reactApplicationContext, WakeAlarmReceiver::class.java).apply {
      action = ACTION_FIRE
      putExtra(WakeAlarmReceiver.EXTRA_EVENT_ID, eventId)
    }
    return PendingIntent.getBroadcast(
      reactApplicationContext,
      eventId.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  @ReactMethod
  fun scheduleWakeAlarm(eventId: String, title: String, timestamp: Double, promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, WakeAlarmReceiver::class.java).apply {
        action = ACTION_FIRE
        putExtra(WakeAlarmReceiver.EXTRA_EVENT_ID, eventId)
        putExtra(WakeAlarmReceiver.EXTRA_TITLE, title)
      }
      val pendingIntent = PendingIntent.getBroadcast(
        reactApplicationContext,
        eventId.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val alarmManager =
        reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.setExactAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        timestamp.toLong(),
        pendingIntent,
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WAKE_ALARM_SCHEDULE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun cancelWakeAlarm(eventId: String, promise: Promise) {
    try {
      val alarmManager =
        reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.cancel(firePendingIntent(eventId))
      NotificationManagerCompat.from(reactApplicationContext).cancel(eventId.hashCode())
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("WAKE_ALARM_CANCEL_ERROR", e.message, e)
    }
  }
}
