package io.github.lompendans.drift

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.time.Instant

class HistoryItem(val url: String, var title: String?, var favicon: String?, var visits: Int, var last: Long) {
    // recent pages and often-visited ones rank first
    val score get() = visits / (1 + (System.currentTimeMillis() - last) / 86_400_000.0 / 7)
}
class Bookmark(val url: String, var title: String, val folder: String = "", var favicon: String? = null, val added: Long = System.currentTimeMillis())
class SessionTab(val url: String, val title: String?, val favicon: String?)
class SavedPermission(val origin: String, val kind: String, val state: String)
class DownloadRecord(val id: Long, val url: String, val name: String, val started: Long)

/** Everything Drift remembers, in state.json in the app's own storage. The names match desktop Drift's state.json. */
class Store(private val file: File) {
    var searchEngine = "google"
    var theme = "system"
    var adblockEnabled = true
    val adblockAllowed = mutableListOf<String>()
    var adsBlockedTotal = 0L
    var filterLists: MutableList<String>? = null
    var desktopSites = mutableListOf<String>()
    var session = mutableListOf<SessionTab>()
    var activeIndex = 0
    var history = mutableListOf<HistoryItem>()
    val bookmarks = mutableListOf<Bookmark>()
    val permissions = mutableListOf<SavedPermission>()
    val downloads = mutableListOf<DownloadRecord>()

    companion object {
        val engines = linkedMapOf(
            "google" to "https://www.google.com/search?q=",
            "bing" to "https://www.bing.com/search?q=",
            "duckduckgo" to "https://duckduckgo.com/?q=",
            "brave" to "https://search.brave.com/search?q=",
        )
        const val HISTORY_LIMIT = 5000

        private fun time(s: String?): Long = try { if (s.isNullOrEmpty()) 0 else Instant.parse(s).toEpochMilli() } catch (e: Exception) { 0 }
        private fun iso(t: Long) = Instant.ofEpochMilli(t).toString()
        private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k) else null

        fun load(file: File): Store {
            val s = Store(file)
            try {
                if (!file.exists()) return s
                val o = JSONObject(file.readText())
                s.searchEngine = o.str("SearchEngine") ?: s.searchEngine
                s.theme = o.str("Theme") ?: s.theme
                s.adblockEnabled = o.optBoolean("AdblockEnabled", true)
                o.optJSONArray("AdblockAllowed")?.let { a -> for (i in 0 until a.length()) s.adblockAllowed.add(a.getString(i)) }
                s.adsBlockedTotal = o.optLong("AdsBlockedTotal")
                o.optJSONArray("FilterLists")?.let { a -> s.filterLists = MutableList(a.length()) { a.getString(it) } }
                o.optJSONArray("DesktopSites")?.let { a -> for (i in 0 until a.length()) s.desktopSites.add(a.getString(i)) }
                o.optJSONArray("Session")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { t -> t.str("Url")?.let { u -> s.session.add(SessionTab(u, t.str("Title"), t.str("Favicon"))) } } }
                s.activeIndex = o.optInt("ActiveIndex")
                o.optJSONArray("History")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { h -> h.str("Url")?.let { u -> s.history.add(HistoryItem(u, h.str("Title"), h.str("Favicon"), h.optInt("Visits", 1), time(h.str("Last")))) } } }
                o.optJSONArray("Bookmarks")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { b -> b.str("Url")?.let { u -> s.bookmarks.add(Bookmark(u, b.str("Title") ?: u, b.str("Folder") ?: "", b.str("Favicon"), time(b.str("Added")))) } } }
                o.optJSONArray("Permissions")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { p -> s.permissions.add(SavedPermission(p.optString("Origin"), p.optString("Kind"), p.optString("State"))) } }
                o.optJSONArray("Downloads")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { d -> s.downloads.add(DownloadRecord(d.optLong("Id"), d.optString("Url"), d.optString("Name"), time(d.str("Started")))) } }
            } catch (e: Exception) { }
            return s
        }
    }

    val searchUrl get() = engines[searchEngine] ?: engines.getValue("google")

    fun save() {
        try {
            val o = JSONObject()
            o.put("SearchEngine", searchEngine).put("Theme", theme).put("AdblockEnabled", adblockEnabled)
            o.put("AdblockAllowed", JSONArray(adblockAllowed)).put("AdsBlockedTotal", adsBlockedTotal)
            o.put("FilterLists", filterLists?.let { JSONArray(it) } ?: JSONObject.NULL)
            o.put("DesktopSites", JSONArray(desktopSites))
            o.put("Session", JSONArray(session.map { JSONObject().put("Url", it.url).put("Title", it.title).put("Favicon", it.favicon) }))
            o.put("ActiveIndex", activeIndex)
            o.put("History", JSONArray(history.map { JSONObject().put("Url", it.url).put("Title", it.title).put("Favicon", it.favicon).put("Visits", it.visits).put("Last", iso(it.last)) }))
            o.put("Bookmarks", JSONArray(bookmarks.map { JSONObject().put("Url", it.url).put("Title", it.title).put("Folder", it.folder).put("Favicon", it.favicon).put("Added", iso(it.added)) }))
            o.put("Permissions", JSONArray(permissions.map { JSONObject().put("Origin", it.origin).put("Kind", it.kind).put("State", it.state) }))
            o.put("Downloads", JSONArray(downloads.map { JSONObject().put("Id", it.id).put("Url", it.url).put("Name", it.name).put("Started", iso(it.started)) }))
            val tmp = File(file.path + ".tmp")
            tmp.writeText(o.toString())
            tmp.renameTo(file)
        } catch (e: Exception) { }
    }

    fun addHistory(url: String, title: String?, favicon: String?) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        val h = history.find { it.url == url } ?: HistoryItem(url, null, null, 0, 0).also { history.add(it) }
        h.visits++
        h.last = System.currentTimeMillis()
        if (!title.isNullOrBlank()) h.title = title
        if (favicon != null) h.favicon = favicon
        if (history.size > HISTORY_LIMIT) history = history.sortedByDescending { it.score }.take(HISTORY_LIMIT - 500).toMutableList()
    }

    fun saved(origin: String, kind: String) = permissions.find { it.origin == origin && it.kind == kind }?.state

    fun setPermission(origin: String, kind: String, state: String?) {
        permissions.removeAll { it.origin == origin && it.kind == kind }
        if (state == "allow" || state == "block") permissions.add(SavedPermission(origin, kind, state))
    }

    fun suggestions(): JSONArray = JSONArray(history.sortedByDescending { it.last }.take(600).map {
        JSONObject().put("url", it.url).put("title", it.title).put("favicon", it.favicon).put("score", it.score)
    })

    fun topSites(n: Int): JSONArray {
        class G(val host: String, var score: Double, var best: HistoryItem)
        val groups = LinkedHashMap<String, G>()
        for (h in history) {
            val host = try { URI(h.url).host } catch (e: Exception) { null } ?: continue
            val g = groups.getOrPut(host) { G(host, 0.0, h) }
            g.score += h.score
            if (h.visits > g.best.visits) g.best = h
        }
        return JSONArray(groups.values.sortedByDescending { it.score }.take(n).map {
            val u = URI(it.best.url)
            JSONObject().put("url", "${u.scheme}://${u.authority}/").put("name", it.host.removePrefix("www.")).put("favicon", it.best.favicon)
        })
    }
}
