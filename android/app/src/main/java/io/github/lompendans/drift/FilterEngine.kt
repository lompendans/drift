package io.github.lompendans.drift

// A filter engine for uBlock Origin / Adblock Plus list syntax: network rules with anchors, wildcards, exceptions and
// the common options, plus element hiding. Scriptlets (+js), procedural selectors and HTML filters are skipped.
// The same engine as desktop Drift (app/src/filters.js), in Kotlin.

object T {
    const val SCRIPT = 1; const val IMAGE = 2; const val STYLESHEET = 4; const val XHR = 8; const val SUBDOCUMENT = 16
    const val MEDIA = 32; const val FONT = 64; const val WEBSOCKET = 128; const val PING = 256; const val OTHER = 512
    const val DOCUMENT = 1024; const val ALL_BUT_DOCUMENT = 1023; const val ALL = 2047
}

class NetFilter(val list: String) {
    var pattern = ""
    var hostAnchor = false; var startAnchor = false; var endAnchor = false
    var matchCase = false; var important = false; var redirect = false
    var types = T.ALL_BUT_DOCUMENT
    var party = 0                      // 0 any, 1 first-party only, 2 third-party only
    var domains: List<String>? = null; var notDomains: List<String>? = null
    var toDomains: List<String>? = null; var notToDomains: List<String>? = null
    var hide = 0                       // exceptions only: 1 generichide, 2 specifichide, 3 elemhide
    var removeParam: String? = null
    var removeParamRegex: Regex? = null

    fun copy(): NetFilter = NetFilter(list).also {
        it.pattern = pattern; it.hostAnchor = hostAnchor; it.startAnchor = startAnchor; it.endAnchor = endAnchor
        it.matchCase = matchCase; it.important = important; it.redirect = redirect; it.types = types; it.party = party
        it.domains = domains; it.notDomains = notDomains; it.toDomains = toDomains; it.notToDomains = notToDomains
        it.hide = hide; it.removeParam = removeParam; it.removeParamRegex = removeParamRegex
    }
}

class FilterEngine private constructor() {
    private val hostBlock = HashMap<String, MutableList<NetFilter>>()
    private val hostAllow = HashMap<String, MutableList<NetFilter>>()
    private val tokenBlock = HashMap<String, MutableList<NetFilter>>()
    private val tokenAllow = HashMap<String, MutableList<NetFilter>>()
    private val otherBlock = ArrayList<NetFilter>()
    private val otherAllow = ArrayList<NetFilter>()
    private val documentBlock = ArrayList<NetFilter>()
    private val pageExceptions = ArrayList<NetFilter>()
    private val removeParams = ArrayList<NetFilter>()
    private val genericHide = LinkedHashSet<String>()
    private val genericExcepted = HashSet<String>()
    private val specificHide = HashMap<String, MutableSet<String>>()
    private val specificUnhide = HashMap<String, MutableSet<String>>()
    private val genericByToken = HashMap<String, MutableList<String>>()
    private val genericAlways = ArrayList<String>()

    var networkRules = 0; private set
    var cosmeticRules = 0; private set
    val totalRules get() = networkRules + cosmeticRules

