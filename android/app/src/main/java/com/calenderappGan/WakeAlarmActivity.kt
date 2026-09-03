package com.calenderappGan

import android.app.KeyguardManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Call-screen-style full-screen alarm. notifee's fullScreenAction launches this
 * directly via Intent — the system does this even if the JS layer is dead, the
 * same mechanism a real incoming call uses.
 */
class WakeAlarmActivity : AppCompatActivity() {
  private var mediaPlayer: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private val autoStopHandler = Handler(Looper.getMainLooper())
  private var autoStopRunnable: Runnable? = null

  companion object {
    const val EXTRA_EVENT_ID = "eventId"
    const val EXTRA_TITLE = "title"
    private const val AUTO_STOP_MS = 90_000L
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    setShowWhenLocked(true)
    setTurnScreenOn(true)
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
    )
    (getSystemService(KEYGUARD_SERVICE) as? KeyguardManager)?.requestDismissKeyguard(this, null)

    val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: ""
    val title = intent.getStringExtra(EXTRA_TITLE) ?: ""

    buildUi(title)
    startRinging()
    scheduleAutoStop()
  }

  private fun buildUi(title: String) {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#1A1A2E"))
      setPadding(64, 64, 64, 64)
    }

    root.addView(
      TextView(this).apply {
        text = "起きる時間です"
        textSize = 20f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
      },
    )
    root.addView(
      TextView(this).apply {
        text = title
        textSize = 26f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setPadding(0, 32, 0, 96)
      },
    )

    val buttonRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    buttonRow.addView(Button(this).apply {
      text = "あと5分"
      setOnClickListener { onSnooze() }
    })
    buttonRow.addView(View(this).apply {
      layoutParams = LinearLayout.LayoutParams(48, 0)
    })
    buttonRow.addView(Button(this).apply {
      text = "起きた"
      setOnClickListener { onAnswer() }
    })
    root.addView(buttonRow)

    setContentView(root)
  }

  private fun startRinging() {
    try {
      val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      mediaPlayer = MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        setDataSource(this@WakeAlarmActivity, uri)
        isLooping = true
        prepare()
        start()
      }
    } catch (e: Exception) {
      // Vibration below still gets the user's attention if playback fails.
    }

    vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(VIBRATOR_SERVICE) as Vibrator
    }
    val pattern = longArrayOf(0, 800, 800)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
    } else {
      @Suppress("DEPRECATION")
      vibrator?.vibrate(pattern, 0)
    }
  }

  private fun stopRinging() {
    mediaPlayer?.let {
      try {
        it.stop()
      } catch (_: Exception) {
      }
      it.release()
    }
    mediaPlayer = null
    vibrator?.cancel()
    autoStopRunnable?.let { autoStopHandler.removeCallbacks(it) }
  }

  private fun scheduleAutoStop() {
    // Unattended for too long — stop ringing so the device (and anyone nearby)
    // isn't stuck with a call-screen alarm blaring indefinitely.
    val runnable = Runnable {
      stopRinging()
      finish()
    }
    autoStopRunnable = runnable
    autoStopHandler.postDelayed(runnable, AUTO_STOP_MS)
  }

  private fun emit(eventName: String) {
    val context = (application as? ReactApplication)?.reactHost?.currentReactContext ?: return
    val payload = Arguments.createMap().apply {
      putString("eventId", intent.getStringExtra(EXTRA_EVENT_ID) ?: "")
      putString("title", intent.getStringExtra(EXTRA_TITLE) ?: "")
    }
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun onAnswer() {
    stopRinging()
    emit("WakeAlarmAnswered")
    finish()
  }

  private fun onSnooze() {
    stopRinging()
    emit("WakeAlarmSnoozed")
    finish()
  }

  override fun onDestroy() {
    stopRinging()
    super.onDestroy()
  }
}
