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

// The start page, the blocked-page warning and the translations are desktop Drift's own files (in ../../app);
// each build copies them in, pointing their script at the path drift.local serves it from.
val sharedPages = tasks.register("sharedPages") {
    val app = file("../../app")
    val assets = file("src/main/assets")
    inputs.files(app.resolve("ui/i18n.js"), app.resolve("pages/newtab.html"), app.resolve("pages/blocked.html"))
    outputs.files(assets.resolve("ui/i18n.js"), assets.resolve("pages/newtab.html"), assets.resolve("pages/blocked.html"))
    doLast {
        app.resolve("ui/i18n.js").copyTo(assets.resolve("ui/i18n.js"), overwrite = true)
        for (name in listOf("newtab.html", "blocked.html"))
            assets.resolve("pages/$name").writeText(app.resolve("pages/$name").readText().replace("drift://ui/i18n.js", "/ui/i18n.js"))
    }
}
tasks.named("preBuild") { dependsOn(sharedPages) }

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core:1.16.0")
}
