# The UI and pages call these from JavaScript; keep their names.
-keepclassmembers class io.github.lompendans.drift.** {
    @android.webkit.JavascriptInterface <methods>;
}
