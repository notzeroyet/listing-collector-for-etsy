// Listing Collector for Etsy: runs on every Etsy page.
// On search, category, market, and shop pages it adds a row of three save
// buttons under each listing card. On a single listing page it adds a small
// floating panel with the same three buttons.

(function () {
  'use strict';
  if (window.__etsyListingCollectorLoaded) return;
  window.__etsyListingCollectorLoaded = true;

  var BUCKETS = ['ad-research', 'ad-reference', 'product-idea'];
  var DEFAULT_LABELS = {
    'ad-research': 'Ad research',
    'ad-reference': 'Ad reference',
    'product-idea': 'Product idea'
  };

  var store = chrome.storage.local;
  var items = {};
  var labels = Object.assign({}, DEFAULT_LABELS);

  // ---------- storage ----------

  function load(cb) {
    store.get(['items', 'labels'], function (data) {
      items = data.items || {};
      labels = Object.assign({}, DEFAULT_LABELS, data.labels || {});
      if (cb) cb();
    });
  }

  function saveItems(cb) {
    store.set({ items: items }, cb);
  }

  // ---------- helpers ----------

  function text(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function listingIdFromUrl(url) {
    var m = String(url || '').match(/\/listing\/(\d+)/);
    return m ? m[1] : '';
  }

  function cleanListingUrl(url) {
    try {
      var u = new URL(url, location.href);
      var m = u.pathname.match(/^\/listing\/\d+(?:\/[^/]+)?/);
      return 'https://www.etsy.com' + (m ? m[0] : u.pathname);
    } catch (e) {
      return url;
    }
  }

  function searchTermFromUrl(url) {
    try {
      var u = new URL(url, location.href);
      var q = u.searchParams.get('q') || u.searchParams.get('search_query') || '';
      if (q) return q;
      var m = u.pathname.match(/^\/(?:market|c)\/(.+)$/);
      return m ? decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').replace(/\//g, ' > ') : '';
    } catch (e) {
      return '';
    }
  }

  function moneyFrom(el) {
    if (!el) return '';
    var sym = text(el.querySelector('.currency-symbol'));
    var val = text(el.querySelector('.currency-value'));
    if (val) return (sym || '') + val;
    var m = text(el).match(/(?:[$€£]|[A-Z]{2,3}\$|[A-Z]{3})\s?[\d,]+(?:\.\d+)?\+?/);
    return m ? m[0].replace(/\s+/g, '') : '';
  }

  // ---------- reading a listing card on a results page ----------

  function readCard(card) {
    var link = card.querySelector('a[href*="/listing/"]');
    if (!link) return null;
    var id = card.getAttribute('data-listing-id') || listingIdFromUrl(link.href);
    if (!id) return null;

    var title = text(card.querySelector('.v2-listing-card__title, h3, h2'))
      || link.getAttribute('aria-label')
      || (card.querySelector('img') ? card.querySelector('img').alt : '')
      || text(link);

    var shop = '';
    var isAd = false;
    var shopP = card.querySelector('.shop-name-with-rating p, [class*="shop-name"] p, [class*="shop-name"]');
    var shopText = text(shopP);
    // Etsy shop names never contain spaces, so the first word after "By" is the name.
    var m = shopText.match(/\bBy\s+(\S+)/i);
    if (m) shop = m[1];
    if (!shop) {
      var m2 = text(card).match(/\bfrom shop\s+(\S+)/i);
      if (m2) shop = m2[1];
    }
    var cardText = text(card);
    if (/^Ad\b/.test(shopText) || /\bAd\s*[・·]\s*By\b/.test(cardText) || /\bAd from shop\b/i.test(cardText)) {
      isAd = true;
    }

    var priceBox = card.querySelector('.n-listing-card__price, .lc-price, [class*="price"]') || card;
    var salePriceEl = priceBox.querySelector('p:not(.search-collage-original-price), .lc-price') || priceBox;
    var price = moneyFrom(salePriceEl);
    var originalEl = priceBox.querySelector('.wt-text-strikethrough, [class*="original"]');
    var originalPrice = originalEl ? moneyFrom(originalEl) : '';
    if (originalPrice && originalPrice === price) originalPrice = '';

    var img = card.querySelector('img');

    return {
      id: id,
      url: cleanListingUrl(link.href),
      title: title,
      shop: shop,
      shopId: card.getAttribute('data-shop-id') || '',
      shopUrl: shop ? 'https://www.etsy.com/shop/' + shop : '',
      price: price,
      originalPrice: originalPrice,
      isAd: isAd ? 'Yes' : 'No',
      image: img ? (img.getAttribute('data-preload-lp-src') || img.src || '') : '',
      sourceUrl: location.href.split('#')[0],
      searchTerm: searchTermFromUrl(location.href)
    };
  }

  // ---------- reading a single listing page ----------

  function readListingPage() {
    var id = listingIdFromUrl(location.pathname);
    if (!id) return null;
    var title = text(document.querySelector('h1'));
    var priceRegion = document.querySelector('[data-buy-box-region="price"]');
    var price = '';
    var originalPrice = '';
    if (priceRegion) {
      price = moneyFrom(priceRegion.querySelector('.wt-text-title-larger, [data-selector="price-only"]') || priceRegion);
      var caps = priceRegion.querySelectorAll('.wt-text-caption, .wt-text-strikethrough');
      for (var i = 0; i < caps.length; i++) {
        if (/original/i.test(text(caps[i])) || caps[i].classList.contains('wt-text-strikethrough')) {
          originalPrice = moneyFrom(caps[i]);
          break;
        }
      }
    }
    var shop = '';
    var shopLinks = document.querySelectorAll('a[href*="/shop/"]');
    for (var j = 0; j < shopLinks.length; j++) {
      var m = shopLinks[j].href.match(/\/shop\/([^/?#]+)/);
      var t = text(shopLinks[j]);
      if (m && t && t.toLowerCase() === m[1].toLowerCase()) { shop = m[1]; break; }
    }
    if (!shop) {
      for (var k = 0; k < shopLinks.length; k++) {
        var mm = shopLinks[k].href.match(/\/shop\/([^/?#]+)/);
        if (mm) { shop = mm[1]; break; }
      }
    }
    var og = document.querySelector('meta[property="og:image"]');
    var canonical = document.querySelector('link[rel="canonical"]');
    return {
      id: id,
      url: cleanListingUrl(canonical ? canonical.href : location.href),
      title: title,
      shop: shop,
      shopId: '',
      shopUrl: shop ? 'https://www.etsy.com/shop/' + shop : '',
      price: price,
      originalPrice: originalPrice,
      isAd: '',
      image: og ? og.content : '',
      sourceUrl: location.href.split('#')[0],
      searchTerm: searchTermFromUrl(document.referrer || '')
    };
  }

  // ---------- saving ----------

  function toggleBucket(record, bucket, bar) {
    var existing = items[record.id];
    if (existing && existing.bucket === bucket) {
      delete items[record.id];
      saveItems(function () { refreshBar(bar, record.id); flash(bar, 'Removed'); });
      return;
    }
    var next = Object.assign({}, existing || {}, record, {
      bucket: bucket,
      addedAt: (existing && existing.addedAt) || new Date().toISOString(),
      note: (existing && existing.note) || ''
    });
    // Keep an ad flag learned on a results page when re-saving from the listing page.
    if (!record.isAd && existing && existing.isAd) next.isAd = existing.isAd;
    items[record.id] = next;
    saveItems(function () { refreshBar(bar, record.id); flash(bar, 'Saved'); });
  }

  function flash(bar, msg) {
    var s = bar.querySelector('.elc-bar__status');
    if (!s) return;
    s.textContent = msg;
    s.classList.add('elc-bar__status--show');
    clearTimeout(s._t);
    s._t = setTimeout(function () { s.classList.remove('elc-bar__status--show'); }, 1400);
  }

  function refreshBar(bar, id) {
    var saved = items[id];
    var btns = bar.querySelectorAll('.elc-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i].getAttribute('data-bucket');
      btns[i].textContent = labels[b] || DEFAULT_LABELS[b];
      btns[i].classList.toggle('elc-btn--active', !!(saved && saved.bucket === b));
      btns[i].title = saved && saved.bucket === b ? 'Saved here. Click again to remove.' : 'Save to ' + (labels[b] || b);
    }
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function buildBar(getRecord, id) {
    var bar = document.createElement('div');
    bar.className = 'elc-bar';
    bar.setAttribute('data-elc-id', id);
    var label = document.createElement('span');
    label.className = 'elc-bar__label';
    label.textContent = 'Save:';
    bar.appendChild(label);
    BUCKETS.forEach(function (bucket) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'elc-btn';
      btn.setAttribute('data-bucket', bucket);
      btn.textContent = labels[bucket];
      btn.addEventListener('mousedown', stop, true);
      btn.addEventListener('pointerdown', stop, true);
      btn.addEventListener('click', function (e) {
        stop(e);
        var record = getRecord();
        if (!record) { flash(bar, 'Could not read listing'); return; }
        toggleBucket(record, bucket, bar);
      }, true);
      bar.appendChild(btn);
    });
    var status = document.createElement('span');
    status.className = 'elc-bar__status';
    bar.appendChild(status);
    // Clicks on the bar background should not open the listing either.
    // Bubble phase on purpose: a capture listener here would swallow the
    // click before the button's own handler ran.
    bar.addEventListener('click', stop);
    bar.addEventListener('mousedown', stop);
    refreshBar(bar, id);
    return bar;
  }

  // ---------- results pages ----------

  function findCards() {
    var cards = Array.prototype.slice.call(
      document.querySelectorAll('div.v2-listing-card[data-listing-id], [data-listing-card-v2][data-listing-id]')
    );
    if (cards.length) return cards;
    // Fallback for layouts without the v2 card markup: group listing links by their nearest list item.
    var seen = {};
    var out = [];
    var links = document.querySelectorAll('a[href*="/listing/"]');
    for (var i = 0; i < links.length; i++) {
      var li = links[i].closest('li');
      if (!li || seen[listingIdFromUrl(links[i].href)]) continue;
      var ids = {};
      var inner = li.querySelectorAll('a[href*="/listing/"]');
      for (var j = 0; j < inner.length; j++) ids[listingIdFromUrl(inner[j].href)] = true;
      if (Object.keys(ids).length !== 1) continue;
      seen[listingIdFromUrl(links[i].href)] = true;
      if (!li.getAttribute('data-listing-id')) li.setAttribute('data-listing-id', listingIdFromUrl(links[i].href));
      out.push(li);
    }
    return out;
  }

  function decorateCards() {
    var cards = findCards();
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.querySelector(':scope > .elc-bar, .elc-bar')) continue;
      var rec = readCard(card);
      if (!rec) continue;
      var bar = buildBar((function (c) { return function () { return readCard(c); }; })(card), rec.id);
      card.appendChild(bar);
    }
  }

  function refreshAllBars() {
    var bars = document.querySelectorAll('.elc-bar[data-elc-id]');
    for (var i = 0; i < bars.length; i++) refreshBar(bars[i], bars[i].getAttribute('data-elc-id'));
  }

  // ---------- single listing page ----------

  function buildPanel() {
    if (document.querySelector('.elc-panel')) return;
    var rec = readListingPage();
    if (!rec) return;
    var panel = document.createElement('div');
    panel.className = 'elc-panel';
    var head = document.createElement('div');
    head.className = 'elc-panel__head';
    var name = document.createElement('span');
    name.textContent = 'Listing Collector';
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'elc-panel__toggle';
    toggle.textContent = '–';
    toggle.title = 'Collapse';
    toggle.addEventListener('click', function () {
      var collapsed = panel.classList.toggle('elc-panel--collapsed');
      toggle.textContent = collapsed ? '+' : '–';
      toggle.title = collapsed ? 'Expand' : 'Collapse';
    });
    head.appendChild(name);
    head.appendChild(toggle);
    var title = document.createElement('div');
    title.className = 'elc-panel__title';
    title.textContent = rec.title || rec.url;
    panel.appendChild(head);
    panel.appendChild(title);
    panel.appendChild(buildBar(readListingPage, rec.id));
    document.body.appendChild(panel);
  }

  // ---------- boot ----------

  var scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(run, 250);
  }

  function run() {
    if (/^\/listing\/\d+/.test(location.pathname)) {
      buildPanel();
    }
    decorateCards();
  }

  load(function () {
    run();
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes && muts[i].addedNodes.length) { scheduleScan(); return; }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Etsy navigates without full reloads in places, so watch the URL too.
    var lastUrl = location.href;
    setInterval(function () {
      if (location.href !== lastUrl) { lastUrl = location.href; scheduleScan(); }
    }, 800);
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.items) items = changes.items.newValue || {};
      if (changes.labels) labels = Object.assign({}, DEFAULT_LABELS, changes.labels.newValue || {});
      refreshAllBars();
    });
  }
})();