    companion object {
        private val twoPartSuffixes = setOf("co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp", "co.nz", "co.za",
            "com.br", "com.tr", "org.tr", "net.tr", "gen.tr", "com.mx", "com.ar", "co.in", "co.kr", "com.cn", "com.tw", "com.sg")

        /** The "site" a host belongs to (example.co.uk for a.b.example.co.uk), used for first-party checks. */
        fun site(hostIn: String?): String {
            if (hostIn.isNullOrEmpty()) return ""
            val host = hostIn.lowercase()
            val labels = host.split('.')
            if (labels.size <= 2) return host
            val keep = if (labels.takeLast(2).joinToString(".") in twoPartSuffixes) 3 else 2
            return labels.takeLast(keep).joinToString(".")
        }

        fun build(lists: List<Pair<String, String>>, counts: MutableMap<String, Int>?, fallback: List<String>?): FilterEngine {
            val e = FilterEngine()
            // $badfilter cancels the same rule written without it, across every list
            val bad = HashSet<String>()
            for ((_, text) in lists) for (line in lines(text)) if (line.contains("badfilter")) bad.add(removeOption(line, "badfilter"))
            for ((id, text) in lists) {
                val before = e.totalRules
                for (line in lines(text)) if (line !in bad && !line.contains("badfilter")) e.add(line, id)
                counts?.put(id, e.totalRules - before)
            }
            if (fallback != null && e.networkRules == 0) for (d in fallback) e.add("||$d^", "builtin")
            e.indexGeneric()
            return e
        }

        // splits a list into rule lines, honoring uBO's "!#if ... !#endif" blocks
        private fun lines(text: String): Sequence<String> = sequence {
            val stack = ArrayDeque<Boolean>()
            var on = true
            for (raw in text.lineSequence()) {
                val line = raw.trim()
                when {
                    line.startsWith("!#if ") -> { stack.addLast(on); on = on && condition(line.substring(5).trim()) }
                    line.startsWith("!#else") -> { val parent = stack.lastOrNull() ?: true; on = parent && !on }
                    line.startsWith("!#endif") -> { on = stack.removeLastOrNull() ?: true }
                    !on || line.isEmpty() || line[0] == '!' || line[0] == '[' -> {}
                    else -> yield(line)
                }
            }
        }

        private fun condition(cond: String): Boolean {
            for (or in cond.split("||")) {
                var all = true
                for (andRaw in or.split("&&")) {
                    var t = andRaw.trim().trim('(', ')').trim()
                    val neg = t.startsWith("!")
                    if (neg) t = t.substring(1).trim()
                    // Drift on Android is Chromium (WebView) on a phone
                    var v = t == "env_chromium" || t == "env_mobile" || t == "cap_user_stylesheet"
                    if (neg) v = !v
                    if (!v) { all = false; break }
                }
                if (all) return true
            }
            return false
        }

        private fun removeOption(line: String, option: String): String {
            val d = line.lastIndexOf('$')
            if (d < 0) return line
            val opts = line.substring(d + 1).split(',').filter { it.trim() != option }
            return if (opts.isEmpty()) line.substring(0, d) else line.substring(0, d + 1) + opts.joinToString(",")
        }

        private val procedural = listOf(":-abp-", ":has-text(", ":upward(", ":xpath(", ":remove(", ":style(", ":matches-css", ":min-text-length(", ":watch-attr(",
            ":others(", ":matches-path(", ":if(", ":if-not(", ":nth-ancestor(", ":contains(", ":matches-attr(", ":matches-prop(",
            ":remove-attr(", ":remove-class(", ":shadow", ":matches-media(", ":spath(", ":not(:has-text")

        private val typeNames = mapOf("script" to T.SCRIPT, "image" to T.IMAGE, "stylesheet" to T.STYLESHEET, "css" to T.STYLESHEET,
            "xmlhttprequest" to T.XHR, "xhr" to T.XHR, "subdocument" to T.SUBDOCUMENT, "frame" to T.SUBDOCUMENT, "media" to T.MEDIA,
            "font" to T.FONT, "websocket" to T.WEBSOCKET, "ping" to T.PING, "beacon" to T.PING, "other" to T.OTHER, "object" to T.OTHER,
            "object-subrequest" to T.OTHER, "document" to T.DOCUMENT, "doc" to T.DOCUMENT)
        private val ignored = setOf("_", "strict1p", "strict3p", "reason", "cname", "genericblock")

        private fun isTokenChar(c: Char) = c in 'a'..'z' || c in '0'..'9' || c == '%' || c in 'A'..'Z'
        private fun isSeparator(c: Char) = !(c.isLetterOrDigit() || c == '_' || c == '-' || c == '.' || c == '%')

        private fun suffixes(host: String): List<String> {
            val out = ArrayList<String>(4)
            var h = host
            while (true) {
                out.add(h)
                val dot = h.indexOf('.')
                if (dot < 0) break
                h = h.substring(dot + 1)
                if (h.indexOf('.') < 0) break
            }
            return out
        }

        // host suffixes plus uBO "entity" forms like google.* for www.google.co.uk
        private fun candidates(hostIn: String): List<String> {
            val host = hostIn.lowercase()
            val s = site(host)
            val dot = s.indexOf('.')
            val tld = if (dot >= 0) s.substring(dot) else ""
            val out = ArrayList<String>()
            for (x in suffixes(host)) {
                out.add(x)
                if (tld.isNotEmpty() && x.length > tld.length && x.endsWith(tld)) out.add(x.substring(0, x.length - tld.length) + ".*")
            }
            return out
        }

        private fun domainIn(host: String, domains: List<String>): Boolean {
            if (host.isEmpty()) return false
            for (c in candidates(host)) if (c in domains) return true
            return false
        }

        // wildcard match: '*' is any run of characters, '^' is a separator character or the end of the URL
        private fun glob(s: String, start: Int, p: String, end: Boolean): Boolean {
            var si = start; var pi = 0; var starP = -1; var starS = 0
            while (true) {
                if (pi < p.length) {
                    val c = p[pi]
                    if (c == '*') { starP = pi++; starS = si; continue }
                    if (si < s.length && (if (c == '^') isSeparator(s[si]) else c == s[si])) { pi++; si++; continue }
                    if (c == '^' && si == s.length) { pi++; continue }
                } else if (!end || si == s.length) return true
                if (starP < 0 || starS >= s.length) return false
                pi = starP + 1
                si = ++starS
            }
        }

        private fun patternMatches(f: NetFilter, u: String): Boolean {
            val p = f.pattern
            if (p.isEmpty()) return true
            if (f.hostAnchor) {
                var hs = u.indexOf("://")
                hs = if (hs < 0) 0 else hs + 3
                var he = hs
                while (he < u.length && u[he] != '/' && u[he] != '?' && u[he] != '#' && u[he] != ':') he++
                for (i in hs until he) if ((i == hs || u[i - 1] == '.') && glob(u, i, p, f.endAnchor)) return true
                return false
            }
            if (f.startAnchor) return glob(u, 0, p, f.endAnchor)
            val first = p[0]
            if (first == '*' || first == '^') {
                for (i in 0..u.length) if (glob(u, i, p, f.endAnchor)) return true
                return false
            }
            var i = u.indexOf(first)
            while (i >= 0) {
                if (glob(u, i, p, f.endAnchor)) return true
                i = u.indexOf(first, i + 1)
            }
            return false
        }

        private fun applies(f: NetFilter, url: String, lower: String, reqHost: String, pageHost: String, third: Boolean, type: Int, checkPattern: Boolean): Boolean {
            if (f.types and type == 0) return false
            if (f.party == 1 && third) return false
            if (f.party == 2 && !third) return false
            f.domains?.let { if (!domainIn(pageHost, it)) return false }
            f.notDomains?.let { if (domainIn(pageHost, it)) return false }
            f.toDomains?.let { if (!domainIn(reqHost, it)) return false }
            f.notToDomains?.let { if (domainIn(reqHost, it)) return false }
            return !checkPattern || patternMatches(f, if (f.matchCase) url else lower)
        }

        private fun parseOptions(options: String, f: NetFilter, exception: Boolean): Boolean {
            var include = 0; var exclude = 0; var popupOnly = false
            for (raw in options.split(',')) {
                val opt = raw.trim()
                if (opt.isEmpty()) continue
                val eq = opt.indexOf('=')
                var name = (if (eq >= 0) opt.substring(0, eq) else opt).lowercase()
                val value = if (eq >= 0) opt.substring(eq + 1) else null
                val neg = name.startsWith("~")
                if (neg) name = name.substring(1)
                typeNames[name]?.let { if (neg) exclude = exclude or it else include = include or it; continue }
                when (name) {
                    "third-party", "3p" -> f.party = if (neg) 1 else 2
                    "first-party", "1p" -> f.party = if (neg) 2 else 1
                    "all" -> include = include or T.ALL
                    "popup" -> popupOnly = true
                    "important" -> f.important = true
                    "match-case" -> f.matchCase = true
                    "domain", "from", "to" -> {
                        if (value == null) return false
                        val ds = value.lowercase().split('|').filter { it.isNotEmpty() }
                        if (ds.any { it.contains('/') }) return false
                        val inc = ds.filter { it[0] != '~' }; val exc = ds.filter { it[0] == '~' }.map { it.substring(1) }
                        if (name == "to") { f.toDomains = inc.ifEmpty { null }; f.notToDomains = exc.ifEmpty { null } }
                        else { f.domains = inc.ifEmpty { null }; f.notDomains = exc.ifEmpty { null } }
                    }
                    "redirect", "rewrite", "empty", "mp4" -> f.redirect = true
                    "redirect-rule" -> return false
                    "generichide", "ghide" -> f.hide = 1
                    "specifichide", "shide" -> f.hide = 2
                    "elemhide", "ehide" -> f.hide = 3
                    "removeparam", "queryprune" -> {
                        if (exception || value.isNullOrEmpty()) return false
                        if (value.length > 2 && value[0] == '/' && value.last() == '/') {
                            f.removeParamRegex = try { Regex(value.substring(1, value.length - 1), RegexOption.IGNORE_CASE) } catch (e: Exception) { return false }
                        } else if (value[0] == '~') return false
                        else f.removeParam = value
                    }
                    else -> if (name !in ignored) return false
                }
            }
            if (popupOnly && include == 0) return false
            if (include != 0) f.types = include and exclude.inv()
            else if (exclude != 0) f.types = T.ALL_BUT_DOCUMENT and exclude.inv()
            return f.types != 0 || f.hide != 0
        }

        private fun pureHost(p: String): String? {
            if (!p.endsWith("^")) return null
            val host = p.substring(0, p.length - 1)
            if (host.isEmpty() || !host.contains('.') || !host.all { it.isLetterOrDigit() || it == '.' || it == '-' || it == '_' }) return null
            return host
        }

        // the longest run of letters/digits that a matching URL must contain as a whole token
        private fun bestToken(f: NetFilter): String? {
            val p = f.pattern
            var best: String? = null
            var i = 0
            while (i < p.length) {
                if (!isTokenChar(p[i])) { i++; continue }
                val start = i
                while (i < p.length && isTokenChar(p[i])) i++
                val len = i - start
                val leftOk = if (start == 0) f.hostAnchor || f.startAnchor else p[start - 1] != '*'
                val rightOk = if (i == p.length) f.endAnchor else p[i] != '*'
                if (len >= 3 && leftOk && rightOk && (best == null || len > best.length)) best = p.substring(start, i)
            }
            return if (best != null && f.matchCase) best.lowercase() else best
        }

        private fun cosmeticSeparator(line: String): IntArray? {   // [index, length, exception, supported]
            val kinds = arrayOf("#@#", "##", "#?#", "#@?#", "#$#", "#@$#", "#%#", "#@%#")
            var best = -1; var found: String? = null
            for (k in kinds) {
                val i = line.indexOf(k)
                if (i >= 0 && (best < 0 || i < best || (i == best && k.length > found!!.length))) { best = i; found = k }
            }
            if (found == null) return null
            return intArrayOf(best, found.length, if (found.contains('@')) 1 else 0, if (found == "##" || found == "#@#") 1 else 0)
        }

        private fun <T> MutableMap<String, MutableList<T>>.push(key: String, v: T) { getOrPut(key) { ArrayList(1) }.add(v) }
    }

