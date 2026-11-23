plugins {
    id("com.android.application")
}

android {
    namespace = "dev.openclaw.mobile"
    buildFeatures { buildConfig = true }
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    defaultConfig {
        applicationId = "dev.openclaw.mobile"
        minSdk = 28
        targetSdk = 35
        ndk { abiFilters += listOf("arm64-v8a") }
        versionCode = 11
        versionName = "0.2.0"
        val updateUrl = System.getenv("ANDROID_UPDATE_MANIFEST_URL") ?: ""
        val escapedUrl = updateUrl.replace("\\", "\\\\").replace("\"", "\\\"")
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"$escapedUrl\"")
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }
    val signingValues = listOf("ANDROID_RELEASE_KEYSTORE", "ANDROID_RELEASE_STORE_PASSWORD", "ANDROID_RELEASE_KEY_PASSWORD", "ANDROID_RELEASE_KEY_ALIAS").map(System::getenv)
    if (signingValues.all { !it.isNullOrBlank() }) {
        signingConfigs.create("distribution") {
            storeFile = file(signingValues[0]!!)
            storePassword = signingValues[1]
            keyPassword = signingValues[2]
            keyAlias = signingValues[3]
        }
    }
    // Compress bundled native engine so the installed 0.1.2 updater can fetch it.
    // Android extracts these libraries into private install storage.
    packaging { jniLibs.useLegacyPackaging = true }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingValues.all { !it.isNullOrBlank() }) require(!System.getenv("ANDROID_UPDATE_MANIFEST_URL").isNullOrBlank()) { "Update endpoint secret missing" }
            if (signingValues.all { !it.isNullOrBlank() }) signingConfig = signingConfigs.getByName("distribution")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    sourceSets.getByName("test").resources.srcDir("../../shared/contracts")
}

dependencies {
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.mozilla.geckoview:geckoview:160.0.20261116130455")
    implementation("androidx.core:core:1.15.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
