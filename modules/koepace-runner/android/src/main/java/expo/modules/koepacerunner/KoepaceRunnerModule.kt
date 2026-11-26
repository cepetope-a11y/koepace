package expo.modules.koepacerunner

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KoepaceRunnerModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var speaker: Speaker? = null

  override fun definition() = ModuleDefinition {
    Name("KoepaceRunner")

    // 予定時刻の一覧を渡して、裏で読み上げを始める（走行中に呼べば予定を差し替える）
    Function("start") { startAtMs: Double, offsetsMs: List<Double>, texts: List<String>, titles: List<String>, bodies: List<String>, voice: Boolean, notify: Boolean, raceId: Double, points: List<Int>, chime: Boolean ->
      val intent = Intent(context, RunnerService::class.java).apply {
        action = RunnerService.ACTION_START
        putExtra(RunnerService.EXTRA_START_AT, startAtMs.toLong())
        putExtra(RunnerService.EXTRA_OFFSETS, offsetsMs.map { it.toLong() }.toLongArray())
        putExtra(RunnerService.EXTRA_TEXTS, texts.toTypedArray())
        putExtra(RunnerService.EXTRA_TITLES, titles.toTypedArray())
        putExtra(RunnerService.EXTRA_BODIES, bodies.toTypedArray())
        putExtra(RunnerService.EXTRA_VOICE, voice)
        putExtra(RunnerService.EXTRA_NOTIFY, notify)
        putExtra(RunnerService.EXTRA_RACE, raceId.toLong())
        putExtra(RunnerService.EXTRA_POINTS, points.toIntArray())
        putExtra(RunnerService.EXTRA_CHIME, chime)
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
    Function("speak") { text: String, chime: Boolean ->
      val ctx = context
      main.post {
        val sp = speaker ?: Speaker(ctx).also { speaker = it }
        sp.speak(text, chime)
      }
      Unit
    }

    // 走行中、ロックを解除しなくてもこの画面を出す（カメラやカーナビと同じ）
    Function("setShowWhenLocked") { on: Boolean ->
      val act = appContext.currentActivity
      if (act != null) {
        act.runOnUiThread {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            act.setShowWhenLocked(on)
          } else {
            @Suppress("DEPRECATION")
            val flag = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            if (on) {
              act.window.addFlags(flag)
            } else {
              act.window.clearFlags(flag)
            }
          }
        }
      }
      Unit
    }

    Function("isRunning") { RunnerService.running }

    Function("getStartAt") { RunnerService.startAt.toDouble() }

    Function("getLog") { RunnerService.snapshotLog() }

    // ウォッチの通知の「着いた」で押された時刻（取り出すと空になる）
    Function("takeArrivals") { RunnerService.takeArrivals().map { listOf(it.first.toDouble(), it.second.toDouble()) } }

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
