package com.calenderappGan

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Fires when AlarmManager wakes the device for a wake-alarm. Posts a
 * notification with setFullScreenIntent so the OS launches WakeAlarmActivity
 * directly — over the lock screen, ringing through silent mode — the same
 * mechanism a real incoming call uses. This receiver (not notifee) owns the
 * whole notification so the launch intent's extras are ones we set ourselves.
 */
class WakeAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: return
    val title = intent.getStringExtra(EXTRA_TITLE) ?: ""

    val fullScreenIntent = Intent(context, WakeAlarmActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra(WakeAlarmActivity.EXTRA_EVENT_ID, eventId)
      putExtra(WakeAlarmActivity.EXTRA_TITLE, title)
    }
    val fullScreenPendingIntent = PendingIntent.getActivity(
      context,
      eventId.hashCode(),
      fullScreenIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(context, WakeAlarmModule.CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("起きる時間です")
      .setContentText(title)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setFullScreenIntent(fullScreenPendingIntent, true)
      .setContentIntent(fullScreenPendingIntent)
      .setAutoCancel(true)
      .build()

    NotificationManagerCompat.from(context).notify(eventId.hashCode(), notification)
  }

  companion object {
    const val EXTRA_EVENT_ID = "eventId"
    const val EXTRA_TITLE = "title"
  }
}
