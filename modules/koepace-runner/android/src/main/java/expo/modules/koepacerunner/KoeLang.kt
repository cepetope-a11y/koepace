package expo.modules.koepacerunner

import java.util.Locale

/** 画面で選んだ言語（"ja" か "en"）。読み上げの声と、アプリ本体側の通知の文言に使う */
object KoeLang {
  @Volatile var lang: String = "ja"
  val en: Boolean get() = lang == "en"
  fun t(ja: String, en: String): String = if (this.en) en else ja
  fun locale(): Locale = if (en) Locale.US else Locale.JAPANESE
}