    private fun indexGeneric() {
        val lead = Regex("^([.#])([A-Za-z0-9_-]+)")
        for (s in genericHide) {
            if (s in genericExcepted) continue
            val m = lead.find(s)
            if (m == null) { genericAlways.add(s); continue }
            genericByToken.push(m.groupValues[1] + m.groupValues[2], s)
        }
    }

    private fun add(line: String, list: String) {
        if (line.contains('#')) {
            val c = cosmeticSeparator(line)
            if (c != null) {
                if (c[3] == 1) addCosmetic(line.substring(0, c[0]), line.substring(c[0] + c[1]), c[2] == 1)
                return
            }
        }
        if (line.startsWith("0.0.0.0 ") || line.startsWith("127.0.0.1 ")) {
            val host = line.substring(line.indexOf(' ') + 1).trim().split(' ', '\t', '#')[0].lowercase()
            if (host.contains('.') && host != "0.0.0.0" && host != "localhost") addNetwork("||$host^", list)
            return
        }
        addNetwork(line, list)
    }

    private fun addCosmetic(domains: String, selectorIn: String, exception: Boolean) {
        val selector = selectorIn.trim()
        if (selector.isEmpty() || selector.startsWith("+js(") || selector.startsWith("^") || selector.contains('{')) return
        val low = selector.lowercase()
        if (procedural.any { low.contains(it) }) return
        val ds = domains.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        if (ds.isEmpty()) {
            if (exception) genericExcepted.add(selector) else if (genericHide.add(selector)) cosmeticRules++
            return
        }
        val include = ds.filter { it[0] != '~' }; val exclude = ds.filter { it[0] == '~' }.map { it.substring(1) }
        if (exception) { for (d in include) specificUnhide.getOrPut(d) { HashSet() }.add(selector); return }
        if (include.isEmpty() && genericHide.add(selector)) cosmeticRules++
        for (d in include) if (specificHide.getOrPut(d) { HashSet() }.add(selector)) cosmeticRules++
        for (d in exclude) specificUnhide.getOrPut(d) { HashSet() }.add(selector)
    }

