package expo.modules.koepacerunner

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * 画面が消えていても、予定時刻に読み上げるための常駐サービス。
 * - 「計測中」の通知を出して、Androidに止められないようにする（カーナビと同じ仕組み）
 * - 時計はこのサービスが自分で持つ（アプリの画面側のタイマーには頼らない）
 * - 予定はいつでも差し替えられる（目標の変更など）。読み上げ済みのものは繰り返さない
 */
class RunnerService : Service() {

  companion object {
    const val ACTION_START = "expo.modules.koepacerunner.START"
    const val ACTION_STOP = "expo.modules.koepacerunner.STOP"
    const val EXTRA_START_AT = "startAt"
    const val EXTRA_OFFSETS = "offsets"
    const val EXTRA_TEXTS = "texts"

    private const val CHANNEL_ID = "koepace_run"
    private const val NOTIFICATION_ID = 4521
    private const val STALE_MS = 60_000L

    @Volatile var running = false
    @Volatile var startAt = 0L

    private val log = mutableListOf<Map<String, Any>>()

    fun snapshotLog(): List<Map<String, Any>> = synchronized(log) { log.toList() }

    private fun addLog(item: Map<String, Any>) = synchronized(log) { log.add(item) }

    private fun clearLog() = synchronized(log) { log.clear() }

    fun batteryLevel(context: Context): Int {
      val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
      return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var speaker: Speaker? = null
  private var wakeLock: PowerManager.WakeLock? = null

  private var offsets = LongArray(0)
  private var texts = arrayOf<String>()
  private var index = 0
  private val fired = HashSet<String>()

  private val fire = object : Runnable {
    override fun run() {
      if (!running || index >= offsets.size) return
      val target = startAt + offsets[index]
      val now = System.currentTimeMillis()
      // 早く起きてしまったときは、残りを待ち直す
      if (now < target - 30) {
        handler.postDelayed(this, target - now)
        return
      }
      val focus = speaker?.speak(texts[index]) ?: false
      fired.add(key(offsets[index], texts[index]))
      addLog(
        mapOf(
          "no" to (snapshotLog().size + 1),
          "plannedMs" to offsets[index].toDouble(),
          "actualMs" to (now - startAt).toDouble(),
          "battery" to batteryLevel(this@RunnerService),
          "focus" to focus
        )
      )
      index += 1
      scheduleNext()
    }
  }

  private fun key(offset: Long, text: String) = "$offset|$text"

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopRun()
      return START_NOT_STICKY
    }
    if (intent?.action != ACTION_START) {
      if (!running) stopSelf()
      return START_NOT_STICKY
    }

    // まず通知を出す（startForegroundService から5秒以内に必要）
    showForeground()

    val newStart = intent.getLongExtra(EXTRA_START_AT, System.currentTimeMillis())
    val newOffsets = intent.getLongArrayExtra(EXTRA_OFFSETS) ?: LongArray(0)
    val newTexts = intent.getStringArrayExtra(EXTRA_TEXTS) ?: arrayOf()

    if (!running || newStart != startAt) {
      // 新しいレース
      fired.clear()
      clearLog()
    }
    startAt = newStart
    running = true

    // 読み上げ済み・1分以上前に過ぎたものを除いて、時刻順に並べる
    val now = System.currentTimeMillis()
    val pairs = newOffsets.indices
      .filter { it < newTexts.size }
      .map { Pair(newOffsets[it], newTexts[it]) }
      .filter { !fired.contains(key(it.first, it.second)) && now - (startAt + it.first) < STALE_MS }
      .sortedBy { it.first }
    offsets = pairs.map { it.first }.toLongArray()
    texts = pairs.map { it.second }.toTypedArray()
    index = 0

    acquireWakeLock()
    if (speaker == null) speaker = Speaker(this)
    handler.removeCallbacks(fire)
    scheduleNext()
    return START_NOT_STICKY
  }

  private fun scheduleNext() {
    if (!running || index >= offsets.size) return
    val delay = startAt + offsets[index] - System.currentTimeMillis()
    handler.postDelayed(fire, if (delay > 0) delay else 0)
  }

  private fun showForeground() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "計測中の表示", NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      nm.createNotificationChannel(channel)
    }

    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val content = if (launch != null) {
      PendingIntent.getActivity(
        this, 0, launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    } else null

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val notification = builder
      .setContentTitle("コエペース 計測中")
      .setContentText("予定の時刻になったら声でお知らせします")
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setOngoing(true)
      .setContentIntent(content)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    // 画面は消えたまま、時計を動かすためにCPUだけ起こしておく
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "koepace:run").apply {
      setReferenceCounted(false)
      acquire(12 * 60 * 60 * 1000L)
    }
  }

  private fun stopRun() {
    running = false
    handler.removeCallbacks(fire)
    speaker?.stop()
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    handler.removeCallbacks(fire)
    speaker?.shutdown()
    speaker = null
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }
}
