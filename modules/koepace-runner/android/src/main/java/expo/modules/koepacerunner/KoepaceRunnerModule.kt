package expo.modules.koepacerunner

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KoepaceRunnerModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var speaker: Speaker? = null

  override fun definition() = ModuleDefinition {
    Name("KoepaceRunner")

    // 予定時刻の一覧を渡して、裏で読み上げを始める（走行中に呼べば予定を差し替える）
    Function("start") { startAtMs: Double, offsetsMs: List<Double>, texts: List<String> ->
      val intent = Intent(context, RunnerService::class.java).apply {
        action = RunnerService.ACTION_START
        putExtra(RunnerService.EXTRA_START_AT, startAtMs.toLong())
        putExtra(RunnerService.EXTRA_OFFSETS, offsetsMs.map { it.toLong() }.toLongArray())
        putExtra(RunnerService.EXTRA_TEXTS, texts.toTypedArray())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      Unit
    }

    Function("stop") {
      if (RunnerService.running) {
        val intent = Intent(context, RunnerService::class.java).apply {
          action = RunnerService.ACTION_STOP
        }
        context.startService(intent)
      }
      Unit
    }

    // 画面を見ているときの読み上げ（「スタートしました」など）
    Function("speak") { text: String ->
      val ctx = context
      main.post {
        val sp = speaker ?: Speaker(ctx).also { speaker = it }
        sp.speak(text)
      }
      Unit
    }

    Function("isRunning") { RunnerService.running }

    Function("getStartAt") { RunnerService.startAt.toDouble() }

    Function("getLog") { RunnerService.snapshotLog() }

    Function("getBattery") { RunnerService.batteryLevel(context) }

    // 電池の最適化から外れているか
    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      pm?.isIgnoringBatteryOptimizations(context.packageName) ?: true
    }

    // 「電池の最適化を外す」確認画面を開く
    Function("openBatterySettings") {
      val ctx = context
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:" + ctx.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
      } catch (e: Exception) {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
      }
      Unit
    }

    OnDestroy {
      main.post {
        speaker?.shutdown()
        speaker = null
      }
    }
  }

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
}
