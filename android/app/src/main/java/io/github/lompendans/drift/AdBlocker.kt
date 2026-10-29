package io.github.lompendans.drift

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class FilterList(val id: String, val name: String, val group: String, val url: String, val defaultOn: Boolean)
class ListStatus { var rules = 0; var updated = 0L; var state = "missing" }

/**
 * Keeps the uBlock Origin / EasyList filter lists: downloads them, caches them in the app's storage, refreshes them
 * every few days, and rebuilds the filter engine in the background. The same lists as desktop Drift.
 */
class AdBlocker(private val dir: File, private val onChanged: () -> Unit) {
    companion object {
        val lists = listOf(
            FilterList("ublock-ads", "uBlock filters – Ads", "Ads", "https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt", true),
            FilterList("easylist", "EasyList", "Ads", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist.txt", true),
            FilterList("peter-lowe", "Peter Lowe's ad and tracking server list", "Ads", "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext", true),
            FilterList("ublock-privacy", "uBlock filters – Privacy", "Privacy", "https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt", true),
            FilterList("easyprivacy", "EasyPrivacy", "Privacy", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easyprivacy.txt", true),
            FilterList("ublock-annoyances", "uBlock filters – Annoyances", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/filters/annoyances.txt", true),
            FilterList("easylist-annoyances", "EasyList – Annoyances", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-annoyances.txt", true),
            FilterList("easylist-cookies", "EasyList – Cookie notices", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-cookies.txt", true),
            FilterList("easylist-newsletters", "EasyList – Newsletter notices", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-newsletters.txt", true),
            FilterList("easylist-notifications", "EasyList – Notification prompts", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-notifications.txt", true),
            FilterList("easylist-social", "EasyList – Social widgets", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-social.txt", true),
            FilterList("ublock-badware", "uBlock filters – Badware risks", "Security", "https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt", true),
            FilterList("ublock-quick-fixes", "uBlock filters – Quick fixes", "Security", "https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt", true),
            FilterList("ublock-unbreak", "uBlock filters – Unbreak", "Security", "https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt", true),
            FilterList("url-tracking", "AdGuard/uBO – URL tracking protection", "Optional", "https://ublockorigin.github.io/uAssetsCDN/filters/privacy-removeparam.txt", false),
            FilterList("lan-block", "uBlock filters – Block outsider intrusion into LAN", "Optional", "https://ublockorigin.github.io/uAssetsCDN/filters/lan-block.txt", false),
        )
        // used until the downloaded lists are available (first run, or offline)
        private val builtin = listOf("doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com", "adservice.google.com",
            "2mdn.net", "google-analytics.com", "scorecardresearch.com", "quantserve.com", "hotjar.com", "clarity.ms", "bat.bing.com",
            "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "criteo.com", "criteo.net", "rubiconproject.com", "pubmatic.com",
            "openx.net", "casalemedia.com", "3lift.com", "teads.tv", "smartadserver.com", "adform.net", "media.net", "moatads.com",
            "adsafeprotected.com", "doubleverify.com", "taboola.com", "outbrain.com", "revcontent.com", "mgid.com", "popads.net",
            "propellerads.com", "exoclick.com", "demdex.net", "bluekai.com", "krxd.net", "chartbeat.com")
        private const val REFRESH_DAYS = 4
    }

    @Volatile var engine: FilterEngine = FilterEngine.build(emptyList(), null, builtin); private set
    val status = lists.associate { it.id to ListStatus() }
    @Volatile var busy = false; private set
    private val worker = Executors.newSingleThreadExecutor()

    init {
        for (l in lists) fileFor(l.id).takeIf { it.exists() }?.let { status.getValue(l.id).apply { state = "ok"; updated = it.lastModified() } }
    }

    private fun fileFor(id: String) = File(dir, "$id.txt")

    /** Loads cached lists right away, then downloads any that are missing or stale (all of them when forced). */
    fun refresh(enabled: Set<String>, force: Boolean) = worker.execute {
        busy = true
        onChanged()
        rebuild(enabled)
        var downloaded = false
        for (l in lists.filter { it.id in enabled }) {
            val st = status.getValue(l.id)
            if (!force && st.updated > 0 && (System.currentTimeMillis() - st.updated) / 86_400_000.0 < REFRESH_DAYS) continue
            st.state = "downloading"
            onChanged()
            try {
                val text = download(l.url, 0)
                if (text.length < 200) throw IllegalStateException("List looks empty")
                dir.mkdirs()
                fileFor(l.id).writeText(text)
                st.state = "ok"; st.updated = System.currentTimeMillis()
                downloaded = true
            } catch (e: Exception) {
                st.state = if (fileFor(l.id).exists()) "error-cached" else "error"
            }
            onChanged()
        }
        if (downloaded) rebuild(enabled)
        busy = false
        onChanged()
    }

    private fun fetch(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "Drift/2")
        c.connectTimeout = 15000; c.readTimeout = 30000
        try {
            if (c.responseCode !in 200..299) throw IllegalStateException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().readText()
        } finally { c.disconnect() }
    }

    // some lists are split into parts with "!#include other-file.txt" (relative to the list's own address)
    private fun download(url: String, depth: Int): String {
        val text = fetch(url)
        if (depth >= 3 || !text.contains("!#include ")) return text
        val sb = StringBuilder()
        for (line in text.lineSequence()) {
            val t = line.trim()
            if (t.startsWith("!#include ")) {
                val part = t.substring(10).trim()
                if (part.contains("..") || part.contains("://")) continue
                try { sb.append(download(URL(URL(url), part).toString(), depth + 1)).append('\n') } catch (e: Exception) { }
            } else sb.append(line).append('\n')
        }
        return sb.toString()
    }

    private fun rebuild(enabled: Set<String>) {
        val texts = lists.filter { it.id in enabled }.mapNotNull { l -> fileFor(l.id).takeIf { it.exists() }?.let { l.id to it.readText() } }
        val counts = HashMap<String, Int>()
        engine = FilterEngine.build(texts, counts, builtin)
        for (l in lists) status.getValue(l.id).rules = counts[l.id] ?: 0
        onChanged()
    }
}
