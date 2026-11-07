// Listing Collector for Etsy: the popup list, export, and settings.

(function () {
  'use strict';

  var BUCKETS = ['ad-research', 'ad-reference', 'product-idea'];
  var DEFAULT_LABELS = {
    'ad-research': 'Ad research',
    'ad-reference': 'Ad reference',
    'product-idea': 'Product idea'
  };
  var COLUMNS = [
    ['List', function (r) { return labels[r.bucket] || r.bucket; }],
    ['Title', 'title'],
    ['Listing URL', 'url'],
    ['Shop', 'shop'],
    ['Shop URL', 'shopUrl'],
    ['Price', 'price'],
    ['Original price', 'originalPrice'],
    ['Ad', 'isAd'],
    ['Date added', function (r) { return formatDate(r.addedAt); }],
    ['Note', 'note'],
    ['Search term', 'searchTerm'],
    ['Found on', 'sourceUrl'],
    ['Listing ID', 'id'],
    ['Image URL', 'image']
  ];

  var store = chrome.storage.local;
  var items = {};
  var labels = Object.assign({}, DEFAULT_LABELS);
  var filter = 'all';
  var privacyOn = false;

  var $ = function (id) { return document.getElementById(id); };

  if (new URLSearchParams(location.search).get('page') === '1') {
    document.body.classList.add('full');
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('toast--show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('toast--show'); }, 1800);
  }

  function load(cb) {
    store.get(['items', 'labels', 'privacyMode'], function (data) {
      items = data.items || {};
      labels = Object.assign({}, DEFAULT_LABELS, data.labels || {});
      privacyOn = !!data.privacyMode;
      cb();
    });
  }

  function visibleItems() {
    var list = Object.keys(items).map(function (k) { return items[k]; });
    if (filter !== 'all') list = list.filter(function (r) { return r.bucket === filter; });
    list.sort(function (a, b) { return (b.addedAt || '').localeCompare(a.addedAt || ''); });
    return list;
  }

  function cell(r, col) {
    var v = typeof col[1] === 'function' ? col[1](r) : r[col[1]];
    return v == null ? '' : String(v);
  }

  // ---------- render ----------

  function renderTabs() {
    var tabs = $('tabs');
    tabs.innerHTML = '';
    var all = Object.keys(items).length;
    var defs = [['all', 'All', all]].concat(BUCKETS.map(function (b) {
      var n = Object.keys(items).filter(function (k) { return items[k].bucket === b; }).length;
      return [b, labels[b], n];
    }));
    defs.forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab' + (filter === d[0] ? ' tab--active' : '');
      btn.textContent = d[1];
      var c = document.createElement('span');
      c.className = 'tab__count';
      c.textContent = d[2];
      btn.appendChild(c);
      btn.addEventListener('click', function () { filter = d[0]; render(); });
      tabs.appendChild(btn);
    });
  }

  function renderList() {
    var list = $('list');
    list.innerHTML = '';
    var rows = visibleItems();
    $('empty').hidden = rows.length > 0;
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row';

      var img = document.createElement('img');
      img.className = 'row__img';
      img.alt = '';
      if (r.image) img.src = r.image;
      row.appendChild(img);

      var mid = document.createElement('div');
      var a = document.createElement('a');
      a.className = 'row__title';
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = r.title || r.url;
      a.title = r.title || '';
      mid.appendChild(a);

      var meta = document.createElement('div');
      meta.className = 'row__meta';
      var bits = [];
      // With Privacy Mode on, the list hides shop names too, in case it is on
      // screen while recording. Exports still include them.
      if (r.shop) bits.push(privacyOn ? 'Shop hidden' : r.shop);
      if (r.price) bits.push(r.price + (r.originalPrice ? ' (was ' + r.originalPrice + ')' : ''));
      bits.push(formatDate(r.addedAt));
      bits.forEach(function (b) {
        var s = document.createElement('span');
        s.textContent = b;
        meta.appendChild(s);
      });
      if (r.isAd === 'Yes') {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'Ad';
        meta.appendChild(badge);
      }
      mid.appendChild(meta);

      var note = document.createElement('input');
      note.className = 'row__note';
      note.type = 'text';
      note.placeholder = 'Add a note';
      note.value = r.note || '';
      note.addEventListener('change', function () {
        items[r.id].note = note.value;
        store.set({ items: items }, function () { toast('Note saved'); });
      });
      mid.appendChild(note);
      row.appendChild(mid);

      var side = document.createElement('div');
      side.className = 'row__side';
      var sel = document.createElement('select');
      sel.className = 'row__bucket';
      BUCKETS.forEach(function (b) {
        var o = document.createElement('option');
        o.value = b;
        o.textContent = labels[b];
        if (r.bucket === b) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        items[r.id].bucket = sel.value;
        store.set({ items: items }, function () { render(); toast('Moved'); });
      });
      side.appendChild(sel);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'row__delete';
      del.textContent = 'Remove';
      del.addEventListener('click', function () {
        delete items[r.id];
        store.set({ items: items }, function () { render(); toast('Removed'); });
      });
      side.appendChild(del);
      row.appendChild(side);

      list.appendChild(row);
    });
  }

  function renderSettings() {
    var inputs = document.querySelectorAll('#settings input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].value = labels[inputs[i].getAttribute('data-bucket')] || '';
    }
  }

  function renderPrivacy() {
    $('privacyMode').checked = privacyOn;
    $('privacyRow').classList.toggle('privacy--on', privacyOn);
    $('privacyHelp').textContent = privacyOn
      ? 'On. Shop names, logos, owners and reviewers are hidden on every Etsy page.'
      : 'Turn on before you record. Hides shop names, logos, owners and reviewers on Etsy pages.';
  }

  function render() {
    renderPrivacy();
    renderTabs();
    renderList();
    renderSettings();
  }

  // ---------- export ----------

  function csvEscape(v) {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function buildTable(rows, sep, escape) {
    var head = COLUMNS.map(function (c) { return escape(c[0]); }).join(sep);
    var body = rows.map(function (r) {
      return COLUMNS.map(function (c) { return escape(cell(r, c)); }).join(sep);
    });
    return [head].concat(body).join('\r\n');
  }

  function filterName() {
    return filter === 'all' ? 'all-lists' : (labels[filter] || filter).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function exportCsv() {
    var rows = visibleItems();
    if (!rows.length) { toast('Nothing to export'); return; }
    var csv = '﻿' + buildTable(rows, ',', csvEscape);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var today = formatDate(new Date().toISOString()).slice(0, 10);
    a.href = url;
    a.download = 'etsy-listings-' + filterName() + '-' + today + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('CSV downloaded (' + rows.length + ' rows)');
  }

  function copyTsv() {
    var rows = visibleItems();
    if (!rows.length) { toast('Nothing to copy'); return; }
    var tsv = buildTable(rows, '\t', function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); });
    var done = function () { toast('Copied ' + rows.length + ' rows. Click a cell in Google Sheets and paste.'); };
    var fallback = function () {
      // Older copy method, used only if the clipboard API refuses.
      var ta = document.createElement('textarea');
      ta.value = tsv;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else toast('Copy failed. Try Download CSV instead.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(done, fallback);
    } else {
      fallback();
    }
  }

  function clearList() {
    var rows = visibleItems();
    if (!rows.length) { toast('Already empty'); return; }
    var what = filter === 'all' ? 'every saved listing' : 'the ' + rows.length + ' listing(s) in ' + labels[filter];
    if (!confirm('Remove ' + what + '? Export first if you want to keep them.')) return;
    rows.forEach(function (r) { delete items[r.id]; });
    store.set({ items: items }, function () { render(); toast('Cleared'); });
  }

  // ---------- wire up ----------

  $('exportCsv').addEventListener('click', exportCsv);
  $('copyTsv').addEventListener('click', copyTsv);
  $('clearList').addEventListener('click', clearList);
  $('toggleSettings').addEventListener('click', function () {
    $('settings').hidden = !$('settings').hidden;
  });
  $('privacyMode').addEventListener('change', function (e) {
    privacyOn = e.target.checked;
    store.set({ privacyMode: privacyOn }, function () {
      render();
      toast(privacyOn ? 'Privacy Mode on' : 'Privacy Mode off');
    });
  });
  $('openPage').addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?page=1') });
  });

  var inputs = document.querySelectorAll('#settings input');
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener('change', function (e) {
      var b = e.target.getAttribute('data-bucket');
      var v = e.target.value.trim() || DEFAULT_LABELS[b];
      labels[b] = v;
      e.target.value = v;
      store.set({ labels: labels }, function () { render(); toast('List renamed'); });
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.items) items = changes.items.newValue || {};
    if (changes.labels) labels = Object.assign({}, DEFAULT_LABELS, changes.labels.newValue || {});
    if (changes.privacyMode) privacyOn = !!changes.privacyMode.newValue;
    render();
  });

  load(render);
})();
