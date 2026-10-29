import java.util.Properties

plugins {
    id("com.android.application")
}

// Release builds are signed with Drift's key (kept outside the repo; see build-android.ps1).
// DRIFT_KEYSTORE points at its keystore.properties; the default is ../../signing/keystore.properties.
val keystoreFile = file(System.getenv("DRIFT_KEYSTORE") ?: "../../signing/keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) } }

// The version is Drift's version (shared with desktop); versionCode is derived from it.
val driftVersion = (project.findProperty("driftVersion") as String?) ?: "2.0.0"
val versionParts = driftVersion.split(".").map { it.toInt() }

android {
    namespace = "io.github.lompendans.drift"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.lompendans.drift"
        minSdk = 26
        targetSdk = 37
        versionName = driftVersion
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
    }

    signingConfigs {
        if (keystore.containsKey("storeFile")) create("release") {
            storeFile = file(keystore.getProperty("storeFile"))
            storePassword = keystore.getProperty("storePassword")
            keyAlias = keystore.getProperty("keyAlias")
            keyPassword = keystore.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core:1.16.0")
}
