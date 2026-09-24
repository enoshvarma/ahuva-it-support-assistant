# Capacitor bridge and plugins (looked up by annotation/reflection)
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.ActivityCallback *;
    @com.getcapacitor.annotation.PermissionCallback *;
}
-keep class com.capacitorjs.plugins.** { *; }
-dontwarn com.getcapacitor.**

# Ahuva native code
-keep class com.ahuva.itsupport.** { *; }

# JSch loads ciphers, KEX and MACs by class name
-keep class com.jcraft.jsch.** { *; }
-dontwarn com.jcraft.jsch.**
-dontwarn org.ietf.jgss.**
-dontwarn com.sun.jna.**
-dontwarn org.newsclub.**
-dontwarn org.bouncycastle.**
-dontwarn org.apache.logging.**
-dontwarn org.slf4j.**

# usb-serial-for-android instantiates drivers reflectively from its probe table
-keep class com.hoho.android.usbserial.** { *; }

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keepattributes SourceFile,LineNumberTable,*Annotation*
-renamesourcefileattribute SourceFile
