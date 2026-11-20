plugins {
    id("com.android.test")
    id("androidx.baselineprofile")
}

android {
    namespace = "com.deskhead.gente.baselineprofile"
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }
    defaultConfig {
        minSdk = 31
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Numbers from an emulator are only indicative; real phones are needed for final figures.
        testInstrumentationRunnerArguments["androidx.benchmark.suppressErrors"] = "EMULATOR"
    }
    targetProjectPath = ":app"
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

baselineProfile {
    useConnectedDevices = true
}

dependencies {
    implementation("androidx.test.ext:junit:1.3.0")
    implementation("androidx.test:runner:1.7.0")
    implementation("androidx.test.uiautomator:uiautomator:2.4.1")
    implementation("androidx.benchmark:benchmark-macro-junit4:1.5.0")
}
