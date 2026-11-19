/*
 * Right-click a folder (or its label) to pick a colour. Only active in the browser where the owner has opened
 * /admin/ (admin sets localStorage "owner"), so ordinary visitors never see this menu.
 */
(function () {
  var owner = false;
  try { owner = localStorage.getItem('owner') === '1'; } catch (e) { /* storage blocked */ }
  if (!owner) return;

  // Soft pastel suggestions (name, colour).
  var PASTELS = [
    ['Pink', '#f6b6cb'], ['Rose', '#f4a9a8'], ['Peach', '#ffc9a3'], ['Apricot', '#ffd9a0'],
    ['Butter', '#fbe08a'], ['Lime', '#d3eaa2'], ['Mint', '#a8e6cf'], ['Aqua', '#a0e1e8'],
    ['Sky', '#a9d1f7'], ['Periwinkle', '#b9c3f5'], ['Lavender', '#d0b8f2'], ['Lilac', '#ebb7ea'],
    ['Sand', '#e6d3b3'], ['Cloud', '#cfd4da'],
  ];

  // Same maths as darken() in src/worker/render.ts.
  function darken(hex, f) {
    f = f || 0.8;
    var n = parseInt(hex.slice(1), 16);
    function ch(v) { var h = Math.round(v * f).toString(16); return h.length < 2 ? '0' + h : h; }
    return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
  }

  var css = document.createElement('style');
  css.textContent =
    '.fc-menu{position:fixed;z-index:1000;width:250px;background:#fff;border:1px solid #e6e1d9;border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.22);padding:12px 14px 10px;font:14px/1.3 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2430}' +
    '.fc-menu h4{margin:0 0 10px;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}' +
    '.fc-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}' +
    '.fc-sw{width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.14);cursor:pointer;padding:0}' +
    '.fc-sw:hover{transform:scale(1.15);box-shadow:0 0 0 2px #b4442b}' +
    '.fc-sw.on{box-shadow:0 0 0 2px #1f2430}' +
    '.fc-row{display:flex;gap:8px;margin-top:12px;align-items:center}' +
    '.fc-btn{flex:1;font:inherit;padding:7px 10px;border:1px solid #e6e1d9;border-radius:8px;background:#fff;cursor:pointer;color:#1f2430}' +
    '.fc-btn:hover{background:#f6f3ee}' +
    '.fc-custom{position:relative;overflow:hidden}' +
    '.fc-custom input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}' +
    '.fc-note{margin:8px 0 0;font-size:.75rem;color:#6b7280}';
  document.head.appendChild(css);

  var menu = null;
  var currentKey = '';

  function close() { if (menu) { menu.remove(); menu = null; } }

  function apply(key, color) {
    var els = document.querySelectorAll('[data-folder]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-folder') !== key) continue;
      var back = darken(color);
      els[i].style.setProperty('--front', color);
      els[i].style.setProperty('--back', back);
      els[i].style.setProperty('--c', back);
    }
  }

  function save(key, color) {
    return fetch('/api/folder-colors/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: color || '' }),
    }).then(function (r) {
      if (!r.ok) throw new Error('save failed');
    });
  }

  function choose(key, color) {
    close();
    apply(key, color);
    save(key, color).catch(function () {
      alert('Could not save the folder colour. Reload the page and try again.');
    });
  }

  function open(el, x, y) {
    close();
    currentKey = el.getAttribute('data-folder');
    var now = (el.style.getPropertyValue('--front') || '').trim().toLowerCase();
    menu = document.createElement('div');
    menu.className = 'fc-menu';
    var html = '<h4>Folder color</h4><div class="fc-grid">';
    for (var i = 0; i < PASTELS.length; i++) {
      html += '<button type="button" class="fc-sw' + (PASTELS[i][1] === now ? ' on' : '') + '" data-c="' + PASTELS[i][1] + '" title="' + PASTELS[i][0] + '" style="background:' + PASTELS[i][1] + '"></button>';
    }
    html += '</div><div class="fc-row"><button type="button" class="fc-btn" data-reset="1">Reset</button>' +
      '<label class="fc-btn fc-custom">Custom…<input type="color" value="' + (/^#[0-9a-f]{6}$/.test(now) ? now : '#f6b6cb') + '"></label></div>';
    menu.innerHTML = html;
    document.body.appendChild(menu);
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';

    menu.addEventListener('click', function (e) {
      var t = e.target;
      var c = t.getAttribute && t.getAttribute('data-c');
      if (c) return choose(currentKey, c);
      if (t.getAttribute && t.getAttribute('data-reset')) {
        close();
        save(currentKey, '').then(function () { location.reload(); });
      }
    });
    menu.querySelector('input[type=color]').addEventListener('change', function (e) { choose(currentKey, e.target.value); });
  }

  document.addEventListener('contextmenu', function (e) {
    var el = e.target.closest && e.target.closest('[data-folder]');
    if (!el) { close(); return; }
    e.preventDefault();
    open(el, e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', function (e) { if (menu && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);

  // Hint for the owner
  var cards = document.querySelectorAll('.folder[data-folder]');
  for (var i = 0; i < cards.length; i++) cards[i].setAttribute('title', 'Right-click to change the folder color');
})();
