package expo.modules.koepacerunner

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KoepaceRunnerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KoepaceRunner")

    // 予定時刻の一覧を渡して、裏で読み上げを始める
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
      val intent = Intent(context, RunnerService::class.java).apply {
        action = RunnerService.ACTION_STOP
      }
      context.startService(intent)
      Unit
    }

    Function("isRunning") { RunnerService.running }

    Function("getStartAt") { RunnerService.startAt.toDouble() }

    Function("getLog") { RunnerService.snapshotLog() }

    Function("getBattery") { RunnerService.batteryLevel(context) }
  }

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
}
