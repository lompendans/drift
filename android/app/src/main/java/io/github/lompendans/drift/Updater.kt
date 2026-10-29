package io.github.lompendans.drift

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Keeps Drift up to date from its GitHub releases: checks for a newer version, downloads Drift-android.apk in the
 * background, checks it against the SHA-256 GitHub publishes, and hands it to Android's installer when the user agrees.
 * Android only installs it over Drift when it's signed with the same key.
 */
class Updater(private val context: Context, private val onChanged: () -> Unit) {
    companion object {
        const val REPO = "lompendans/drift"
        const val ASSET = "Drift-android.apk"
    }

    var state = "idle"; private set          // idle, checking, latest, downloading, ready, error
    var latest: String? = null; private set
    var error: String? = null; private set
    var percent = 0; private set
    private var file: File? = null
    private val worker = Executors.newSingleThreadExecutor()
    private val current = BuildConfig.VERSION_NAME

    private fun set(s: String) { state = s; if (s != "error") error = null; onChanged() }

    private fun parse(v: String?) = Regex("^v?(\\d+)\\.(\\d+)(?:\\.(\\d+))?").find(v ?: "")?.groupValues?.let { listOf(it[1].toInt(), it[2].toInt(), it[3].ifEmpty { "0" }.toInt()) }
    private fun newer(a: List<Int>, b: List<Int>): Boolean { for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]; return false }

    private fun open(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        setRequestProperty("User-Agent", "Drift/$current (Android)")
        setRequestProperty("Accept", "application/vnd.github+json")
        connectTimeout = 15000; readTimeout = 30000
    }

    fun check() {
        if (state == "checking" || state == "downloading" || state == "ready") return
        set("checking")
        worker.execute {
            try {
                val c = open("https://api.github.com/repos/$REPO/releases/latest")
                val rel = try { JSONObject(c.inputStream.bufferedReader().readText()) } finally { c.disconnect() }
                val v = parse(rel.optString("tag_name")) ?: throw IllegalStateException("Unreadable version")
                latest = v.joinToString(".")
                if (!newer(v, parse(current)!!)) { set("latest"); return@execute }
                val assets = rel.getJSONArray("assets")
                val asset = (0 until assets.length()).map { assets.getJSONObject(it) }.find { it.optString("name") == ASSET }
                    ?: throw IllegalStateException("The release has no Android app")
                val digest = asset.optString("digest")
                if (!digest.startsWith("sha256:")) throw IllegalStateException("The release has no checksum")
                val dir = File(context.cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                val target = File(dir, "Drift-$latest.apk")
                percent = 0
                set("downloading")
                val dl = open(asset.getString("browser_download_url"))
                val total = dl.contentLengthLong.takeIf { it > 0 } ?: asset.optLong("size")
                val sha = MessageDigest.getInstance("SHA-256")
                var got = 0L
                try {
                    dl.inputStream.use { input -> target.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            sha.update(buf, 0, n); out.write(buf, 0, n); got += n
                            val p = if (total > 0) (got * 100 / total).toInt() else 0
                            if (p != percent) { percent = p; onChanged() }
                        }
                    } }
                } finally { dl.disconnect() }
                val actual = sha.digest().joinToString("") { "%02x".format(it) }
                if (actual != digest.removePrefix("sha256:").lowercase()) { target.delete(); throw IllegalStateException("The download didn't match its checksum") }
                file = target
                set("ready")
            } catch (e: Exception) {
                error = if (e is java.io.IOException) "Couldn't reach GitHub" else e.message
                set("error")
            }
        }
    }

    /** Opens Android's installer for the downloaded update (or the setting that allows it, the first time). */
    fun apply(): Boolean {
        val f = file ?: return false
        if (state != "ready" || !f.exists()) return false
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return false
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    fun dto(): JSONObject = JSONObject().put("type", "update").put("state", state).put("current", current).put("latest", latest).put("percent", percent).put("error", error)
}
