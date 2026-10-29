"use strict";
// A filter engine for uBlock Origin / Adblock Plus list syntax: network rules with anchors, wildcards, exceptions and
// the common options, plus element hiding. Scriptlets (+js), procedural selectors and HTML filters are skipped.

const T = { None: 0, Script: 1, Image: 2, Stylesheet: 4, Xhr: 8, Subdocument: 16, Media: 32, Font: 64, Websocket: 128, Ping: 256, Other: 512, Document: 1024, AllButDocument: 1023, All: 2047 };

const TwoPartSuffixes = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp", "co.nz", "co.za",
  "com.br", "com.tr", "org.tr", "net.tr", "gen.tr", "com.mx", "com.ar", "co.in", "co.kr", "com.cn", "com.tw", "com.sg"]);

/** The "site" a host belongs to (example.co.uk for a.b.example.co.uk), used for first-party checks. */
function site(host) {
  if (!host) return "";
  host = host.toLowerCase();
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const keep = TwoPartSuffixes.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function* suffixes(host) {
  let h = host;
  while (true) {
    yield h;
    const dot = h.indexOf(".");
    if (dot < 0) return;
    h = h.slice(dot + 1);
    if (h.indexOf(".") < 0) return;
  }
}

// host suffixes plus uBO "entity" forms like google.* for www.google.co.uk
function candidates(host) {
  host = host.toLowerCase();
  const s = site(host), dot = s.indexOf("."), tld = dot >= 0 ? s.slice(dot) : "";
  const out = [];
  for (const x of suffixes(host)) {
    out.push(x);
    if (tld && x.length > tld.length && x.endsWith(tld)) out.push(x.slice(0, x.length - tld.length) + ".*");
  }
  return out;
}

function domainIn(host, domains) {
  if (!host) return false;
  for (const c of candidates(host)) if (domains.includes(c)) return true;
  return false;
}

const TypeNames = {
  script: T.Script, image: T.Image, stylesheet: T.Stylesheet, css: T.Stylesheet, xmlhttprequest: T.Xhr, xhr: T.Xhr,
  subdocument: T.Subdocument, frame: T.Subdocument, media: T.Media, font: T.Font, websocket: T.Websocket, ping: T.Ping,
  beacon: T.Ping, other: T.Other, object: T.Other, "object-subrequest": T.Other, document: T.Document, doc: T.Document,
};
const Ignored = new Set(["_", "strict1p", "strict3p", "reason", "cname", "genericblock"]);
const Procedural = [":-abp-", ":has-text(", ":upward(", ":xpath(", ":remove(", ":style(", ":matches-css", ":min-text-length(", ":watch-attr(",
  ":others(", ":matches-path(", ":if(", ":if-not(", ":nth-ancestor(", ":contains(", ":matches-attr(", ":matches-prop(",
  ":remove-attr(", ":remove-class(", ":shadow", ":matches-media(", ":spath(", ":not(:has-text"];

const isTokenChar = c => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 37 || (c >= 65 && c <= 90);
const isAlnum = ch => /[\p{L}\p{N}]/u.test(ch);
const isSeparator = ch => {
  const c = ch.charCodeAt(0);
  if (c < 128) return !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46 || c === 37);
  return !isAlnum(ch);
};

// Wildcard match: '*' is any run of characters, '^' is a separator character or the end of the URL.
function glob(s, si, p, end) {
  let pi = 0, starP = -1, starS = 0;
  while (true) {
    if (pi < p.length) {
      const c = p[pi];
      if (c === "*") { starP = pi++; starS = si; continue; }
      if (si < s.length && (c === "^" ? isSeparator(s[si]) : c === s[si])) { pi++; si++; continue; }
      if (c === "^" && si === s.length) { pi++; continue; }
    } else if (!end || si === s.length) return true;
    if (starP < 0 || starS >= s.length) return false;
    pi = starP + 1;
    si = ++starS;
  }
}

function patternMatches(f, u) {
  const p = f.pattern;
  if (!p.length) return true;
  if (f.hostAnchor) {
    let hs = u.indexOf("://");
    hs = hs < 0 ? 0 : hs + 3;
    let he = hs;
    while (he < u.length && !"/?#:".includes(u[he])) he++;
    for (let i = hs; i < he; i++)
      if ((i === hs || u[i - 1] === ".") && glob(u, i, p, f.endAnchor)) return true;
    return false;
  }
  if (f.startAnchor) return glob(u, 0, p, f.endAnchor);
  const first = p[0];
  if (first === "*" || first === "^") {
    for (let i = 0; i <= u.length; i++) if (glob(u, i, p, f.endAnchor)) return true;
    return false;
  }
  for (let i = u.indexOf(first); i >= 0; i = u.indexOf(first, i + 1))
    if (glob(u, i, p, f.endAnchor)) return true;
  return false;
}

