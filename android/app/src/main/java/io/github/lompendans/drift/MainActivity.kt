package io.github.lompendans.drift

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Base64
import android.view.Gravity
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.IDN
import java.net.URI

class Tab(val id: Int, var url: String, var title: String, var favicon: String?) {
    var view: WebView? = null          // null while the tab is asleep (restored but not opened yet)
    var loading = false
    var progress = 0
    @Volatile var pageUrl = ""; @Volatile var pageHost = ""; @Volatile var pageSite = ""
    @Volatile var exempt = false; @Volatile var hideOff = 0
    var proceedUrl: String? = null     // badware page the user chose to open anyway
    var error: JSONObject? = null      // set while the page failed to load; the UI shows Drift's error card
    @Volatile var blocked = 0
    val blockedSites = HashMap<String, Int>()
    val permissions = mutableListOf<PendingPermission>()
    var opener: Tab? = null            // the tab that opened this one; Back returns there
    var desktop = false
    var thumb: String? = null
    var committed = false
}

class PendingPermission(val origin: String, val kind: String, val waiting: MutableList<(Boolean) -> Unit> = mutableListOf())
class PendingDialog(val id: Int, val tab: Tab?, val kind: String, val origin: String, val message: String, val text: String = "",
                    val answer: (ok: Boolean, text: String?, password: String?) -> Unit)

/**
 * Drift for Android. Like desktop Drift, the interface (bottom bar, tab grid, menus, panels, dialogs) is one web page
 * (assets/ui/mobile.html) and pages show in their own web views inside a rounded "card" above it. When a panel opens,
 * the interface covers the whole screen over a blurred picture of the page.
 */
class MainActivity : Activity() {
    companion object {
        const val HOST = "drift.local"
        const val NEW_TAB = "https://drift.local/pages/newtab.html"
        private const val REQ_FILES = 10
        private const val REQ_PERMS = 11
        private val DOWNLOADABLE = Regex("^https?://", RegexOption.IGNORE_CASE)
    }

    private lateinit var store: Store
    private lateinit var blocker: AdBlocker
    private lateinit var updater: Updater
    private lateinit var root: FrameLayout
    private lateinit var card: FrameLayout
    private lateinit var ui: WebView
    private lateinit var assets: WebViewAssetLoader
    private val main = Handler(Looper.getMainLooper())
    private val tabs = mutableListOf<Tab>()
    private val recent = mutableListOf<Tab>()
    private val closed = ArrayDeque<String>()
    private var active: Tab? = null
    private var nextTab = 0
    private var uiProxy: JavaScriptReplyProxy? = null
    private var full = false              // the interface covers the screen (a panel, dialog or error card is showing)
    private var barDp = 64
    private var topInset = 0; private var bottomInset = 0; private var imeInset = 0
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var permissionAfter: ((Boolean) -> Unit)? = null
    private val dialogs = mutableListOf<PendingDialog>()
    private var nextDialog = 0
    private val density get() = resources.displayMetrics.density
    private val dark get() = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    private val pageColor get() = if (dark) Color.rgb(32, 33, 36) else Color.WHITE
    private val bgColor get() = if (dark) Color.rgb(22, 23, 26) else Color.rgb(237, 239, 242)

