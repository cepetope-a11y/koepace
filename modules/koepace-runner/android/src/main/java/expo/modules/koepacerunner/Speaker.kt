package expo.modules.koepacerunner

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Android標準の読み上げ。話している数秒だけ、音楽アプリに音量を下げてもらう。
 */
class Speaker(context: Context) {
  private val appContext = context.applicationContext
  private val handler = Handler(Looper.getMainLooper())
  private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  private var tts: TextToSpeech? = null
  private var ready = false
  private val pending = mutableListOf<Pair<String, String>>()
  private var focusRequest: AudioFocusRequest? = null
  private var speaking = 0
  private var counter = 0

  private val attrs: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  init {
    tts = TextToSpeech(appContext) { status ->
      handler.post {
        if (status == TextToSpeech.SUCCESS) {
          tts?.setLanguage(Locale.JAPANESE)
          tts?.setAudioAttributes(attrs)
          tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) { handler.post { finishedOne() } }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { handler.post { finishedOne() } }
            override fun onError(utteranceId: String?, errorCode: Int) { handler.post { finishedOne() } }
          })
          ready = true
          val queued = pending.toList()
          pending.clear()
          queued.forEach { (text, id) -> speakNow(text, id) }
        }
      }
    }
  }

  /** 読み上げる。音楽アプリに音量を下げてもらえたら true。chime=true なら先に「ピロン♪」を鳴らす */
  fun speak(text: String, chime: Boolean = false): Boolean {
    counter += 1
    val id = "u$counter"
    if (chime) {
      val granted = requestFocus()
      speaking += 1 // 合図が鳴っている間も音楽を下げたままにする
      val ms = playChime()
      handler.postDelayed({
        speaking = (speaking - 1).coerceAtLeast(0)
        if (!ready) pending.add(text to id) else speakNow(text, id)
      }, ms + 80L)
      return granted
    }
    if (!ready) {
      pending.add(text to id)
      return true
    }
    return speakNow(text, id)
  }

  /** 予定地点の合図「ピロン♪」（低い音→高い音）。鳴らす長さ(ms)を返す */
  private fun playChime(): Long {
    val rate = 22050
    val notes = listOf(Triple(988.0, 0.11, 0.0), Triple(1319.0, 0.26, 0.13)) // 周波数, 長さ(秒), 始まり(秒)
    val total = 0.42
    val n = (rate * total).toInt()
    val pcm = ShortArray(n)
    for ((f, len, start) in notes) {
      val s0 = (start * rate).toInt()
      val cnt = (len * rate).toInt()
      for (i in 0 until cnt) {
        val k = s0 + i
        if (k >= n) break
        val t = i.toDouble() / rate
        val attack = (t / 0.008).coerceAtMost(1.0)
        val decay = Math.exp(-t * 9.0)
        val v = Math.sin(2 * Math.PI * f * t) * attack * decay * 0.55
        val mixed = pcm[k] + (v * Short.MAX_VALUE).toInt()
        pcm[k] = mixed.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
      }
    }
    return try {
      val track = AudioTrack.Builder()
        .setAudioAttributes(attrs)
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()
        )
        .setBufferSizeInBytes(n * 2)
        .setTransferMode(AudioTrack.MODE_STATIC)
        .build()
      track.write(pcm, 0, n)
      track.play()
      val ms = (total * 1000).toLong()
      handler.postDelayed({ try { track.stop(); track.release() } catch (e: Exception) {} }, ms + 200L)
      ms
    } catch (e: Exception) {
      0L
    }
  }

  private fun speakNow(text: String, id: String): Boolean {
    val granted = requestFocus()
    speaking += 1
    tts?.speak(text, TextToSpeech.QUEUE_ADD, null, id)
    return granted
  }

  fun stop() {
    pending.clear()
    try { tts?.stop() } catch (e: Exception) {}
    speaking = 0
    abandonFocus()
  }

  fun shutdown() {
    stop()
    try { tts?.shutdown() } catch (e: Exception) {}
    tts = null
    ready = false
  }

  private fun requestFocus(): Boolean {
    val am = audioManager ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
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
}