    private fun addNetwork(raw: String, list: String) {
        val exception = raw.startsWith("@@")
        val s = if (exception) raw.substring(2) else raw
        val f = NetFilter(list)
        val dollar = s.lastIndexOf('$')
        var pattern = if (dollar >= 0) s.substring(0, dollar) else s
        if (pattern.length > 1 && pattern[0] == '/' && pattern.last() == '/') return   // regex rules: rare and slow
        if (dollar >= 0 && !parseOptions(s.substring(dollar + 1), f, exception)) return
        if (pattern.startsWith("||")) { f.hostAnchor = true; pattern = pattern.substring(2) }
        else if (pattern.startsWith("|")) { f.startAnchor = true; pattern = pattern.substring(1) }
        if (pattern.endsWith("|")) { f.endAnchor = true; pattern = pattern.substring(0, pattern.length - 1) }
        if (!f.hostAnchor && !f.startAnchor) pattern = pattern.trimStart('*')
        if (!f.endAnchor) pattern = pattern.trimEnd('*')
        f.pattern = if (f.matchCase) pattern else pattern.lowercase()
        // a rule with no pattern must at least be limited by domain=, or it would match every request
        if (f.pattern.isEmpty() && f.domains == null && f.removeParam == null && f.removeParamRegex == null && f.hide == 0) return
        if (f.removeParam != null || f.removeParamRegex != null) { if (!exception) { removeParams.add(f); networkRules++ }; return }
        if (exception && (f.hide != 0 || f.types and T.DOCUMENT != 0)) {
            pageExceptions.add(f)
            if (f.hide != 0 || f.types == T.DOCUMENT) return
        }
        if (!exception && f.types and T.DOCUMENT != 0) {
            documentBlock.add(f.copy().also { it.types = T.DOCUMENT })
            networkRules++
            f.types = f.types and T.DOCUMENT.inv()
            if (f.types == 0) return
        }
        networkRules++
        val host = pureHost(f.pattern)
        if (f.hostAnchor && host != null) { (if (exception) hostAllow else hostBlock).push(host, f); return }
        val token = bestToken(f)
        if (token != null) (if (exception) tokenAllow else tokenBlock).push(token, f)
        else (if (exception) otherAllow else otherBlock).add(f)
    }