    // ---------------- startup ----------------

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)   // chrome://inspect, for development builds only
        store = Store.load(File(filesDir, "state.json"))
        Look.setLanguage(store.language)
        Look.accent = store.accent
        Look.square = store.corners == "square"
        applyTheme()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= 30) window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS

        assets = WebViewAssetLoader.Builder().setDomain(HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))   // https://drift.local/ui/… is assets/ui/…
            .build()

        root = FrameLayout(this).apply { setBackgroundColor(bgColor) }
        card = FrameLayout(this).apply {
            setBackgroundColor(pageColor)
            clipToOutline = true
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) { outline.setRoundRect(0, 0, view.width, view.height, if (Look.square) 0f else 16 * density) }
            }
        }
        ui = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.textZoom = 100
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = assets.shouldInterceptRequest(request.url)
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            }
        }
        WebViewCompat.addWebMessageListener(ui, "driftUi", setOf("https://$HOST")) { _, message, _, isMainFrame, proxy ->
            if (isMainFrame) onUiMessage(message.data ?: return@addWebMessageListener, proxy)
        }
        root.addView(card, FrameLayout.LayoutParams(-1, -1))
        root.addView(ui, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        applyColors()

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            topInset = bars.top; bottomInset = bars.bottom; imeInset = (ime.bottom - bars.bottom).coerceAtLeast(0)
            layoutViews()
            sendInsets()
            insets
        }

        blocker = AdBlocker(File(filesDir, "filters")) { main.post { sendFilters(); if (full) sendShieldDetails() } }
        updater = Updater(this) { main.post { send(updater.dto()) } }
        ui.loadUrl("https://$HOST/ui/mobile.html")

        if (Build.VERSION.SDK_INT >= 33) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        handleIntent(intent, restoring = true)
        blocker.refresh(enabledLists(), false)
        main.postDelayed(object : Runnable { override fun run() { updater.check(); main.postDelayed(this, 6 * 3600_000L) } }, 8000)
    }

    // light / dark changed (Drift keeps running): recolor what Drift draws itself; pages and the UI follow by themselves
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyColors()
    }

    private fun applyColors() {
        root.setBackgroundColor(bgColor)
        card.setBackgroundColor(pageColor)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent, restoring = false) }

    // links and searches from other apps open in a new tab
    private fun handleIntent(intent: Intent?, restoring: Boolean) {
        val url = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_WEB_SEARCH -> intent.getStringExtra("query")?.let { resolve(it) }
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let { resolve(it.trim()) }
            else -> null
        }
        if (restoring) restoreSession()
        if (url != null) newTab(url, active, opener = null)
    }

    private fun applyTheme() {
        if (Build.VERSION.SDK_INT >= 31) {
            val mode = when (store.theme) { "light" -> UiModeManager.MODE_NIGHT_NO; "dark" -> UiModeManager.MODE_NIGHT_YES; else -> UiModeManager.MODE_NIGHT_AUTO }
            (getSystemService(UI_MODE_SERVICE) as UiModeManager).setApplicationNightMode(mode)
        }
    }

    private fun restoreSession() {
        for (s in store.session) tabs.add(Tab(++nextTab, s.url, s.title ?: displayUrl(s.url), s.favicon))
        if (tabs.isEmpty()) tabs.add(Tab(++nextTab, NEW_TAB, Look.t("New Tab"), null))
        recent.addAll(tabs)
        activate(tabs[store.activeIndex.coerceIn(0, tabs.size - 1)])
    }

    override fun onPause() {
        super.onPause()
        saveState()
        CookieManager.getInstance().flush()
    }

    private fun saveState() {
        store.session = tabs.map { SessionTab(it.url, it.title, it.favicon) }.toMutableList()
        store.activeIndex = tabs.indexOf(active).coerceAtLeast(0)
        store.save()
    }

    private val saveRunnable = Runnable { saveState() }
    private fun queueSave() { main.removeCallbacks(saveRunnable); main.postDelayed(saveRunnable, 1500) }

    // ---------------- layout ----------------

    /** The page card sits between the status bar and Drift's bar; the interface covers just the bar, or everything. */
    private fun layoutViews() {
        val barPx = (barDp * density).toInt() + bottomInset
        val uiLp = ui.layoutParams as FrameLayout.LayoutParams
        uiLp.height = if (full) ViewGroup.LayoutParams.MATCH_PARENT else barPx
        uiLp.gravity = Gravity.BOTTOM
        ui.layoutParams = uiLp
        val cardLp = card.layoutParams as FrameLayout.LayoutParams
        cardLp.topMargin = topInset
        // typing in a page: the keyboard covers Drift's bar, so the page ends at the keyboard
        cardLp.bottomMargin = if (imeInset > 0 && !full) imeInset + bottomInset else barPx
        card.layoutParams = cardLp
        val show = !full && active?.error == null
        active?.view?.visibility = if (show) View.VISIBLE else View.INVISIBLE
    }

    private fun sendInsets() = send(JSONObject().put("type", "insets").put("top", topInset / density).put("bottom", bottomInset / density).put("ime", imeInset / density))

    private fun setFull(on: Boolean) {
        if (full == on) return
        full = on
        layoutViews()
        if (!on) active?.view?.requestFocus()
    }

    // ---------------- tabs ----------------

    private fun newTab(url: String?, after: Tab?, opener: Tab?, activate: Boolean = true): Tab {
        val t = Tab(++nextTab, url ?: NEW_TAB, if (url == null) Look.t("New Tab") else displayUrl(url), null)
        t.opener = opener
        tabs.add(if (after != null && after in tabs) tabs.indexOf(after) + 1 else tabs.size, t)
        if (activate) activate(t) else sendTabs()
        queueSave()
        return t
    }

    private fun activate(t: Tab) {
        val prev = active
        if (prev != null && prev != t && prev.view?.visibility == View.VISIBLE) captureThumb(prev)
        active = t
        recent.remove(t); recent.add(0, t)
        if (t.view == null) wake(t)
        for (x in tabs) x.view?.visibility = if (x == t && !full && x.error == null) View.VISIBLE else View.INVISIBLE
        t.view?.onResume()
        tabs.filter { it != t }.forEach { it.view?.onPause() }
        sendTabs(); sendNav(); sendShield()
        queueSave()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun wake(t: Tab, adopt: WebView? = null): WebView {
        val v = adopt ?: WebView(this)
        t.view = v
        // pages start on white like in Chrome; a site that supports dark mode paints its own background
        v.setBackgroundColor(Color.WHITE)
        v.visibility = View.INVISIBLE
        val s = v.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.setSupportMultipleWindows(true)
        s.javaScriptCanOpenWindowsAutomatically = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.userAgentString = userAgent(t.desktop)
        CookieManager.getInstance().setAcceptThirdPartyCookies(v, true)
        // don't tell every site Drift's app name (Google sign-in refuses apps that look like embedded views)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) WebSettingsCompat.setRequestedWithHeaderOriginAllowList(s, emptySet())
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) WebViewCompat.addDocumentStartJavaScript(v, pageScript, setOf("*"))
        WebViewCompat.addWebMessageListener(v, "driftPage", setOf("*")) { view, message, origin, isMainFrame, proxy ->
            onPageMessage(t, view, message, origin.toString(), isMainFrame, proxy)
        }
        v.webViewClient = PageClient(t)
        v.webChromeClient = PageChrome(t)
        v.setDownloadListener { url, ua, disposition, mime, _ -> download(t, url, ua, disposition, mime) }
        v.setOnLongClickListener { onLongPress(t, v) }
        card.addView(v, FrameLayout.LayoutParams(-1, -1))
        if (adopt == null) navigate(t, t.url)
        return v
    }

    private fun closeTab(t: Tab) {
        val i = tabs.indexOf(t)
        if (i < 0) return
        dropPrompts(t, dialogsToo = true)
        if (!isNewTab(t.url)) closed.addLast(t.url)
        tabs.removeAt(i); recent.remove(t)
        t.view?.let { card.removeView(it); it.destroy() }
        t.view = null
        if (tabs.isEmpty()) { newTab(null, null, null); return }
        if (t == active) activate(t.opener?.takeIf { it in tabs } ?: recent.firstOrNull { it in tabs } ?: tabs[minOf(i, tabs.size - 1)])
        else sendTabs()
        queueSave()
    }

    private fun navigate(t: Tab, urlIn: String) {
        var url = urlIn
        // pages on the badware list stop before they open; tracking parameters are removed
        val decision = checkDocument(t, url)
        if (decision != null) url = decision
        t.url = url
        val v = t.view ?: run { wake(t); return }
        v.settings.userAgentString = userAgent(t.desktop)
        v.loadUrl(url)
    }

    private fun go(input: String?, newTab: Boolean) {
        val url = resolve(input) ?: run { if (newTab) newTab(null, active, null); return }
        val a = active
        if (newTab || a == null) newTab(url, a, null) else navigate(a, url)
    }

    private fun resolve(inputIn: String?): String? {
        val input = inputIn?.trim().orEmpty()
        if (input.isEmpty()) return null
        if (Regex("^(https?|file|about|view-source|data):", RegexOption.IGNORE_CASE).containsMatchIn(input)) return input
        val hostLike = !input.contains(' ') && (input.startsWith("localhost") ||
            Regex("^[\\p{L}\\p{N}_-]+(\\.[\\p{L}\\p{N}_-]+)+(:\\d+)?(/.*)?$").matches(input) || Regex("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?(/.*)?$").matches(input))
        if (hostLike) return (if (input.startsWith("localhost") || input[0].isDigit()) "http://" else "https://") + input
        return store.searchUrl + Uri.encode(input)
    }

    private fun isNewTab(url: String?) = url != null && url.startsWith(NEW_TAB)
    private fun displayUrl(url: String?) = if (isNewTab(url)) "" else url.orEmpty()

    private fun userAgent(desktop: Boolean): String {
        val chrome = Regex("Chrome/(\\d+)").find(WebSettings.getDefaultUserAgent(this))?.groupValues?.get(1) ?: "140"
        val v = BuildConfig.VERSION_NAME
        // like Chrome's own (reduced) user agent, without WebView's "wv" marker, plus Drift's name
        return if (desktop) "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chrome.0.0.0 Safari/537.36 Drift/$v"
        else "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chrome.0.0.0 Mobile Safari/537.36 Drift/$v"
    }

    private fun handleBack() {
        if (customView != null) { customCallback?.onCustomViewHidden(); return }
        if (full && active?.error == null) { send(JSONObject().put("type", "back")); return }
        val t = active ?: return
        val v = t.view
        when {
            full && t.error != null && v?.canGoBack() == true -> { t.error = null; v.goBack(); layoutViews() }
            v?.canGoBack() == true -> v.goBack()
            t.opener != null && t.opener in tabs -> closeTab(t)
            else -> moveTaskToBack(true)
        }
    }

    @Deprecated("Android 12 and older")
    override fun onBackPressed() = handleBack()

    // ---------------- messages: host -> UI ----------------

    private fun send(o: JSONObject) {
        val p = uiProxy ?: return
        try { p.postMessage(o.toString()) } catch (e: Exception) { }
    }

    private fun hostOf(url: String?): String = try {
        val u = URI(url)
        (IDN.toUnicode(u.host ?: "")).removePrefix("www.").let { if (u.port > 0) "$it:${u.port}" else it }
    } catch (e: Exception) { url.orEmpty() }

    private fun originOf(url: String?): String = try { URI(url).let { "${it.scheme}://${it.authority}" } } catch (e: Exception) { url.orEmpty() }

    private fun tabDto(t: Tab) = JSONObject().put("id", t.id).put("title", t.title).put("url", displayUrl(t.url)).put("host", hostOf(displayUrl(t.url)))
        .put("favicon", t.favicon).put("loading", t.loading).put("asleep", t.view == null).put("thumb", t.thumb)

    private fun sendTabs() = send(JSONObject().put("type", "tabs").put("active", active?.id ?: 0).put("tabs", JSONArray(tabs.map(::tabDto))))

    private fun tabChanged(t: Tab) { if (t in tabs) { send(JSONObject().put("type", "tab").put("tab", tabDto(t))); if (t == active) sendNav() } }

    private fun sendNav() {
        val t = active
        val v = t?.view
        val url = displayUrl(t?.url)
        send(JSONObject().put("type", "nav").put("url", url).put("host", hostOf(url)).put("secure", url.startsWith("https://"))
            .put("canBack", v?.canGoBack() == true).put("canForward", v?.canGoForward() == true).put("loading", t?.loading == true)
            .put("progress", t?.progress ?: 0).put("error", t?.error ?: JSONObject.NULL).put("prompt", promptDto(t) ?: JSONObject.NULL)
            .put("bookmarked", t != null && isWeb(t.url) && store.bookmarks.any { it.url == t.url }).put("desktop", t?.desktop == true)
            .put("title", t?.title).put("tabCount", tabs.size))
    }

    private fun sendSettings() = send(JSONObject().put("type", "settings").put("engine", store.searchEngine).put("theme", store.theme)
        .put("adblock", if (store.adblockEnabled) "on" else "off").put("version", BuildConfig.VERSION_NAME).put("themeChoice", Build.VERSION.SDK_INT >= 31)
        .put("lang", store.language).put("accent", store.accent).put("corners", store.corners).put("startClock", if (store.startClock) "on" else "off")
        .put("startShortcuts", if (store.startShortcuts) "on" else "off").put("startBg", store.startBackground).put("customShortcuts", store.shortcuts != null))

    private fun startDto() = JSONObject().put("type", "topSites").put("sites", store.startShortcutList()).put("custom", store.shortcuts != null)
        .put("engine", store.searchEngine).put("accent", store.accent).put("corners", store.corners).put("clock", store.startClock).put("shortcuts", store.startShortcuts).put("background", store.startBackground)

    /** Drift's own pages (the start page, the warning) load again, to show a new language or look. */
    private fun reloadDriftPages(onlyStart: Boolean) {
        for (t in tabs) if (t.view != null && (if (onlyStart) isNewTab(t.url) else t.url.startsWith("https://$HOST/"))) t.view?.reload()
    }

    // a web page (Drift's own pages at drift.local don't count)
    private fun isWeb(url: String?) = url != null && (url.startsWith("http://") || url.startsWith("https://")) && !url.startsWith("https://$HOST/")

    // ---------------- messages: UI -> host ----------------

    private fun onUiMessage(data: String, proxy: JavaScriptReplyProxy) {
        val m = try { JSONObject(data) } catch (e: Exception) { return }
        fun str(k: String) = if (m.has(k) && !m.isNull(k)) m.optString(k) else null
        fun byId() = tabs.find { it.id == m.optInt("id") }
        val a = active
        when (m.optString("type")) {
            "ready" -> { uiProxy = proxy; sendInsets(); sendSettings(); sendTabs(); sendNav(); sendShield(); send(updater.dto()) }
            "bar" -> { barDp = m.optInt("height", 64); layoutViews() }
            "full" -> setFull(m.optBoolean("on"))
            "overlay" -> openOverlay(str("kind") ?: "")
            "go" -> if (m.optBoolean("search") && !str("input").isNullOrBlank()) go(store.searchUrl + Uri.encode(str("input")!!.trim()), m.optBoolean("newTab")) else go(str("input"), m.optBoolean("newTab"))
            "newTab" -> newTab(null, a, null)
            "activate" -> byId()?.let { activate(it) }
            "close" -> byId()?.let { closeTab(it) }
            "closeAll" -> { for (t in tabs.toList()) closeTab(t) }
            "reopen" -> closed.removeLastOrNull()?.let { newTab(it, a, null) }
            "back" -> handleBack()
            "forward" -> a?.view?.let { if (it.canGoForward()) it.goForward() }
            "reload" -> a?.let { t -> if (t.error != null) { t.error = null; layoutViews() }; t.view?.reload() ?: wake(t) }
            "stop" -> a?.view?.stopLoading()
            "allowLocalNetwork" -> withAndroidPermission(listOf("android.permission.ACCESS_LOCAL_NETWORK")) { ok ->
                if (ok) a?.let { t -> t.error = null; layoutViews(); t.view?.reload() } else toast("Drift can't reach your local network without it")
            }
            "home" -> a?.let { navigate(it, NEW_TAB) }
            "permission" -> a?.let { answerPermissions(it, str("origin"), str("decision") ?: "dismiss") }
            "dialogReply" -> answerDialog(m.optInt("id"), m.optBoolean("ok"), str("text"), str("password"))
            "toggleBookmark" -> toggleBookmark()
            "getBookmarks" -> send(JSONObject().put("type", "bookmarkList").put("items", JSONArray(store.bookmarks.map {
                JSONObject().put("url", it.url).put("title", it.title).put("folder", it.folder).put("favicon", it.favicon) })))
            "bookmarkDelete" -> { store.bookmarks.removeAll { it.url == str("url") }; queueSave(); sendNav() }
            "getHistory" -> send(JSONObject().put("type", "historyList").put("items", JSONArray(store.history.sortedByDescending { it.last }.take(3000).map {
                JSONObject().put("url", it.url).put("title", it.title).put("favicon", it.favicon).put("last", it.last) })))
            "historyDelete" -> { store.history.removeAll { it.url == str("url") }; queueSave() }
            "historyClear" -> clearData(m.optBoolean("cookies"))
            "getDownloads" -> sendDownloads()
            "download" -> downloadAction(str("action"), m.optLong("id"))
            "share" -> a?.let { share(displayUrl(it.url), it.title) }
            "shareUrl" -> str("url")?.let { share(it, null) }
            "copy" -> str("text")?.let { copy(it) }
            "desktopSite" -> a?.let { t -> t.desktop = !t.desktop; t.view?.let { v -> v.settings.userAgentString = userAgent(t.desktop); v.reload() }; sendNav() }
            "openUrl" -> str("url")?.let { go(it, m.optBoolean("newTab")) }
            "openBackground" -> str("url")?.let { newTab(it, a, opener = null, activate = false); toast("Opened in a new tab") }
            "downloadUrl" -> str("url")?.let { u -> a?.let { download(it, u, userAgent(it.desktop), null, null) } }
            "getShield" -> sendShieldDetails()
            "shieldAllow" -> a?.let { t ->
                if (t.pageSite.isNotEmpty()) {
                    store.adblockAllowed.remove(t.pageSite)
                    if (m.optBoolean("allow")) store.adblockAllowed.add(t.pageSite)
                    queueSave(); t.view?.reload(); sendShield(); sendShieldDetails()
                }
            }
            "getFilters" -> sendFilters()
            "filtersUpdate" -> blocker.refresh(enabledLists(), true)
            "getInfo" -> sendInfo()
            "checkUpdate" -> updater.check()
            "applyUpdate" -> updater.apply()
            "openDownloadPage" -> newTab("https://lompendans.github.io/drift/", a, null)
            "getPermissions" -> sendPermissions()
            "languageChanged" -> { reloadDriftPages(onlyStart = false); if (m.optBoolean("ui")) ui.reload() }
            "permSet" -> { store.setPermission(str("origin") ?: return, str("kind") ?: return, str("state")); queueSave(); sendPermissions() }
            "setting" -> {
                val value = str("value")
                when (str("key")) {
                    "engine" -> if (value != null && value in Store.engines) store.searchEngine = value
                    "adblock" -> if (value == "on" || value == "off") { store.adblockEnabled = value == "on"; a?.view?.reload() }
                    "theme" -> if (value in setOf("system", "light", "dark")) { store.theme = value!!; saveState(); applyTheme() }
                    "lang" -> if (value in setOf("system", "en", "tr")) { store.language = value!!; Look.setLanguage(value) }
                    "accent" -> if (value in Look.accentNames) { store.accent = value!!; Look.accent = value }
                    "corners" -> if (value == "rounded" || value == "square") { store.corners = value; Look.square = value == "square"; card.invalidateOutline() }
                    "startClock" -> store.startClock = value == "on"
                    "startShortcuts" -> store.startShortcuts = value == "on"
                    "startBg" -> if (value == "glow" || value == "plain") store.startBackground = value
                    "shortcuts" -> if (value == "reset") store.shortcuts = null
                }
                if (str("key") in setOf("accent", "corners", "startClock", "startShortcuts", "startBg", "shortcuts", "engine")) reloadDriftPages(onlyStart = true)
                queueSave(); sendSettings(); sendShield()
            }
        }
    }

    /** A panel is opening: freeze a picture of the page for the UI to blur behind it. */
    private fun openOverlay(kind: String) {
        val t = active
        captureCard { data ->
            if (t != null && data != null) t.thumb = thumbOf(data)
            send(JSONObject().put("type", "snapshot").put("kind", kind).put("data", data ?: JSONObject.NULL)
                .put("history", store.suggestions())
                .put("bookmarks", JSONArray(store.bookmarks.take(3000).map { JSONObject().put("url", it.url).put("title", it.title).put("favicon", it.favicon) }))
                .put("tabs", JSONArray(tabs.map(::tabDto))).put("current", displayUrl(t?.url)))
        }
    }

    // ---------------- pictures of pages ----------------

    private var lastShot: Bitmap? = null

    /** Copies what's on screen in the page card (PixelCopy sees what the web view really drew). */
    private fun captureCard(done: (String?) -> Unit) {
        val v = active?.view
        if (v == null || v.visibility != View.VISIBLE || card.width == 0 || card.height == 0) { done(null); return }
        val loc = IntArray(2)
        card.getLocationInWindow(loc)
        val bmp = Bitmap.createBitmap(card.width, card.height, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(window, Rect(loc[0], loc[1], loc[0] + card.width, loc[1] + card.height), bmp, { result ->
                if (result != PixelCopy.SUCCESS) { done(null); return@request }
                lastShot = bmp
                done(jpeg(bmp, 1.0, 70))
            }, main)
        } catch (e: Exception) { done(null) }
    }

    private fun captureThumb(t: Tab) {
        if (t != active) return
        captureCard { data -> if (data != null) t.thumb = thumbOf(data) }
    }

    private fun thumbOf(@Suppress("UNUSED_PARAMETER") full: String): String? = lastShot?.let { jpeg(it, 360.0 / it.width, 60) }

    private fun jpeg(bmp: Bitmap, scale: Double, quality: Int): String {
        val b = if (scale < 0.99) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true) else bmp
        val out = ByteArrayOutputStream()
        b.compress(Bitmap.CompressFormat.JPEG, quality, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    // ---------------- pages ----------------

    // Runs in every page before its own scripts: Drift's own pages get a bridge; web pages report the class and id
    // names they use so Drift can answer with the ad-hiding rules that apply.
    private val pageScript = """
        (() => {
          const host = window.driftPage;
          if (!host) return;
          if (location.origin === "https://$HOST") {
            const ls = [];
            host.onmessage = e => { const m = JSON.parse(e.data); ls.forEach(f => f({ data: m })); };
            window.driftHost = { postMessage: m => host.postMessage(JSON.stringify(m)), addEventListener: (t, f) => { if (t === "message") ls.push(f); } };
            return;
          }
          if (window.top !== window || !/^https?:${'$'}/.test(location.protocol)) return;
          host.onmessage = e => {
            const m = JSON.parse(e.data);
            if (m.type !== "css") return;
            let s = document.getElementById("__drift_hide");
            if (!s) { s = document.createElement("style"); s.id = "__drift_hide"; (document.head || document.documentElement).appendChild(s); }
            s.appendChild(document.createTextNode(m.css));
          };
          const seenC = new Set(), seenI = new Set();
          let pending = [], timer = 0, first = true;
          const note = el => {
            if (el.id && !seenI.has(el.id)) { seenI.add(el.id); pending.push(["i", el.id]); }
            const cl = el.classList;
            if (cl) for (const c of cl) if (!seenC.has(c)) { seenC.add(c); pending.push(["c", c]); }
          };
          const scan = r => { if (r.nodeType !== 1) return; note(r); for (const el of r.querySelectorAll("[id],[class]")) note(el); };
          const flush = () => {
            timer = 0;
            if (!pending.length && !first) return;
            const c = [], i = [];
            for (const [k, v] of pending) (k === "c" ? c : i).push(v);
            pending = [];
            host.postMessage(JSON.stringify({ type: "drift-hide", first, c, i }));
            first = false;
          };
          const later = () => { if (!timer) timer = setTimeout(flush, first ? 0 : 150); };
          new MutationObserver(rs => {
            for (const r of rs) { if (r.type === "attributes") note(r.target); else for (const n of r.addedNodes) scan(n); }
            if (pending.length || first) later();
          }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id"] });
          if (document.documentElement) { scan(document.documentElement); later(); }
        })();
    """.trimIndent()

    private fun onPageMessage(t: Tab, view: WebView, message: WebMessageCompat, origin: String, isMainFrame: Boolean, proxy: JavaScriptReplyProxy) {
        val m = try { JSONObject(message.data ?: return) } catch (e: Exception) { return }
        if (!isMainFrame) return
        when (m.optString("type")) {
            "drift-hide" -> {
                // only the page that's showing gets rules, for its own site
                if (!blockingOn(t) || t.hideOff == 3 || originOf(view.url) != origin) return
                fun names(k: String) = m.optJSONArray(k)?.let { a -> (0 until minOf(a.length(), 5000)).map { a.optString(it) } } ?: emptyList()
                val css = blocker.engine.hideCss(t.pageHost, names("c"), names("i"), m.optBoolean("first"), t.hideOff and 1 == 0, t.hideOff and 2 == 0)
                if (css.isNotEmpty()) proxy.postMessage(JSONObject().put("type", "css").put("css", css).toString())
            }
            else -> {
                if (origin != "https://$HOST") return   // the rest is only for Drift's own pages
                when (m.optString("type")) {
                    "hello" -> proxy.postMessage(startDto().toString())
                    "setShortcuts" -> m.optJSONArray("items")?.let { a ->
                        // web addresses only, at most 12
                        store.shortcuts = (0 until minOf(a.length(), 12)).mapNotNull { i ->
                            val it = a.optJSONObject(i) ?: return@mapNotNull null
                            val url = resolve(it.optString("url").trim())?.takeIf { u -> isWeb(u) && !u.startsWith(store.searchUrl) } ?: return@mapNotNull null
                            Shortcut(it.optString("name").trim().take(60), url)
                        }.toMutableList()
                        queueSave(); sendSettings()
                    }
                    "go" -> resolve(m.optString("input"))?.let { navigate(t, it) }
                    "palette" -> send(JSONObject().put("type", "palette").put("mode", "current"))
                    "proceed" -> m.optString("url").takeIf { isWeb(it) }?.let { t.proceedUrl = it; navigate(t, it) }
                    "back" -> if (view.canGoBack()) view.goBack() else navigate(t, NEW_TAB)
                }
            }
        }
    }

    /** A new page in a tab: its own site is first party, and the blocked count starts over. */
    private fun startPage(t: Tab, url: String) {
        val u = try { URI(url) } catch (e: Exception) { null }
        val web = u != null && (u.scheme == "http" || u.scheme == "https")
        val host = if (web) u!!.host?.lowercase().orEmpty() else ""
        val engine = blocker.engine
        t.pageUrl = url; t.pageHost = host; t.pageSite = if (web) FilterEngine.site(host) else ""
        t.exempt = web && engine.pageAllowed(url, host)
        t.hideOff = if (web) engine.hideOff(url, host) else 0
        if (t.proceedUrl != null && t.proceedUrl != url) t.proceedUrl = null
        t.blocked = 0
        synchronized(t.blockedSites) { t.blockedSites.clear() }
        if (t == active) sendShield()
    }

    /** Before a page opens: the badware warning instead, or the address without tracking parameters (or null: go ahead). */
    private fun checkDocument(t: Tab, url: String): String? {
        if (!store.adblockEnabled || !isWeb(url)) return null
        val host = try { URI(url).host?.lowercase() } catch (e: Exception) { null } ?: return null
        val site = FilterEngine.site(host)
        val engine = blocker.engine
        if (site in store.adblockAllowed || engine.pageAllowed(url, host)) return null
        val bad = if (t.proceedUrl == url) null else engine.matchDocument(url, host)
        if (bad != null) {
            val list = AdBlocker.lists.find { it.id == bad.list }?.name ?: "Your filter lists"
            return "https://$HOST/pages/blocked.html#" + Uri.encode(JSONObject().put("url", url).put("host", host).put("list", list).toString())
        }
        return engine.cleanUrl(url, host)
    }

    private fun blockingOn(t: Tab) = store.adblockEnabled && isWeb(t.url) && !t.exempt && t.pageSite !in store.adblockAllowed

    private fun typeOf(url: String, accept: String?): Int {
        val path = url.substringBefore('?').substringBefore('#').lowercase()
        return when {
            accept?.contains("text/css") == true || path.endsWith(".css") -> T.STYLESHEET
            accept?.startsWith("image/") == true || Regex("\\.(png|jpe?g|gif|webp|svg|ico|avif)$").containsMatchIn(path) -> T.IMAGE
            path.endsWith(".js") || path.endsWith(".mjs") -> T.SCRIPT
            Regex("\\.(woff2?|ttf|otf|eot)$").containsMatchIn(path) -> T.FONT
            Regex("\\.(mp4|webm|m3u8|mp3|ogg|m4a)$").containsMatchIn(path) -> T.MEDIA
            accept?.contains("text/html") == true -> T.SUBDOCUMENT
            else -> T.OTHER or T.XHR or T.SCRIPT
        }
    }

    private val emptyGif = Base64.decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", 0)

    /** Runs for every request a page makes (on a background thread): blocks ads and trackers. */
    private fun filterRequest(t: Tab, request: WebResourceRequest): WebResourceResponse? {
        if (request.isForMainFrame || !blockingOn(t)) return null
        val url = request.url.toString()
        if (url == t.pageUrl || !isWeb(url)) return null
        val host = request.url.host ?: return null
        val site = FilterEngine.site(host)
        val type = typeOf(url, request.requestHeaders["Accept"])
        val rule = blocker.engine.matchRequest(url, host, t.pageHost, site != t.pageSite, type) ?: return null
        t.blocked++
        synchronized(t.blockedSites) { t.blockedSites[site] = (t.blockedSites[site] ?: 0) + 1 }
        store.adsBlockedTotal++
        if (t == active) main.post { queueShield() }
        // "redirect" rules expect a harmless empty file rather than an error
        return if (rule.redirect && type == T.IMAGE) WebResourceResponse("image/gif", null, ByteArrayInputStream(emptyGif))
        else if (rule.redirect) WebResourceResponse("application/javascript", "utf-8", ByteArrayInputStream(ByteArray(0)))
        else WebResourceResponse("text/plain", "utf-8", 403, "Blocked by Drift", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    private val shieldRunnable = Runnable { sendShield(); queueSave() }
    private fun queueShield() { main.removeCallbacks(shieldRunnable); main.postDelayed(shieldRunnable, 300) }

    private fun shieldState(t: Tab?) = when {
        t == null || !isWeb(t.url) -> "none"
        !store.adblockEnabled -> "off"
        t.pageSite in store.adblockAllowed || t.exempt -> "allowed"
        else -> "on"
    }

    private fun sendShield() = send(JSONObject().put("type", "shield").put("state", shieldState(active)).put("count", active?.blocked ?: 0))

    private fun sendShieldDetails() {
        val t = active
        val sites = t?.let { synchronized(it.blockedSites) { it.blockedSites.entries.sortedByDescending { e -> e.value }.take(12).map { e -> JSONObject().put("site", e.key).put("count", e.value) } } } ?: emptyList()
        send(JSONObject().put("type", "shieldDetails").put("state", shieldState(t)).put("site", t?.pageSite ?: "").put("count", t?.blocked ?: 0)
            .put("sites", JSONArray(sites)).put("total", store.adsBlockedTotal).put("rules", blocker.engine.totalRules).put("lists", enabledLists().size))
    }

    private fun enabledLists(): Set<String> = store.filterLists?.toSet() ?: AdBlocker.lists.filter { it.defaultOn }.map { it.id }.toSet()

    private fun sendFilters() {
        val enabled = enabledLists()
        send(JSONObject().put("type", "filters").put("enabled", store.adblockEnabled).put("busy", blocker.busy).put("rules", blocker.engine.totalRules)
            .put("lists", JSONArray(AdBlocker.lists.map { l -> val st = blocker.status.getValue(l.id)
                JSONObject().put("id", l.id).put("name", l.name).put("group", l.group).put("on", l.id in enabled).put("rules", st.rules).put("state", st.state).put("updated", st.updated) })))
    }

    private fun errorFor(code: Int, description: String?, url: String): JSONObject? {
        val desc = description.orEmpty()
        if (desc.contains("ERR_ABORTED")) return null   // stopped, replaced by another page, or a download
        if (!isWeb(url)) return null
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val online = cm.activeNetwork != null
        val kind = when {
            desc.contains("LOCAL_NETWORK_PERMISSION") -> "localnet"
            desc.contains("INTERNET_DISCONNECTED") -> "offline"
            code == WebViewClient.ERROR_HOST_LOOKUP || desc.contains("NAME_NOT_RESOLVED") -> if (online) "dns" else "offline"
            code == WebViewClient.ERROR_CONNECT || desc.contains("CONNECTION_REFUSED") || desc.contains("CONNECTION_RESET") || desc.contains("ADDRESS_UNREACHABLE") -> if (online) "connect" else "offline"
            code == WebViewClient.ERROR_TIMEOUT || desc.contains("TIMED_OUT") -> "timeout"
            code == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE || desc.contains("CERT") || desc.contains("SSL") -> "cert"
            code == WebViewClient.ERROR_REDIRECT_LOOP || desc.contains("TOO_MANY_REDIRECTS") -> "redirect"
            desc.contains("EMPTY_RESPONSE") || desc.contains("INVALID_RESPONSE") -> "response"
            else -> "unknown"
        }
        return JSONObject().put("kind", kind).put("host", hostOf(url)).put("url", url).put("code", desc.removePrefix("net::").removePrefix("ERR_").ifEmpty { code.toString() })
    }

    private fun showError(t: Tab, error: JSONObject) {
        t.error = error
        t.loading = false
        t.title = error.optString("host")
        if (t == active) layoutViews()
        tabChanged(t)
    }

    inner class PageClient(private val t: Tab) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (request.url.host == HOST) return assets.shouldInterceptRequest(request.url)
            return try { filterRequest(t, request) } catch (e: Exception) { null }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            val scheme = request.url.scheme?.lowercase() ?: return true
            if (scheme == "http" || scheme == "https") {
                if (!request.isForMainFrame) return false
                val replacement = checkDocument(t, url) ?: return false
                view.loadUrl(replacement)
                return true
            }
            if (scheme == "about" || scheme == "data" || scheme == "blob" || scheme == "javascript") return false
            // other apps' links (mailto:, tel:, intent:, market:…), only when the user tapped something
            if (request.hasGesture() || !request.isForMainFrame) openExternal(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            dropPrompts(t, dialogsToo = false)
            t.loading = true
            t.progress = 5
            if (!url.startsWith("data:")) t.url = url
            if (t.error != null && url != t.error?.optString("url")) { t.error = null; if (t == active) layoutViews() }
            startPage(t, url)
            tabChanged(t)
        }

        override fun onPageFinished(view: WebView, url: String) {
            t.loading = false
            t.progress = 100
            t.committed = true
            if (t.error == null) {
                if (isWeb(url)) store.addHistory(url, view.title, t.favicon)
                t.title = if (isNewTab(url)) Look.t("New Tab") else view.title?.takeIf { it.isNotBlank() && it != url } ?: displayUrl(url)
            }
            tabChanged(t)
            queueSave()
            if (t == active && !full) main.postDelayed({ captureThumb(t) }, 800)
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            if (!url.startsWith("data:")) t.url = url
            tabChanged(t)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            if (System.currentTimeMillis() - lastDownloadAt < 3000) return   // the link turned into a download
            errorFor(error.errorCode, error.description?.toString(), request.url.toString())?.let { showError(t, it) }
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
            handler.cancel()
            showError(t, JSONObject().put("kind", "cert").put("host", hostOf(error.url)).put("url", error.url).put("code", "CERT_INVALID"))
        }

        override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String?) {
            queueDialog(t, "auth", originOf(view.url ?: "https://$host"), realm.orEmpty()) { ok, user, password ->
                if (ok) handler.proceed(user.orEmpty(), password.orEmpty()) else handler.cancel()
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            card.removeView(view)
            view.destroy()
            t.view = null
            showError(t, JSONObject().put("kind", "unknown").put("host", hostOf(t.url).ifEmpty { "This page" }).put("url", t.url).put("code", if (detail.didCrash()) "RENDERER_CRASHED" else "RENDERER_KILLED"))
            return true
        }
    }

    inner class PageChrome(private val t: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            t.progress = newProgress
            if (t == active) sendNav()
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            if (t.error != null) return
            t.title = if (isNewTab(view.url)) Look.t("New Tab") else title?.takeIf { it.isNotBlank() } ?: displayUrl(view.url)
            tabChanged(t)
        }

        override fun onReceivedIcon(view: WebView, icon: Bitmap) {
            if (isNewTab(view.url)) return
            val small = Bitmap.createScaledBitmap(icon, 32, 32, true)
            val out = ByteArrayOutputStream()
            small.compress(Bitmap.CompressFormat.PNG, 100, out)
            t.favicon = "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            tabChanged(t)
        }

        // a site opened a window: it becomes a new tab, and Back from it returns here
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val nt = newTab(null, t, opener = t, activate = false)
            nt.url = ""
            val v = wake(nt, WebView(this@MainActivity))
            (resultMsg.obj as WebView.WebViewTransport).webView = v
            resultMsg.sendToTarget()
            activate(nt)
            return true
        }

        override fun onCloseWindow(window: WebView) { closeTab(t) }

        override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
            pageDialog(t, "alert", url, message, "") { _, _ -> result.confirm() }
            return true
        }

        override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
            pageDialog(t, "confirm", url, message, "") { ok, _ -> if (ok) result.confirm() else result.cancel() }
            return true
        }

        override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
            pageDialog(t, "prompt", url, message, defaultValue.orEmpty()) { ok, text -> if (ok) result.confirm(text.orEmpty()) else result.cancel() }
            return true
        }

        override fun onJsBeforeUnload(view: WebView, url: String, message: String, result: JsResult): Boolean {
            pageDialog(t, "leave", url, "", "") { ok, _ -> if (ok) result.confirm() else result.cancel() }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            val origin = originOf(request.origin.toString())
            val kinds = mutableListOf<String>()
            val grant = mutableListOf<String>()
            for (r in request.resources) when (r) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> { kinds.add("camera"); grant.add(r) }
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> { kinds.add("microphone"); grant.add(r) }
                PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID -> grant.add(r)
                PermissionRequest.RESOURCE_MIDI_SYSEX -> { kinds.add("midi"); grant.add(r) }
            }
            if (grant.isEmpty()) { request.deny(); return }
            val android = buildList { if ("camera" in kinds) add(Manifest.permission.CAMERA); if ("microphone" in kinds) add(Manifest.permission.RECORD_AUDIO) }
            askSite(t, origin, kinds, android) { ok -> if (ok) request.grant(grant.toTypedArray()) else request.deny() }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            askSite(t, originOf(origin), listOf("location"), listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { ok ->
                callback.invoke(origin, ok, false)
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            customView?.let { callback.onCustomViewHidden(); return }
            customView = view
            customCallback = callback
            root.addView(view, FrameLayout.LayoutParams(-1, -1).apply { gravity = Gravity.CENTER })
            view.setBackgroundColor(Color.BLACK)
            WindowInsetsControllerCompat(window, root).apply {
                hide(WindowInsetsCompat.Type.systemBars())
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }

        override fun onHideCustomView() {
            customView?.let { root.removeView(it) }
            customView = null
            customCallback = null
            WindowInsetsControllerCompat(window, root).show(WindowInsetsCompat.Type.systemBars())
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try { startActivityForResult(params.createIntent(), REQ_FILES); true }
            catch (e: ActivityNotFoundException) { fileCallback = null; false }
        }

        override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    }

    @Deprecated("Activity results")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILES) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    private fun openExternal(url: String) {
        try {
            val intent = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null
            } else Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
            try { startActivity(intent) }
            catch (e: ActivityNotFoundException) {
                // an intent: link can name a web page to show when the app isn't installed
                intent.getStringExtra("browser_fallback_url")?.takeIf { isWeb(it) }?.let { f -> active?.let { navigate(it, f) } } ?: toast("No app can open this link")
            }
        } catch (e: Exception) { toast("No app can open this link") }
    }

    // ---------------- site permissions: the prompt bar ----------------

    /** Asks in the prompt bar (unless the site already has an answer), then asks Android for the app permission it needs. */
    private fun askSite(t: Tab, origin: String, kinds: List<String>, android: List<String>, answer: (Boolean) -> Unit) {
        val states = kinds.map { store.saved(origin, it) }
        val finish: (Boolean) -> Unit = { ok -> if (ok) withAndroidPermission(android, answer) else answer(false) }
        if ("block" in states) { answer(false); return }
        if (kinds.isEmpty() || states.all { it == "allow" }) { finish(true); return }
        var left = kinds.size; var done = false
        for (kind in kinds) {
            val p = t.permissions.find { it.origin == origin && it.kind == kind } ?: PendingPermission(origin, kind).also { t.permissions.add(it) }
            p.waiting.add { allowed ->
                if (!done && (--left == 0 || !allowed)) { done = true; finish(allowed) }
            }
        }
        if (t == active) sendNav()
    }

    private fun withAndroidPermission(perms: List<String>, answer: (Boolean) -> Unit) {
        val missing = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) { answer(true); return }
        permissionAfter = answer
        requestPermissions(missing.toTypedArray(), REQ_PERMS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) {
            val after = permissionAfter
            permissionAfter = null
            after?.invoke(grantResults.isNotEmpty() && grantResults.any { it == PackageManager.PERMISSION_GRANTED })
        }
    }

    /** allow / block are remembered for the site; dismiss only answers this time. */
    private fun answerPermissions(t: Tab, origin: String?, decision: String) {
        for (p in t.permissions.filter { origin == null || it.origin == origin }) {
            if (decision != "dismiss") store.setPermission(p.origin, p.kind, if (decision == "allow") "allow" else "block")
            for (w in p.waiting) try { w(decision == "allow") } catch (e: Exception) { }
            t.permissions.remove(p)
        }
        queueSave()
        if (t == active) sendNav()
    }

    private fun promptDto(t: Tab?): JSONObject? {
        val first = t?.permissions?.firstOrNull() ?: return null
        return JSONObject().put("origin", first.origin).put("host", hostOf(first.origin))
            .put("kinds", JSONArray(t.permissions.filter { it.origin == first.origin }.map { it.kind }))
            .put("more", t.permissions.count { it.origin != first.origin })
    }

    private fun sendPermissions() {
        val sites = store.permissions.groupBy { it.origin }.toSortedMap(compareBy { hostOf(it) })
        send(JSONObject().put("type", "permissions").put("sites", JSONArray(sites.map { (origin, items) ->
            JSONObject().put("origin", origin).put("host", hostOf(origin)).put("items", JSONArray(items.map { JSONObject().put("kind", it.kind).put("state", it.state) }))
        })))
    }

    // ---------------- dialogs ----------------

    /** alert, confirm, prompt and "Leave site?": drawn natively (see DriftDialog for why), one tab at a time. */
    private fun pageDialog(t: Tab, kind: String, url: String, message: String, text: String, answer: (Boolean, String?) -> Unit) {
        if (t != active && t in tabs) activate(t)
        DriftDialog.show(this, kind, hostOf(url), message.take(5000), text.take(5000), answer)
    }

    private fun queueDialog(t: Tab?, kind: String, origin: String, message: String, text: String = "", answer: (Boolean, String?, String?) -> Unit) {
        val d = PendingDialog(++nextDialog, t, kind, origin, message.take(5000), text.take(5000), answer)
        dialogs.add(d)
        if (dialogs.size == 1) showDialog(d)
    }

    private fun showDialog(d: PendingDialog) {
        if (d.tab != null && d.tab != active && d.tab in tabs) activate(d.tab)
        send(JSONObject().put("type", "dialog").put("id", d.id).put("kind", d.kind).put("host", hostOf(d.origin)).put("message", d.message).put("text", d.text))
    }

    private fun answerDialog(id: Int, ok: Boolean, text: String?, password: String?) {
        val d = dialogs.find { it.id == id } ?: return
        val wasShown = dialogs.firstOrNull() == d
        dialogs.remove(d)
        try { d.answer(ok, text, password) } catch (e: Exception) { }
        if (wasShown && dialogs.isNotEmpty()) { val next = dialogs[0]; main.postDelayed({ if (dialogs.firstOrNull() == next) showDialog(next) }, 320) }
    }

    /** A tab is going away (or leaving its page): cancel whatever it was asking. */
    private fun dropPrompts(t: Tab, dialogsToo: Boolean) {
        if (t.permissions.isNotEmpty()) answerPermissions(t, null, "dismiss")
        if (!dialogsToo) return
        for (d in dialogs.filter { it.tab == t }) {
            if (dialogs.firstOrNull() == d) send(JSONObject().put("type", "dialogGone").put("id", d.id))
            answerDialog(d.id, false, null, null)
        }
    }

    // ---------------- long press: links and images ----------------

    private fun onLongPress(t: Tab, v: WebView): Boolean {
        val hit = v.hitTestResult
        val extra = hit.extra ?: return false
        when (hit.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> showLinkMenu(extra, null)
            WebView.HitTestResult.IMAGE_TYPE -> showLinkMenu(null, extra)
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                // an image inside a link: ask the page which link it is
                val msg = main.obtainMessage()
                msg.target = Handler(Looper.getMainLooper()) { m -> showLinkMenu(m.data.getString("url"), extra); true }
                v.requestFocusNodeHref(msg)
            }
            else -> return false
        }
        return true
    }

    private fun showLinkMenu(link: String?, image: String?) {
        val l = link?.takeIf { isWeb(it) }
        val i = image?.takeIf { isWeb(it) || it.startsWith("data:") }
        if (l == null && i == null) return
        send(JSONObject().put("type", "linkMenu").put("link", l ?: JSONObject.NULL).put("image", i ?: JSONObject.NULL))
    }

    private fun share(url: String, title: String?) {
        if (url.isEmpty()) return
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url).apply { title?.let { putExtra(Intent.EXTRA_SUBJECT, it) } }, null))
    }

    private fun copy(text: String) {
        (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Link", text))
        if (Build.VERSION.SDK_INT < 33) toast("Copied")
    }

    private fun toast(s: String) = Toast.makeText(this, Look.t(s), Toast.LENGTH_SHORT).show()

    private fun toggleBookmark() {
        val t = active ?: return
        if (!isWeb(t.url)) return
        val on = store.bookmarks.none { it.url == t.url }
        if (on) store.bookmarks.add(Bookmark(t.url, t.title.ifBlank { t.url }, "", t.favicon)) else store.bookmarks.removeAll { it.url == t.url }
        queueSave()
        sendNav()
        send(JSONObject().put("type", "bookmarked").put("on", on))
    }

    private fun clearData(cookiesToo: Boolean) {
        store.history.clear()
        if (cookiesToo) {
            CookieManager.getInstance().removeAllCookies(null)
            WebStorage.getInstance().deleteAllData()
            tabs.forEach { it.view?.clearCache(true) }
        }
        queueSave()
        send(JSONObject().put("type", "historyList").put("items", JSONArray()))
    }

    // ---------------- downloads ----------------

    private var lastDownloadAt = 0L

    private fun download(t: Tab, url: String, ua: String?, disposition: String?, mime: String?) {
        if (!DOWNLOADABLE.containsMatchIn(url)) { toast("Drift can't save this kind of download yet"); return }
        lastDownloadAt = System.currentTimeMillis()
        val name = URLUtil.guessFileName(url, disposition, mime)
        try {
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setMimeType(mime)
                .addRequestHeader("User-Agent", ua ?: userAgent(false))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            t.view?.url?.let { req.addRequestHeader("Referer", it) }
            val id = (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            store.downloads.add(0, DownloadRecord(id, url, name, System.currentTimeMillis()))
            if (store.downloads.size > 200) store.downloads.subList(200, store.downloads.size).clear()
            queueSave()
            send(JSONObject().put("type", "downloadStarted").put("name", name))
        } catch (e: Exception) { toast("Couldn't start the download") }
        // a new tab opened just for a download link would stay blank: go back to the tab it came from
        if (!t.committed && t.opener != null && tabs.size > 1) main.post { closeTab(t) }
    }

    private fun sendDownloads() {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val live = HashMap<Long, JSONObject>()
        if (store.downloads.isNotEmpty()) {
            dm.query(DownloadManager.Query().setFilterById(*store.downloads.map { it.id }.toLongArray()))?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))
                    val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    live[id] = JSONObject().put("received", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                        .put("total", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                        .put("state", when (status) { DownloadManager.STATUS_SUCCESSFUL -> "done"; DownloadManager.STATUS_FAILED -> "failed"; DownloadManager.STATUS_PAUSED -> "paused"; else -> "progress" })
                }
            }
        }
        send(JSONObject().put("type", "downloads").put("items", JSONArray(store.downloads.map { d ->
            val l = live[d.id]
            JSONObject().put("id", d.id).put("name", d.name).put("host", hostOf(d.url)).put("url", d.url).put("started", d.started)
                .put("state", l?.optString("state") ?: "gone").put("received", l?.optLong("received") ?: 0).put("total", l?.optLong("total") ?: 0)
        })))
        if (full && live.values.any { it.optString("state") == "progress" || it.optString("state") == "paused" }) {
            main.removeCallbacks(downloadsRunnable); main.postDelayed(downloadsRunnable, 700)
        }
    }

    private val downloadsRunnable = Runnable { sendDownloads() }

    private fun downloadAction(action: String?, id: Long) {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val d = store.downloads.find { it.id == id }
        when (action) {
            "open" -> dm.getUriForDownloadedFile(id)?.let { uri ->
                try { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, dm.getMimeTypeForDownloadedFile(id)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                catch (e: ActivityNotFoundException) { toast("No app can open this file") }
            } ?: toast("The file isn't there anymore")
            "cancel" -> { dm.remove(id); d?.let { store.downloads.remove(it) } }
            "remove" -> d?.let { store.downloads.remove(it) }
            "clear" -> store.downloads.clear()
            "retry" -> d?.let { store.downloads.remove(it); active?.let { t -> download(t, d.url, userAgent(t.desktop), null, null) } }
            "folder" -> try { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
        }
        queueSave()
        sendDownloads()
    }

    // ---------------- info ----------------

    private fun sendInfo() {
        val pkg = WebViewCompat.getCurrentWebViewPackage(this)
        val engine = pkg?.versionName ?: ""
        val rt = Runtime.getRuntime()
        send(JSONObject().put("type", "info").put("version", BuildConfig.VERSION_NAME).put("engine", engine).put("chromium", engine.substringBefore('.'))
            .put("engineName", pkg?.packageName ?: "").put("userAgent", userAgent(false))
            .put("system", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}")
            .put("tabs", tabs.size).put("asleep", tabs.count { it.view == null }).put("history", store.history.size)
            .put("memoryMb", (rt.totalMemory() - rt.freeMemory()) / 1048576).put("total", store.adsBlockedTotal).put("rules", blocker.engine.totalRules))
    }
}
