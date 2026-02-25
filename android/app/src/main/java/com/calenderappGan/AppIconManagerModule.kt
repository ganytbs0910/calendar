package com.calenderappGan

import android.content.ComponentName
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AppIconManagerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "AppIconManager"

  @ReactMethod
  fun changeIcon(monthStr: String, promise: Promise) {
    try {
      val pm = reactApplicationContext.packageManager
      val pkg = reactApplicationContext.packageName

      for (i in 1..12) {
        val alias = "$pkg.Month${String.format("%02d", i)}"
        val state = if (String.format("%02d", i) == monthStr)
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        else
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED

        pm.setComponentEnabledSetting(
          ComponentName(pkg, alias),
          state,
          PackageManager.DONT_KILL_APP
        )
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ICON_ERROR", e.message, e)
    }
  }
}
