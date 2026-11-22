plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.openclaw.mobile"
    buildFeatures { buildConfig = true }
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.openclaw.mobile"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
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
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingValues.all { !it.isNullOrBlank() }) signingConfig = signingConfigs.getByName("distribution")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("test").resources.srcDir("../../shared/contracts")
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
