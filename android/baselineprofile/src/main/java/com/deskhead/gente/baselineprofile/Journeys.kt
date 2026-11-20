package com.deskhead.gente.baselineprofile

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

const val PKG = "com.deskhead.gente"

/** Gets past the welcome screen without an account, like a first-time person. */
fun MacrobenchmarkScope.enterApp() {
    device.wait(Until.hasObject(By.text("Try it first").pkg(PKG)), 3_000)
    device.findObject(By.text("Try it first"))?.click()
    device.wait(Until.hasObject(By.text("New chat")), 5_000)
}

/** New chat, ask, watch the reply stream in (demo replies stream on the phone), go back. */
fun MacrobenchmarkScope.chatOnce(q: String) {
    device.findObject(By.text("New chat"))!!.click()
    device.wait(Until.hasObject(By.text("Ask Gente")), 5_000)
    device.findObject(By.text("Ask Gente"))!!.click()
    device.findObject(By.focused(true))?.text = q
    device.findObject(By.desc("Send"))!!.click()
    device.wait(Until.hasObject(By.text("Sample reply made on this phone")), 15_000)
    device.pressBack()
    device.pressBack()
    device.wait(Until.hasObject(By.text("New chat")), 5_000)
}

@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule val rule = BaselineProfileRule()

    @Test fun generate() = rule.collect(packageName = PKG, includeInStartupProfile = true) {
        pressHome()
        startActivityAndWait()
        enterApp()
        chatOnce("Plan a trip")
        device.findObject(By.desc("Where's my data"))?.click()
        device.waitForIdle()
        device.pressBack()
    }
}

@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun coldStartWithProfile() = rule.measureRepeated(
        packageName = PKG, metrics = listOf(StartupTimingMetric()), iterations = 8,
        startupMode = StartupMode.COLD, compilationMode = CompilationMode.Partial(),
    ) { pressHome(); startActivityAndWait() }
}

@RunWith(AndroidJUnit4::class)
class StreamingJankBenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun streamThreeReplies() = rule.measureRepeated(
        packageName = PKG, metrics = listOf(FrameTimingMetric()), iterations = 3,
        startupMode = StartupMode.WARM, compilationMode = CompilationMode.Partial(),
        setupBlock = { pressHome(); startActivityAndWait(); enterApp() },
    ) {
        chatOnce("Plan a trip number one")
        chatOnce("Write a note")
        val list = device.findObject(By.scrollable(true))
        list?.fling(androidx.test.uiautomator.Direction.DOWN)
        list?.fling(androidx.test.uiautomator.Direction.UP)
    }
}
