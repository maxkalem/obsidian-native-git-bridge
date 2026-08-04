plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.nativegitbridge.companion"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.nativegitbridge.companion"
        minSdk = 24
        targetSdk = 34
        versionCode = 6
        versionName = "0.4.0"
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
