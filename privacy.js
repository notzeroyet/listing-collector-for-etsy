// Listing Collector for Etsy: Privacy Mode.
//
// While Privacy Mode is switched on in the popup, this hides who is behind the
// listings on every Etsy page, so a screen recording can show what sells
// without naming the seller or the buyers:
//   - shop names (search cards and their "Ad by" line, listing pages, shop
//     pages, "Owner of", "Message", headings and any text naming the shop)
//   - shop logos, shop banners, the owner's name and photo
//   - reviewer names, reviewer avatars and buyer review photos
// Product photos, titles, prices, sales counts and badges stay visible.
//
// How it works without changing Etsy's own page:
//   - Names get a gray bar through Chrome's text highlight feature (the CSS
//     Custom Highlight API). The words are still in the page, so the save
//     buttons in content.js read the shop name exactly as before.
//   - Logos, banners, owner photos, avatars and review photos are blurred by
//     privacy.css.
//   - A link to a shop or a buyer profile loses its address only while the
//     mouse rests on it, so Chrome's link preview in the bottom corner cannot
//     show the name. The address comes back the moment the mouse is pressed.
//
// This file runs at document_start and assumes Privacy Mode is on until the
// saved setting arrives a few milliseconds later, so a page never flashes a
// name while it loads.

(function () {
  'use strict';
  if (window.__elcPrivacyLoaded) return;
  window.__elcPrivacyLoaded = true;

  var STORE_KEY = 'privacyMode';
  var ROOT_ATTR = 'data-elc-privacy';
  var HIGHLIGHT_NAME = 'elc-private';
  var HIDDEN_TITLE = 'Shop name hidden';

  // Elements whose whole text is a shop, owner or reviewer name.
  var KNOWN_NAMES = [
    '[data-seller-name-link]',           // search cards: "Ad · By ShopName"
    '.clickable-shop-name',
    '[data-seller-cred-anchor]',         // listing page: shop name beside the stars
    'h1.shop-name',                      // shop page heading
    '.shop-name-and-title-container h1',
    '.larger-name',                      // shop page: owner name
    '[data-review-username]',            // listing page: reviewer name
    '.shop2-review-attribution'          // shop page: "reviewer on Nov 6, 2026"
  ].join(',');
  // Etsy marks personal data with fs-mask for its own analytics. It sits on
  // reviewer and owner names, and also on a few checkout buttons, which are skipped.
  var NAME_ELEMENTS = KNOWN_NAMES + ', .fs-mask';
  var FS_SKIP = 'button, label, [role="button"], [class*="checkout"]';

  // Where the owner's first name and a spaced out shop name ("Mary's Fashion
  // Shop") are hidden too. On a shop page that is the whole page.
  var SELLER_ZONES = [
    '[data-appears-component-name="lp_existing_shop_header"]',
    '[data-appears-component-name="shop_owners"]',
    '[data-appears-component-name="listing_page_seller_details"]',
    '[data-appears-component-name="product_details"]',
    '[data-appears-component-name*="review"]',
    '[data-appears-component-name*="polic"]',
    '[data-review-region]',
    '[class*="review"]',
    '[id*="review"]'
  ].join(',');

  // Listing cards. A product title such as "Hockey Mom Sweatshirt" is never
  // hidden just because a shop called HockeyMom exists.
  var CARDS = '[data-listing-id], [data-listing-card-v2], .v2-listing-card, .listing-link';

  var OWNER_NAMES = [
    '[data-appears-component-name="shop_owners"] .fs-mask',
    '.larger-name',
    '.shop-owner-name'
  ].join(',');
  var OWNER_PHOTOS = '[data-appears-component-name="shop_owners"] img[alt]';

  // Never touched: form fields, page code, and this extension's own buttons.
  var SKIP = 'script, style, noscript, template, textarea, input, select, option, ' +
    '[contenteditable=""], [contenteditable="true"], .elc-bar, .elc-panel, .elc-privacy-badge';

  var STOP_WORDS = /^(etsy|shop|shops|seller|sellers|buyer|owner|owners|store|the|this|and|ad|ads|by|from|more|visit|contact|message|follow|home|about|review|reviews|sale|item|items|family|team|co)$/i;
  var DATE_TAIL = /\s+on\s+[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}/;
  var PROFILE_LINK = /\/(shop|people)\/[^/?#]/;

  var store = (window.chrome && chrome.storage && chrome.storage.local) || null;
  var on = true;
  var shops = {};   // lowercase name -> name as Etsy writes it
  var owners = {};
  var patterns = { anywhere: null, zone: null };
  var highlight = null;
  var masked = new WeakMap();
  var fullTimer = null;
  var titleOriginal = null;
  var titleMasked = null;
  var guarded = false;

  // ---------- helpers ----------

  function each(root, selector, fn) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(selector)) fn(root);
    var list = root.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  function skipped(el) {
    return !el || !!el.closest(SKIP);
  }

  function isShopPage() {
    return location.pathname.indexOf('/shop/') === 0;
  }

  function test(re, s) {
    if (!re || !s) return false;
    re.lastIndex = 0;
    var hit = re.test(s);
    re.lastIndex = 0;
    return hit;
  }

  function ensureHighlight() {
    if (highlight) return true;
    if (typeof Highlight !== 'function' || !window.CSS || !CSS.highlights) return false;
    highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    return true;
  }

  // ---------- learning the names on this page ----------

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "MarysFashionShop" also matches "Marys Fashion Shop" and "Mary's Fashion Shop".
  function spacedPattern(name) {
    var parts = name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g);
    if (!parts || parts.length < 2 || parts.join('') !== name) return '';
    return parts.map(function (p) {
      return /^[A-Za-z]{3,}s$/.test(p) ? p.slice(0, -1) + "['’]?s" : escapeRe(p);
    }).join("[\\s_.'’-]*");
  }

  function wordRe(list) {
    if (!list.length) return null;
    list.sort(function (a, b) { return b.length - a.length; });
    return new RegExp('(?<![\\p{L}\\p{N}])(?:' + list.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  }

  function rebuildPatterns() {
    var anywhere = [];
    var zone = [];
    Object.keys(shops).forEach(function (k) {
      var name = shops[k];
      var spaced = spacedPattern(name);
      // A name like "MarysFashionShop" or "hockeymama" is distinctive enough to
      // hide anywhere. A short one word name like "Bloom" is only hidden where
      // it shows as a shop name, so the word "bloom" in a title stays.
      if (spaced || name.length >= 6) anywhere.push(escapeRe(name));
      zone.push(spaced || escapeRe(name));
    });
    Object.keys(owners).forEach(function (k) {
      zone.push(escapeRe(owners[k]).replace(/\s+/g, '\\s+'));
    });
    patterns.anywhere = wordRe(anywhere);
    patterns.zone = wordRe(zone);
  }

  function learnShop(raw) {
    var name = String(raw || '').replace(/[^A-Za-z0-9]/g, '');
    if (name.length < 3 || name.length > 40 || STOP_WORDS.test(name)) return false;
    var key = name.toLowerCase();
    if (shops[key]) return false;
    shops[key] = name;
    return true;
  }

  // "Mary" hides "Mary"; "Mary & John" hides the pair and each first name.
  function learnOwner(raw) {
    var name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 40 || /^etsy\b/i.test(name)) return false;
    var changed = false;
    [name].concat(name.split(/[\s&,+/]+/)).forEach(function (word, i) {
      word = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (word.length < (i === 0 ? 2 : 3) || STOP_WORDS.test(word)) return;
      var key = word.toLowerCase();
      if (owners[key]) return;
      owners[key] = word;
      changed = true;
    });
    return changed;
  }

  function shopFromUrl(url) {
    var m = String(url || '').match(/\/shop\/([A-Za-z0-9]+)/);
    return m ? m[1] : '';
  }

  function learn(root) {
    var changed = false;
    if (isShopPage() && learnShop(shopFromUrl(location.pathname))) changed = true;
    each(root, 'a[href*="/shop/"], a[data-elc-href*="/shop/"], [data-shop-url]', function (el) {
      var url = el.getAttribute('data-shop-url') || el.getAttribute('data-elc-href') || el.getAttribute('href');
      if (learnShop(shopFromUrl(url))) changed = true;
    });
    each(root, OWNER_NAMES, function (el) {
      if (!el.closest(FS_SKIP) && learnOwner(el.textContent)) changed = true;
    });
    each(root, OWNER_PHOTOS, function (el) {
      if (learnOwner(el.getAttribute('alt'))) changed = true;
    });
    if (changed) rebuildPatterns();
    return changed;
  }

  // ---------- gray bars over names ----------

  function addRange(node, start, end) {
    var v = node.nodeValue;
    while (start < end && /\s/.test(v.charAt(start))) start++;
    while (end > start && /\s/.test(v.charAt(end - 1))) end--;
    if (start >= end) return;
    var key = start + ':' + end;
    var keys = masked.get(node);
    if (keys) {
      if (keys.indexOf(key) !== -1) return;
    } else {
      keys = [];
      masked.set(node, keys);
    }
    keys.push(key);
    var range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    highlight.add(range);
  }

  function maskElement(el) {
    if (skipped(el)) return;
    // fs-mask alone: only short text outside buttons and the checkout sheet is a name.
    if (!el.matches(KNOWN_NAMES) && (el.closest(FS_SKIP) || el.textContent.trim().length > 80)) return;
    // "mary on Nov 6, 2026": hide the linked name and keep the date.
    var targets = [el];
    if (el.tagName !== 'A' && el.matches('.fs-mask, .shop2-review-attribution') && el.querySelector('a')) {
      targets = el.querySelectorAll('a');
    }
    for (var i = 0; i < targets.length; i++) {
      var walker = document.createTreeWalker(targets[i], NodeFilter.SHOW_TEXT);
      var t;
      while ((t = walker.nextNode())) {
        var cut = t.nodeValue.search(DATE_TAIL);
        addRange(t, 0, cut === -1 ? t.nodeValue.length : cut);
      }
    }
  }

  function maskMatches(re, node) {
    var v = node.nodeValue;
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(v))) {
      addRange(node, m.index, m.index + m[0].length);
      if (!m[0].length) re.lastIndex++;
    }
    re.lastIndex = 0;
  }

  function inSellerZone(el) {
    if (el.closest(CARDS)) return false;
    return isShopPage() || !!el.closest(SELLER_ZONES);
  }

  function scanTextNode(node) {
    var v = node.nodeValue;
    var parent = node.parentElement;
    if (!parent || !v || !/\S/.test(v)) return;
    var hitAnywhere = test(patterns.anywhere, v);
    var hitZone = test(patterns.zone, v);
    if (!hitAnywhere && !hitZone) return;
    if (skipped(parent)) return;
    if (hitAnywhere) maskMatches(patterns.anywhere, node);
    if (hitZone && inSellerZone(parent)) maskMatches(patterns.zone, node);
  }

  function stripTitles(root) {
    each(root, '[title]', function (el) {
      var t = el.getAttribute('title');
      if (test(patterns.anywhere, t) || test(patterns.zone, t)) {
        el.setAttribute('data-elc-title', t);
        el.removeAttribute('title');
      }
    });
  }

  function scan(root) {
    if (!on || !highlight || !root) return;
    if (root.nodeType === 3) {
      var host = root.parentElement && root.parentElement.closest(NAME_ELEMENTS);
      if (host) maskElement(host);
      scanTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    var outer = root.parentElement && root.parentElement.closest(NAME_ELEMENTS);
    if (outer) maskElement(outer);
    each(root, NAME_ELEMENTS, maskElement);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var t;
    while ((t = walker.nextNode())) scanTextNode(t);
    stripTitles(root);
  }

  // ---------- the tab title on shop pages ----------

  function maskDocTitle() {
    var t = document.title;
    if (!t || t === titleMasked) return;
    var next = t;
    [patterns.anywhere, isShopPage() ? patterns.zone : null].forEach(function (re) {
      if (re) { re.lastIndex = 0; next = next.replace(re, HIDDEN_TITLE); re.lastIndex = 0; }
    });
    if (next === t) return;
    titleOriginal = t;
    titleMasked = next;
    document.title = next;
  }

  function restoreDocTitle() {
    if (titleMasked !== null && document.title === titleMasked) document.title = titleOriginal;
    titleOriginal = titleMasked = null;
  }

  // ---------- full pass ----------

  function fullScan() {
    clearTimeout(fullTimer);
    if (!on || !ensureHighlight() || !document.documentElement) return;
    learn(document.documentElement);
    // Clear and rebuild in one go, so nothing is uncovered in between.
    highlight.clear();
    masked = new WeakMap();
    scan(document.documentElement);
    maskDocTitle();
  }

  function scheduleFull(ms) {
    clearTimeout(fullTimer);
    fullTimer = setTimeout(fullScan, ms);
  }

  // New results, more reviews, a popup opening: mask them before they are drawn.
  var observer = new MutationObserver(function (muts) {
    if (!on) return;
    setRootFlag(true);
    var roots = [];
    var titleTouched = false;
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.target && m.target.nodeName === 'TITLE') titleTouched = true;
      if (m.type === 'characterData') {
        roots.push(m.target);
        if (m.target.parentNode && m.target.parentNode.nodeName === 'TITLE') titleTouched = true;
        continue;
      }
      for (var j = 0; j < m.addedNodes.length; j++) roots.push(m.addedNodes[j]);
    }
    if (!roots.length) return;
    var learned = false;
    for (var k = 0; k < roots.length; k++) {
      if (roots[k].nodeType === 1 && learn(roots[k])) learned = true;
    }
    for (var n = 0; n < roots.length; n++) scan(roots[n]);
    if (titleTouched) maskDocTitle();
    // A name learned just now may also appear in text that was already on the page.
    scheduleFull(learned ? 120 : 1200);
  });

  // ---------- link previews in Chrome's bottom corner ----------

  function linkFrom(target) {
    return target && target.closest ? target.closest('a') : null;
  }

  function hideHref(a) {
    var h = a.getAttribute('href');
    if (!h || !PROFILE_LINK.test(h) || skipped(a)) return;
    a.setAttribute('data-elc-href', h);
    a.removeAttribute('href');
  }

  function showHref(a) {
    if (!a.hasAttribute('data-elc-href')) return;
    a.setAttribute('href', a.getAttribute('data-elc-href'));
    a.removeAttribute('data-elc-href');
  }

  document.addEventListener('mouseover', function (e) {
    if (!on) return;
    var a = linkFrom(e.target);
    if (a && a.hasAttribute('href')) hideHref(a);
  }, true);

  document.addEventListener('mouseout', function (e) {
    var a = linkFrom(e.target);
    if (!a || !a.hasAttribute('data-elc-href')) return;
    if (e.relatedTarget && a.contains(e.relatedTarget)) return;
    showHref(a);
  }, true);

  // Pressing the mouse puts the address back, so clicking, opening in a new
  // tab and the right click menu all work as usual.
  document.addEventListener('mousedown', function (e) {
    var a = linkFrom(e.target);
    if (!a || !a.hasAttribute('data-elc-href')) return;
    showHref(a);
    var rehide = function () {
      document.removeEventListener('mouseup', rehide, true);
      setTimeout(function () {
        if (on && a.matches(':hover')) hideHref(a);
      }, 50);
    };
    document.addEventListener('mouseup', rehide, true);
  }, true);

  // ---------- the badge ----------

  function addBadge() {
    if (document.getElementById('elc-privacy-badge')) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', addBadge, { once: true });
      return;
    }
    var badge = document.createElement('div');
    badge.id = 'elc-privacy-badge';
    badge.className = 'elc-privacy-badge';
    badge.textContent = 'Privacy Mode On';
    document.body.appendChild(badge);
  }

  // ---------- switching on and off ----------

  // privacy.css only acts while <html data-elc-privacy="on">. A data attribute
  // rather than a class, because Etsy's scripts may rewrite the page's classes.
  function setRootFlag(value) {
    var h = document.documentElement;
    if (!h) return;
    if (value) {
      if (h.getAttribute(ROOT_ATTR) !== 'on') h.setAttribute(ROOT_ATTR, 'on');
    } else if (h.hasAttribute(ROOT_ATTR)) {
      h.removeAttribute(ROOT_ATTR);
    }
    if (!guarded) {
      guarded = true;
      new MutationObserver(function () { setRootFlag(on); })
        .observe(h, { attributes: true, attributeFilter: [ROOT_ATTR] });
    }
  }

  function apply(value) {
    on = !!value;
    setRootFlag(on);
    if (on) {
      fullScan();
      addBadge();
      return;
    }
    clearTimeout(fullTimer);
    if (highlight) highlight.clear();
    masked = new WeakMap();
    each(document.documentElement, '[data-elc-title]', function (el) {
      el.setAttribute('title', el.getAttribute('data-elc-title'));
      el.removeAttribute('data-elc-title');
    });
    each(document.documentElement, 'a[data-elc-href]', showHref);
    restoreDocTitle();
  }

  // ---------- boot ----------

  setRootFlag(true);
  ensureHighlight();
  observer.observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', function () {
    setRootFlag(on);
    if (on) fullScan();
  });

  if (store) {
    store.get([STORE_KEY], function (data) {
      apply(!!(data && data[STORE_KEY]));
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes[STORE_KEY]) apply(!!changes[STORE_KEY].newValue);
    });
  } else {
    apply(false);
  }
})();
