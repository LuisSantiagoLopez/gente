# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class ** { *** Companion; *; }
-keepclasseswithmembers class **$$serializer { *; }
# SQLCipher uses JNI
-keep class net.zetetic.database.** { *; }
-dontwarn javax.annotation.**
-dontwarn com.google.errorprone.annotations.**