    /** The rule that blocks this request, or null to let it through. */
    fun matchRequest(url: String, reqHostIn: String, pageHost: String, thirdParty: Boolean, type: Int): NetFilter? {
        val lower = url.lowercase()
        val reqHost = reqHostIn.lowercase()
        val block = find(hostBlock, tokenBlock, otherBlock, url, lower, reqHost, pageHost, thirdParty, type) ?: return null
        if (block.important) return block
        return if (find(hostAllow, tokenAllow, otherAllow, url, lower, reqHost, pageHost, thirdParty, type) != null) null else block
    }

    private fun find(hosts: Map<String, List<NetFilter>>, tokens: Map<String, List<NetFilter>>, other: List<NetFilter>,
                     url: String, lower: String, reqHost: String, pageHost: String, third: Boolean, type: Int): NetFilter? {
        for (h in suffixes(reqHost)) hosts[h]?.let { for (f in it) if (applies(f, url, lower, reqHost, pageHost, third, type, false)) return f }
        var i = 0
        while (i < lower.length) {
            if (!isTokenChar(lower[i])) { i++; continue }
            val start = i
            while (i < lower.length && isTokenChar(lower[i])) i++
            if (i - start >= 3) tokens[lower.substring(start, i)]?.let { for (f in it) if (applies(f, url, lower, reqHost, pageHost, third, type, true)) return f }
        }
        for (f in other) if (applies(f, url, lower, reqHost, pageHost, third, type, true)) return f
        return null
    }

