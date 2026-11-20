package expo.modules.koepacerunner

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * 画面が消えていても、予定時刻に読み上げるための常駐サービス。
 * - 「計測中」の通知を出して、Androidに止められないようにする（カーナビと同じ仕組み）
 * - 時計はこのサービスが自分で持つ（アプリの画面側のタイマーには頼らない）
 * - 読み上げる数秒だけ、音楽アプリに音量を下げてもらう（音楽は止めない）
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
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private val pendingSpeech = mutableListOf<Pair<String, String>>()
  private var wakeLock: PowerManager.WakeLock? = null
  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var speaking = 0

  private var offsets = LongArray(0)
  private var texts = arrayOf<String>()
  private var index = 0

  private val speechAttrs: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

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
      val no = index + 1
      val focus = speak(texts[index], "p$no")
      addLog(
        mapOf(
          "no" to no,
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

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopRun()
      return START_NOT_STICKY
    }
    if (intent?.action != ACTION_START) {
      // 想定外の起動（システムによる再起動など）は何もしないで終わる
      if (!running) stopSelf()
      return START_NOT_STICKY
    }

    // まず通知を出す（startForegroundService から5秒以内に必要）
    showForeground()

    handler.removeCallbacks(fire)
    clearLog()
    startAt = intent.getLongExtra(EXTRA_START_AT, System.currentTimeMillis())
    offsets = intent.getLongArrayExtra(EXTRA_OFFSETS) ?: LongArray(0)
    texts = intent.getStringArrayExtra(EXTRA_TEXTS) ?: arrayOf()
    if (texts.size < offsets.size) offsets = offsets.copyOf(texts.size)
    index = 0
    running = true

    acquireWakeLock()
    initTts()
    speak("計測を始めました。画面を消して、ポケットに入れてください。", "start")
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

  private fun initTts() {
    if (tts != null) return
    tts = TextToSpeech(applicationContext) { status ->
      if (status == TextToSpeech.SUCCESS) {
        tts?.setLanguage(Locale.JAPANESE)
        tts?.setAudioAttributes(speechAttrs)
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}
          override fun onDone(utteranceId: String?) { handler.post { finishedOne() } }
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String?) { handler.post { finishedOne() } }
          override fun onError(utteranceId: String?, errorCode: Int) { handler.post { finishedOne() } }
        })
        ttsReady = true
        val queued = pendingSpeech.toList()
        pendingSpeech.clear()
        queued.forEach { (text, id) -> speakNow(text, id) }
      }
    }
  }

  /** 読み上げる。音楽アプリに音量を下げてもらえたら true */
  private fun speak(text: String, id: String): Boolean {
    if (!ttsReady) {
      pendingSpeech.add(text to id)
      return requestFocusOnly()
    }
    return speakNow(text, id)
  }

  private fun speakNow(text: String, id: String): Boolean {
    val granted = requestFocusOnly()
    speaking += 1
    tts?.speak(text, TextToSpeech.QUEUE_ADD, null, id)
    return granted
  }

  private fun requestFocusOnly(): Boolean {
    val am = audioManager ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speechAttrs)
        .setOnAudioFocusChangeListener { }
        .build()
        .also { focusRequest = it }
      am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) ==
        AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
  }

  private fun finishedOne() {
    speaking = (speaking - 1).coerceAtLeast(0)
    if (speaking == 0) abandonFocus()
  }

  private fun abandonFocus() {
    val am = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(null)
    }
  }

  private fun stopRun() {
    running = false
    handler.removeCallbacks(fire)
    pendingSpeech.clear()
    try { tts?.stop() } catch (e: Exception) {}
    speaking = 0
    abandonFocus()
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
    try { tts?.shutdown() } catch (e: Exception) {}
    tts = null
    ttsReady = false
    abandonFocus()
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }
}
