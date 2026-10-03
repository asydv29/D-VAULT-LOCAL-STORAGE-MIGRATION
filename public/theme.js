(function () {
  var STORAGE_KEY = 'mytube-theme'; // 'light' | 'dark' | 'system'
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function getPreference() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch (e) {}
    return 'system';
  }

  function effectiveTheme(pref) {
    if (pref === 'system') return media.matches ? 'dark' : 'light';
    return pref;
  }

  function apply(pref) {
    var effective = effectiveTheme(pref);
    var root = document.documentElement;
    if (pref === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', pref);
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effective === 'dark' ? '#0f0f0f' : '#ffffff');
    root.style.colorScheme = effective;
    document.dispatchEvent(new CustomEvent('mytube-theme-change', { detail: { pref: pref, effective: effective } }));
  }

  function set(pref) {
    if (pref !== 'light' && pref !== 'dark' && pref !== 'system') return;
    try { localStorage.setItem(STORAGE_KEY, pref); } catch (e) {}
    apply(pref);
  }

  apply(getPreference());

  function onSystemChange() {
    if (getPreference() === 'system') apply('system');
  }
  if (media.addEventListener) media.addEventListener('change', onSystemChange);
  else if (media.addListener) media.addListener(onSystemChange);

  window.MyTubeTheme = {
    get: getPreference,
    getEffective: function () { return effectiveTheme(getPreference()); },
    set: set
  };
})();
