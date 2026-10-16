import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing comes from environment variables (CI) or keystore.properties (local), never from git.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? = System.getenv(env) ?: keystoreProps.getProperty(prop)

android {
    namespace = "com.ahuva.ipfinder"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ahuva.ipfinder"
        minSdk = 21
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            val store = signingValue("IPFINDER_KEYSTORE_FILE", "storeFile")
            if (store != null) {
                storeFile = file(store)
                storePassword = signingValue("IPFINDER_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("IPFINDER_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("IPFINDER_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val release = signingConfigs.getByName("release")
            signingConfig = if (release.storeFile != null) release else signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    // One universal APK: pure Java/no native code, so it runs on every ABI (arm, arm64, x86, x86_64).
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
        disable += setOf("SetTextI18n", "HardcodedText", "ObsoleteSdkInt", "GradleDependency", "OldTargetApi", "ExpiredTargetSdkVersion")
    }

    packaging {
        resources.excludes += setOf("META-INF/*.version", "META-INF/*.kotlin_module", "kotlin/**", "DebugProbesKt.bin")
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
