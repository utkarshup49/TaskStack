/* =========================================================
   The bottom bar on a phone (v0.16): up to 6 sections you pick + a "More" button.
   More shows every section (to jump to one) and lets you set each section to
   Bar (in the bottom bar), More (only in More) or Off (hidden everywhere).
   The More button itself can be hidden; it comes back from Settings → Bottom bar.
   Laptops (900px+) show every section that isn't Off in the sidebar, as before.
   Device-only: ui.tabBar (ordered view ids), ui.moreBtn. Off = settings.hiddenTabs (syncs).
   ========================================================= */

const NAV_VIEWS = [['tasks', 'Tasks'], ['calendar', 'Calendar'], ['matrix', 'Matrix'], ['focus', 'Focus'], ['habits', 'Habits'], ['colortracker', 'Tracker'], ['notes', 'Notes']];
const TAB_DEFAULT = ['tasks', 'calendar', 'habits', 'colortracker'];
const TAB_MAX = 6;
const TAB_MIN = 2;

function navName(v) { const x = NAV_VIEWS.find(function (n) { return n[0] === v; }); return x ? x[1] : v; }
function sectionOff(v) { return v !== 'tasks' && (state.settings.hiddenTabs || []).indexOf(v) !== -1; }
// The sections in the phone's bottom bar, in order (never an Off one).
function tabBar() {
  const known = NAV_VIEWS.map(function (n) { return n[0]; });
  const saved = Array.isArray(state.ui.tabBar) ? state.ui.tabBar : TAB_DEFAULT;
  const bar = saved.filter(function (v, i) { return known.indexOf(v) !== -1 && !sectionOff(v) && saved.indexOf(v) === i; });
  return bar.length ? bar : ['tasks'];
}
function moreOn() { return state.ui.moreBtn !== false; }
function navPhone() { return window.innerWidth < 900; }
function applyTabBar() {
  const bar = tabBar();
  const phone = navPhone();
  document.querySelectorAll('.tabs .tab[data-view]').forEach(function (b) {
    const v = b.dataset.view;
    b.hidden = sectionOff(v) || (phone && bar.indexOf(v) === -1);
    b.style.order = phone ? String(bar.indexOf(v)) : '';
  });
  const more = $('moreTab');
  more.hidden = !phone || !moreOn();
  more.style.order = '99';
  const inMore = phone && typeof view !== 'undefined' && bar.indexOf(view) === -1;
  more.classList.toggle('on', inMore);
  more.querySelector('span').textContent = inMore ? navName(view) : 'More';
}
window.addEventListener('resize', function () { applyTabBar(); });

function tabIcon(v) { const b = document.querySelector('.tabs .tab[data-view="' + v + '"] svg'); return b ? b.outerHTML : ''; }
function moreHTML() {
  const bar = tabBar();
  const open = NAV_VIEWS.filter(function (n) { return !sectionOff(n[0]); });
  // rows: the bar's sections in bar order, then the rest
  const rows = bar.concat(NAV_VIEWS.map(function (n) { return n[0]; }).filter(function (v) { return bar.indexOf(v) === -1; }));
  return '<div class="tsh-bar"><h3>All sections</h3><button class="btn small primary" data-action="close">Close</button></div>' +
    '<div class="moregrid">' + open.map(function (n) {
      return '<button class="morego' + (n[0] === view ? ' on' : '') + '" data-action="morego" data-v="' + n[0] + '" style="--tc:var(--c-' + ({ calendar: 'cal', colortracker: 'ct' }[n[0]] || n[0]) + ')">' + tabIcon(n[0]) + '<span>' + n[1] + '</span></button>';
    }).join('') + '</div>' +
    '<p class="label">Bottom bar</p><p class="small">Bar = in the bottom bar (up to ' + TAB_MAX + '). More = only here. Off = hidden everywhere (your data stays). The bar keeps this order; ↑ moves one left.</p>' +
    '<div class="tabedit">' + rows.map(function (v) {
      const st = sectionOff(v) ? 'off' : bar.indexOf(v) !== -1 ? 'bar' : 'more';
      const i = bar.indexOf(v);
      return '<div class="tabrow"><span class="tabname">' + tabIcon(v) + navName(v) + '</span>' +
        (st === 'bar' && i > 0 ? '<button class="icon-btn sm" data-action="tabup" data-v="' + v + '" aria-label="Move ' + navName(v) + ' left">↑</button>' : '<span class="tabsp"></span>') +
        '<div class="seg">' + [['bar', 'Bar'], ['more', 'More'], ['off', 'Off']].map(function (o) {
          if (o[0] === 'off' && v === 'tasks') return '';
          return '<button class="' + (st === o[0] ? 'on' : '') + '" data-action="tabset" data-v="' + v + '" data-s="' + o[0] + '">' + o[1] + '</button>';
        }).join('') + '</div></div>';
    }).join('') + '</div>' +
    '<div class="pickrow wrap"><button class="pick' + (moreOn() ? ' on' : '') + '" data-action="moretoggle" aria-pressed="' + moreOn() + '">Show the More button in the bar</button></div>' +
    '<p class="small">If you hide it, bring it back from your profile → ⚙ Settings → Bottom bar.</p>';
}
function moreRefresh() { save(); applySections(); if (sheetCtx && sheetCtx.type === 'more') refreshSheet(moreHTML()); if (sheetCtx && sheetCtx.type === 'settings') refreshSheet(settingsHTML()); }
actions.moremenu = function () { openSheet({ type: 'more' }, moreHTML()); };
actions.morego = function (el) { closeSheet(); showView(el.dataset.v); };
actions.tabset = function (el) {
  const v = el.dataset.v, s = el.dataset.s;
  let bar = tabBar().slice();
  const hidden = (state.settings.hiddenTabs || []).slice();
  const wasOff = hidden.indexOf(v) !== -1;
  if (s === 'bar') {
    if (bar.indexOf(v) === -1) {
      if (bar.length >= TAB_MAX) { toast(TAB_MAX + ' is the most for the bar. Move one to More first.'); return; }
      bar.push(v);
    }
  } else if (bar.indexOf(v) !== -1) {
    if (bar.length <= TAB_MIN) { toast('Keep at least ' + TAB_MIN + ' sections in the bar.'); return; }
    bar = bar.filter(function (x) { return x !== v; });
  }
  if (s === 'off' && !wasOff) hidden.push(v);
  if (s !== 'off' && wasOff) hidden.splice(hidden.indexOf(v), 1);
  if (s === 'off' !== wasOff) { state.settings.hiddenTabs = hidden; state.settings.updatedAt = now(); }
  state.ui.tabBar = bar;
  haptic(5);
  moreRefresh();
};
actions.tabup = function (el) {
  const bar = tabBar().slice();
  const i = bar.indexOf(el.dataset.v);
  if (i > 0) { bar.splice(i, 1); bar.splice(i - 1, 0, el.dataset.v); }
  state.ui.tabBar = bar;
  moreRefresh();
};
actions.moretoggle = function () {
  state.ui.moreBtn = !moreOn();
  if (!moreOn()) toast('More button hidden. Bring it back: profile → ⚙ Settings → Bottom bar.');
  moreRefresh();
};