function applies(f, url, lower, reqHost, pageHost, third, type, checkPattern) {
  if ((f.types & type) === 0) return false;
  if (f.party === 1 && third) return false;
  if (f.party === 2 && !third) return false;
  if (f.domains && !domainIn(pageHost, f.domains)) return false;
  if (f.notDomains && domainIn(pageHost, f.notDomains)) return false;
  if (f.toDomains && !domainIn(reqHost, f.toDomains)) return false;
  if (f.notToDomains && domainIn(reqHost, f.notToDomains)) return false;
  return !checkPattern || patternMatches(f, f.matchCase ? url : lower);
}

// Splits a list into rule lines, honoring uBO's "!#if ... !#endif" blocks.
function* lines(text) {
  const stack = [];
  let on = true;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("!#if ")) { stack.push(on); on = on && condition(line.slice(5).trim()); continue; }
    if (line.startsWith("!#else")) { const parent = stack.length === 0 || stack[stack.length - 1]; on = parent && !on; continue; }
    if (line.startsWith("!#endif")) { on = stack.length === 0 || stack.pop(); continue; }
    if (!on || !line.length || line[0] === "!" || line[0] === "[") continue;
    yield line;
  }
}

function condition(cond) {
  for (const or of cond.split("||")) {
    let all = true;
    for (const andRaw of or.split("&&")) {
      let t = andRaw.trim().replace(/^[()]+|[()]+$/g, "").trim();
      const neg = t.startsWith("!");
      if (neg) t = t.slice(1).trim();
      let v = t === "env_chromium" || t === "cap_user_stylesheet";   // Drift is Chromium-based
      if (neg) v = !v;
      if (!v) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

function removeOption(line, option) {
  const d = line.lastIndexOf("$");
  if (d < 0) return line;
  const opts = line.slice(d + 1).split(",").filter(o => o.trim() !== option);
  return opts.length === 0 ? line.slice(0, d) : line.slice(0, d + 1) + opts.join(",");
}

function cosmeticSeparator(line) {
  const kinds = ["#@#", "##", "#?#", "#@?#", "#$#", "#@$#", "#%#", "#@%#"];
  let best = -1, found = null;
  for (const k of kinds) {
    const i = line.indexOf(k);
    if (i >= 0 && (best < 0 || i < best || (i === best && k.length > found.length))) { best = i; found = k; }
  }
  return { at: best, len: found ? found.length : 0, exception: !!found && found.includes("@"), supported: found === "##" || found === "#@#" };
}

const push = (map, key, v) => { const l = map.get(key); if (l) l.push(v); else map.set(key, [v]); };
const bucket = (map, key) => { let s = map.get(key); if (!s) map.set(key, s = new Set()); return s; };

class FilterEngine {
  constructor() {
    this.hostBlock = new Map(); this.hostAllow = new Map();
    this.tokenBlock = new Map(); this.tokenAllow = new Map();
    this.otherBlock = []; this.otherAllow = [];
    this.documentBlock = []; this.pageExceptions = []; this.removeParams = [];
    this.genericHide = new Set(); this.genericExcepted = new Set();
    this.specificHide = new Map(); this.specificUnhide = new Map();
    this.genericByToken = new Map(); this.genericAlways = [];
    this.networkRules = 0; this.cosmeticRules = 0;
  }
  get totalRules() { return this.networkRules + this.cosmeticRules; }

  static build(lists, counts, fallbackDomains) {
    const e = new FilterEngine();
    // $badfilter cancels the same rule written without it, across every list.
    const bad = new Set();
    for (const [, text] of lists) for (const line of lines(text)) if (line.includes("badfilter")) bad.add(removeOption(line, "badfilter"));
    for (const [id, text] of lists) {
      const before = e.totalRules;
      for (const line of lines(text)) if (!bad.has(line) && !line.includes("badfilter")) e.add(line, id);
      if (counts) counts[id] = e.totalRules - before;
    }
    if (fallbackDomains && e.networkRules === 0) for (const d of fallbackDomains) e.add("||" + d + "^", "builtin");
    e.indexGeneric();
    return e;
  }

  // Generic hiding rules are only sent to a page for class and id names it actually uses (like uBlock Origin).
  indexGeneric() {
    for (const s of this.genericHide) {
      if (this.genericExcepted.has(s)) continue;
      const m = /^([.#])([A-Za-z0-9_-]+)/.exec(s);
      if (!m) { this.genericAlways.push(s); continue; }
      push(this.genericByToken, m[1] + m[2], s);
    }
  }

  add(line, list) {
    if (line.includes("#")) {
      const c = cosmeticSeparator(line);
      if (c.at >= 0) {
        if (c.supported) this.addCosmetic(line.slice(0, c.at), line.slice(c.at + c.len), c.exception);
        return;
      }
    }
    if (line.startsWith("0.0.0.0 ") || line.startsWith("127.0.0.1 ")) {
      const host = line.slice(line.indexOf(" ") + 1).trim().split(/[ \t#]/)[0].toLowerCase();
      if (host.includes(".") && host !== "0.0.0.0" && host !== "localhost") this.addNetwork("||" + host + "^", list);
      return;
    }
    this.addNetwork(line, list);
  }

  addCosmetic(domains, selector, exception) {
    selector = selector.trim();
    if (!selector || selector.startsWith("+js(") || selector.startsWith("^") || selector.includes("{")) return;
    const low = selector.toLowerCase();
    if (Procedural.some(p => low.includes(p))) return;
    const ds = domains.split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
    if (!ds.length) {
      if (exception) this.genericExcepted.add(selector);
      else if (!this.genericHide.has(selector)) { this.genericHide.add(selector); this.cosmeticRules++; }
      return;
    }
    const include = ds.filter(d => d[0] !== "~"), exclude = ds.filter(d => d[0] === "~").map(d => d.slice(1));
    if (exception) { for (const d of include) bucket(this.specificUnhide, d).add(selector); return; }
    if (!include.length && !this.genericHide.has(selector)) { this.genericHide.add(selector); this.cosmeticRules++; }
    for (const d of include) { const b = bucket(this.specificHide, d); if (!b.has(selector)) { b.add(selector); this.cosmeticRules++; } }
    for (const d of exclude) bucket(this.specificUnhide, d).add(selector);
  }

  addNetwork(raw, list) {
    const exception = raw.startsWith("@@");
    const s = exception ? raw.slice(2) : raw;
    const f = { pattern: "", hostAnchor: false, startAnchor: false, endAnchor: false, matchCase: false, important: false, redirect: false,
      types: T.AllButDocument, party: 0, domains: null, notDomains: null, toDomains: null, notToDomains: null, hide: 0, list, removeParam: null, removeParamRegex: null };
    const dollar = s.lastIndexOf("$");
    let pattern = dollar >= 0 ? s.slice(0, dollar) : s;
    if (pattern.length > 1 && pattern[0] === "/" && pattern[pattern.length - 1] === "/") return;   // regex rules: rare and slow
    if (dollar >= 0 && !parseOptions(s.slice(dollar + 1), f, exception)) return;

    if (pattern.startsWith("||")) { f.hostAnchor = true; pattern = pattern.slice(2); }
    else if (pattern.startsWith("|")) { f.startAnchor = true; pattern = pattern.slice(1); }
    if (pattern.endsWith("|")) { f.endAnchor = true; pattern = pattern.slice(0, -1); }
    if (!f.hostAnchor && !f.startAnchor) pattern = pattern.replace(/^\*+/, "");
    if (!f.endAnchor) pattern = pattern.replace(/\*+$/, "");
    f.pattern = f.matchCase ? pattern : pattern.toLowerCase();

    // a rule with no pattern must at least be limited by domain=, or it would match every request
    if (!f.pattern && !f.domains && !f.removeParam && !f.removeParamRegex && !f.hide) return;

    if (f.removeParam || f.removeParamRegex) { if (!exception) { this.removeParams.push(f); this.networkRules++; } return; }
    if (exception && (f.hide || (f.types & T.Document))) {
      this.pageExceptions.push(f);
      if (f.hide || f.types === T.Document) return;
    }
    if (!exception && (f.types & T.Document)) {
      this.documentBlock.push(Object.assign({}, f, { types: T.Document }));
      this.networkRules++;
      f.types &= ~T.Document;
      if (!f.types) return;
    }
    this.networkRules++;
    const host = pureHost(f.pattern);
    if (f.hostAnchor && host) { push(exception ? this.hostAllow : this.hostBlock, host, f); return; }
    const token = bestToken(f);
    if (token) push(exception ? this.tokenAllow : this.tokenBlock, token, f);
    else (exception ? this.otherAllow : this.otherBlock).push(f);
  }

  /** The rule that blocks this request, or null to let it through. */
  matchRequest(url, reqHost, pageHost, thirdParty, type) {
    const lower = url.toLowerCase();
    reqHost = reqHost.toLowerCase();
    const block = this.find(this.hostBlock, this.tokenBlock, this.otherBlock, url, lower, reqHost, pageHost, thirdParty, type);
    if (!block || block.important) return block;
    return this.find(this.hostAllow, this.tokenAllow, this.otherAllow, url, lower, reqHost, pageHost, thirdParty, type) ? null : block;
  }

  find(hosts, tokens, other, url, lower, reqHost, pageHost, third, type) {
    for (const h of suffixes(reqHost)) {
      const list = hosts.get(h);
      if (list) for (const f of list) if (applies(f, url, lower, reqHost, pageHost, third, type, false)) return f;
    }
    let i = 0;
    while (i < lower.length) {
      if (!isTokenChar(lower.charCodeAt(i))) { i++; continue; }
      const start = i;
      while (i < lower.length && isTokenChar(lower.charCodeAt(i))) i++;
      if (i - start >= 3) {
        const list = tokens.get(lower.slice(start, i));
        if (list) for (const f of list) if (applies(f, url, lower, reqHost, pageHost, third, type, true)) return f;
      }
    }
    for (const f of other) if (applies(f, url, lower, reqHost, pageHost, third, type, true)) return f;
    return null;
  }

  /** A rule that says this whole page is dangerous (the badware list), or null. */
  matchDocument(url, host) {
    const lower = url.toLowerCase();
    for (const f of this.documentBlock)
      if (applies(f, url, lower, host, host, false, T.Document, true)) return this.pageAllowed(url, host) ? null : f;
    return null;
  }

  /** Which kinds of element hiding are switched off on this page: bit 1 generic, bit 2 site-specific. */
  hideOff(url, host) {
    let off = 0;
    const lower = url.toLowerCase();
    for (const f of this.pageExceptions)
      if (f.hide && applies(f, url, lower, host, host, false, f.types | T.Document, true)) off |= f.hide;
    return off;
  }

  /** True when a "@@...$document" rule turns filtering off for this page. */
  pageAllowed(url, host) {
    const lower = url.toLowerCase();
    for (const f of this.pageExceptions)
      if (!f.hide && (f.types & T.Document) && applies(f, url, lower, host, host, false, T.Document, true)) return true;
    return false;
  }

  /** Removes tracking parameters (utm_source and friends) from a page address. Returns null if nothing changed. */
  cleanUrl(url, host) {
    if (!this.removeParams.length) return null;
    const q = url.indexOf("?");
    if (q < 0) return null;
    const hashAt = url.indexOf("#", q);
    const query = hashAt >= 0 ? url.slice(q + 1, hashAt) : url.slice(q + 1);
    const fragment = hashAt >= 0 ? url.slice(hashAt) : "";
    const lower = url.toLowerCase();
    const rules = this.removeParams.filter(f => applies(f, url, lower, host, host, false, f.types | T.Document, true));
    if (!rules.length) return null;
    const kept = [];
    let changed = false;
    for (const part of query.split("&")) {
      let name = part.split("=")[0];
      try { name = decodeURIComponent(name); } catch { }
      const drop = rules.some(f => f.removeParam ? f.removeParam.toLowerCase() === name.toLowerCase() : f.removeParamRegex.test(part));
      if (drop) changed = true; else kept.push(part);
    }
    if (!changed) return null;
    return url.slice(0, q) + (kept.length ? "?" + kept.join("&") : "") + fragment;
  }

  unhideFor(host) {
    const unhide = new Set();
    for (const key of candidates(host)) { const u = this.specificUnhide.get(key); if (u) for (const s of u) unhide.add(s); }
    return unhide;
  }

  /**
   * CSS that hides ads on a page. "first" is the page's first request: it adds the site's own rules and the
   * generic rules every page gets; later requests only add rules for newly seen class and id names.
   */
  hideCss(host, classes, ids, first, generic, specific) {
    const unhide = this.unhideFor(host);
    const out = [];
    const add = s => { if (!unhide.has(s)) out.push(s); };
    if (generic) {
      if (first) for (const s of this.genericAlways) add(s);
      for (const c of classes) { const l = this.genericByToken.get("." + c); if (l) for (const s of l) add(s); }
      for (const i of ids) { const l = this.genericByToken.get("#" + i); if (l) for (const s of l) add(s); }
    }
    if (specific && first) {
      const mine = new Set();
      for (const key of candidates(host)) { const h = this.specificHide.get(key); if (h) for (const s of h) mine.add(s); }
      for (const s of mine) if (!this.genericExcepted.has(s)) add(s);
    }
    // one rule per selector: a single bad selector would otherwise void a whole group
    return out.map(s => s + "{display:none!important}").join("");
  }
}

function parseOptions(options, f, exception) {
  let include = 0, exclude = 0, popupOnly = false;
  for (const rawOpt of options.split(",")) {
    const opt = rawOpt.trim();
    if (!opt) continue;
    const eq = opt.indexOf("=");
    let name = (eq >= 0 ? opt.slice(0, eq) : opt).toLowerCase();
    const value = eq >= 0 ? opt.slice(eq + 1) : null;
    const neg = name.startsWith("~");
    if (neg) name = name.slice(1);
    if (name in TypeNames) { if (neg) exclude |= TypeNames[name]; else include |= TypeNames[name]; continue; }
    switch (name) {
      case "third-party": case "3p": f.party = neg ? 1 : 2; break;
      case "first-party": case "1p": f.party = neg ? 2 : 1; break;
      case "all": include |= T.All; break;
      case "popup": popupOnly = true; break;
      case "important": f.important = true; break;
      case "match-case": f.matchCase = true; break;
      case "domain": case "from": case "to": {
        if (value == null) return false;
        const ds = value.toLowerCase().split("|").filter(Boolean);
        if (ds.some(d => d.includes("/"))) return false;   // regex domains
        const inc = ds.filter(d => d[0] !== "~"), exc = ds.filter(d => d[0] === "~").map(d => d.slice(1));
        if (name === "to") { f.toDomains = inc.length ? inc : null; f.notToDomains = exc.length ? exc : null; }
        else { f.domains = inc.length ? inc : null; f.notDomains = exc.length ? exc : null; }
        break;
      }
      case "redirect": case "rewrite": case "empty": case "mp4": f.redirect = true; break;
      case "redirect-rule": return false;
      case "generichide": case "ghide": f.hide = 1; break;
      case "specifichide": case "shide": f.hide = 2; break;
      case "elemhide": case "ehide": f.hide = 3; break;
      case "removeparam": case "queryprune":
        if (exception || !value) return false;
        if (value.length > 2 && value[0] === "/" && value[value.length - 1] === "/") {
          try { f.removeParamRegex = new RegExp(value.slice(1, -1), "i"); } catch { return false; }
        } else if (value[0] === "~") return false;
        else f.removeParam = value;
        break;
      default:
        if (Ignored.has(name)) break;
        return false;
    }
  }
  if (popupOnly && !include) return false;
  if (include) f.types = include & ~exclude;
  else if (exclude) f.types = T.AllButDocument & ~exclude;
  return f.types !== 0 || f.hide !== 0;
}

function pureHost(p) {
  if (!p.endsWith("^")) return null;
  const host = p.slice(0, -1);
  if (!host || !/^[\p{L}\p{N}._-]+$/u.test(host) || !host.includes(".")) return null;
  return host;
}

// The longest run of letters/digits that a matching URL must contain as a whole token.
function bestToken(f) {
  const p = f.pattern;
  let best = null, i = 0;
  while (i < p.length) {
    if (!isTokenChar(p.charCodeAt(i))) { i++; continue; }
    const start = i;
    while (i < p.length && isTokenChar(p.charCodeAt(i))) i++;
    const len = i - start;
    const leftOk = start === 0 ? (f.hostAnchor || f.startAnchor) : p[start - 1] !== "*";
    const rightOk = i === p.length ? f.endAnchor : p[i] !== "*";
    if (len >= 3 && leftOk && rightOk && (!best || len > best.length)) best = p.slice(start, i);
  }
  return best && f.matchCase ? best.toLowerCase() : best;
}

module.exports = { FilterEngine, T, site };
