package expo.modules.koepacerunner

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
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

  /** 読み上げる。音楽アプリに音量を下げてもらえたら true */
  fun speak(text: String): Boolean {
    counter += 1
    val id = "u$counter"
    if (!ready) {
      pending.add(text to id)
      return true
    }
    return speakNow(text, id)
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
