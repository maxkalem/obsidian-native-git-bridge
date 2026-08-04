plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The companion version follows the RELEASE version: the plugin manifest at the
 * repository root is the single source of truth, so a release tag, the plugin
 * and the APK always carry the same number and can never drift apart. There is
 * nothing to bump by hand here.
 *
 * versionCode is derived monotonically from the same x.y.z (major*10000 +
 * minor*100 + patch), which stays above every previously shipped code.
 */
val releaseVersion: String = run {
    val manifest = rootProject.file("../manifest.json")
    val text = manifest.readText()
    val m = Regex("\"version\"\\s*:\\s*\"([0-9]+)\\.([0-9]+)\\.([0-9]+)\"").find(text)
        ?: throw GradleException("Could not read \"version\" from ${manifest.path}")
    m.groupValues[1] + "." + m.groupValues[2] + "." + m.groupValues[3]
}

val releaseVersionCode: Int = releaseVersion.split(".").let { (major, minor, patch) ->
    major.toInt() * 10000 + minor.toInt() * 100 + patch.toInt()
}

android {
    namespace = "dev.nativegitbridge.companion"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.nativegitbridge.companion"
        minSdk = 24
        targetSdk = 34
        versionCode = releaseVersionCode
        versionName = releaseVersion
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