    /** A rule that says this whole page is dangerous (the badware list), or null. */
    fun matchDocument(url: String, host: String): NetFilter? {
        val lower = url.lowercase()
        for (f in documentBlock) if (applies(f, url, lower, host, host, false, T.DOCUMENT, true)) return if (pageAllowed(url, host)) null else f
        return null
    }

    /** Which kinds of element hiding are switched off on this page: bit 1 generic, bit 2 site-specific. */
    fun hideOff(url: String, host: String): Int {
        var off = 0
        val lower = url.lowercase()
        for (f in pageExceptions) if (f.hide != 0 && applies(f, url, lower, host, host, false, f.types or T.DOCUMENT, true)) off = off or f.hide
        return off
    }

    /** True when a "@@...$document" rule turns filtering off for this page. */
    fun pageAllowed(url: String, host: String): Boolean {
        val lower = url.lowercase()
        for (f in pageExceptions) if (f.hide == 0 && f.types and T.DOCUMENT != 0 && applies(f, url, lower, host, host, false, T.DOCUMENT, true)) return true
        return false
    }

    /** Removes tracking parameters from a page address. Returns null if nothing changed. */
    fun cleanUrl(url: String, host: String): String? {
        if (removeParams.isEmpty()) return null
        val q = url.indexOf('?')
        if (q < 0) return null
        val hashAt = url.indexOf('#', q)
        val query = if (hashAt >= 0) url.substring(q + 1, hashAt) else url.substring(q + 1)
        val fragment = if (hashAt >= 0) url.substring(hashAt) else ""
        val lower = url.lowercase()
        val rules = removeParams.filter { applies(it, url, lower, host, host, false, it.types or T.DOCUMENT, true) }
        if (rules.isEmpty()) return null
        val kept = ArrayList<String>()
        var changed = false
        for (part in query.split('&')) {
            val name = try { java.net.URLDecoder.decode(part.split('=')[0], "UTF-8") } catch (e: Exception) { part.split('=')[0] }
            val drop = rules.any { r -> r.removeParam?.equals(name, ignoreCase = true) ?: r.removeParamRegex!!.containsMatchIn(part) }
            if (drop) changed = true else kept.add(part)
        }
        if (!changed) return null
        return url.substring(0, q) + (if (kept.isNotEmpty()) "?" + kept.joinToString("&") else "") + fragment
    }

    /**
     * CSS that hides ads on a page. "first" is the page's first request: it adds the site's own rules and the
     * generic rules every page gets; later requests only add rules for newly seen class and id names.
     */
    fun hideCss(host: String, classes: List<String>, ids: List<String>, first: Boolean, generic: Boolean, specific: Boolean): String {
        val unhide = HashSet<String>()
        for (key in candidates(host)) specificUnhide[key]?.let { unhide.addAll(it) }
        val sb = StringBuilder()
        fun add(s: String) { if (s !in unhide) sb.append(s).append("{display:none!important}") }
        if (generic) {
            if (first) genericAlways.forEach(::add)
            for (c in classes) genericByToken[".$c"]?.forEach(::add)
            for (i in ids) genericByToken["#$i"]?.forEach(::add)
        }
        if (specific && first) {
            val mine = LinkedHashSet<String>()
            for (key in candidates(host)) specificHide[key]?.let { mine.addAll(it) }
            for (s in mine) if (s !in genericExcepted) add(s)
        }
        return sb.toString()
    }
}
