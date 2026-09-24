# Capacitor
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-dontwarn com.getcapacitor.**

# Ahuva custom plugins
-keep class com.ahuva.itsupport.plugins.** { *; }

# JSch SSH library
-keep class com.jcraft.jsch.** { *; }
-dontwarn com.jcraft.jsch.**

# WebView JavaScript interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep source file names for crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
