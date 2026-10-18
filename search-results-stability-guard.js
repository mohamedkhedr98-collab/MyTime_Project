(function () {
  'use strict';

  /*
   * UA07 Search Results Theme Adaptive V7
   *
   * Keeps the working lightweight attached overlay behavior:
   * - No layout push.
   * - No body portal.
   * - No heavy DOM loops.
   *
   * Visual upgrade:
   * - Search results inherit the active visual theme instead of forcing Egypt style.
   * - No numbers, no title/header text.
   * - Results stay visually attached to the search input with a polished premium panel.
   */

  var STYLE_ID = 'ua07-search-results-theme-adaptive-v7';
  var OPEN_CLASS = 'ua07-search-is-open';
  var PANEL_CLASS = 'ua07-adaptive-search-panel';
  var CONTAINER_CLASS = 'ua07-adaptive-search-container';
  var THEME_CLASSES = [
    'ua07-theme-default',
    'ua07-theme-egypt',
    'ua07-theme-ahly',
    'ua07-theme-legacy',
    'ua07-theme-eid',
    'ua07-theme-ramadan',
    'ua07-theme-off'
  ];
  var OLD_STYLE_IDS = [
    'ua07-search-results-egypt-sleek-v6',
    'ua07-search-results-egypt-premium-v5',
    'ua07-search-results-overlay-lite-v4',
    'ua07-search-results-flow-lite-v5',
    'mndo-search-results-floating-layer-v4',
    'ua07-search-results-portal-fix-v2',
    'ua07-search-results-portal-layer-v2',
    'ua07-search-results-flow-lite-v3',
    'ua07-search-results-flow-lite-v4'
  ];

  var raf = 0;
  var bound = false;
  var themeSignalBound = false;
  var resizeObserver = null;
  var resultsObserver = null;
  var lastLeft = null;
  var lastWidth = null;
  var lastMaxHeight = null;

  function getInput() {
    return document.getElementById('searchInput')
      || document.querySelector('input.search-input')
      || document.querySelector('.search-container input')
      || document.querySelector('input[type="search"]')
      || document.querySelector('input[id*="search" i], input[class*="search" i]');
  }

  function getResults() {
    return document.getElementById('searchResults') || document.querySelector('.search-results');
  }

  function getContainer(input, results) {
    return (input && input.closest && input.closest('.search-container'))
      || (results && results.closest && results.closest('.search-container'))
      || (input && input.parentElement)
      || (results && results.parentElement)
      || null;
  }

  function getThemeClassName() {
    var root = document.documentElement;
    var mode = '';

    try {
      if (window.__srThemeController && typeof window.__srThemeController.getMode === 'function') {
        mode = String(window.__srThemeController.getMode() || '');
      }
    } catch (_) {}

    if (!mode && root && root.dataset) mode = String(root.dataset.srVisualTheme || '');

    if (mode === 'egypt') return 'ua07-theme-egypt';
    if (mode === 'ahly') return 'ua07-theme-ahly';
    if (mode === 'legacy') return 'ua07-theme-legacy';
    if (mode === 'eid') return 'ua07-theme-eid';
    if (mode === 'off') return 'ua07-theme-off';

    if (root && root.classList) {
      if (root.classList.contains('egypt-worldcup-theme-live')) return 'ua07-theme-egypt';
      if (root.classList.contains('ahly-premium-theme-live')) return 'ua07-theme-ahly';
      if (root.classList.contains('ua07-legacy-theme-live')) return 'ua07-theme-legacy';
      if (root.classList.contains('eid-theme-live')) return 'ua07-theme-eid';
      if (root.classList.contains('sr-theme-off-live')) return 'ua07-theme-off';
    }

    return 'ua07-theme-default';
  }

  function removeOldFixes() {
    OLD_STYLE_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    if (document.body) document.body.classList.remove('ua07-search-results-open');
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    removeOldFixes();

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* UA07 adaptive attached search results: premium overlay per active theme. */',
      '.' + CONTAINER_CLASS + ',' ,
      '#searchResults.' + PANEL_CLASS + '{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(18,22,32,.985), rgba(8,10,18,.985) 50%, rgba(2,4,10,.985));',
      '  --ua07-sr-panel-border: rgba(132,176,244,.36);',
      '  --ua07-sr-panel-border-top: rgba(172,205,255,.46);',
      '  --ua07-sr-panel-shadow: 0 22px 56px rgba(0,0,0,.62), 0 0 0 1px rgba(180,210,255,.07), inset 0 1px 0 rgba(255,255,255,.12);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(126,190,255,.70) 22%, rgba(234,241,255,.88) 52%, rgba(126,190,255,.55) 78%, transparent);',
      '  --ua07-sr-text: rgba(244,248,255,.98);',
      '  --ua07-sr-muted: rgba(198,218,255,.82);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.030) 48%, rgba(0,0,0,.22)), linear-gradient(90deg, rgba(75,138,255,.10), rgba(255,255,255,.035), rgba(75,138,255,.06));',
      '  --ua07-sr-item-border: rgba(156,198,255,.20);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,.035)), linear-gradient(90deg, rgba(32,96,210,.60), rgba(9,24,62,.48) 62%, rgba(0,0,0,.20));',
      '  --ua07-sr-item-hover-border: rgba(166,210,255,.58);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(185,218,255,.95), rgba(65,145,255,.72));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(190,220,255,.88), rgba(65,145,255,.76));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(155,199,255,.16), 0 10px 26px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.12);',
      '  --ua07-sr-input-border: rgba(161,201,255,.64);',
      '}',

      '.' + CONTAINER_CLASS + '.ua07-theme-egypt, #searchResults.' + PANEL_CLASS + '.ua07-theme-egypt{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(43,31,17,.985), rgba(18,3,2,.985) 46%, rgba(5,3,2,.99)), radial-gradient(circle at 18% -6%, rgba(198,34,27,.22), transparent 34%), radial-gradient(circle at 86% 6%, rgba(240,193,83,.18), transparent 31%);',
      '  --ua07-sr-panel-border: rgba(225,184,89,.58);',
      '  --ua07-sr-panel-border-top: rgba(235,196,105,.84);',
      '  --ua07-sr-panel-shadow: 0 22px 58px rgba(0,0,0,.66), 0 0 0 1px rgba(255,231,156,.08), inset 0 1px 0 rgba(255,255,255,.14), inset 0 -22px 38px rgba(0,0,0,.25);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(196,34,28,.84) 18%, rgba(241,200,105,.94) 52%, rgba(196,34,28,.62) 82%, transparent);',
      '  --ua07-sr-text: rgba(255,247,225,.98);',
      '  --ua07-sr-muted: rgba(245,217,158,.84);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.090), rgba(255,255,255,.030) 45%, rgba(0,0,0,.20)), linear-gradient(90deg, rgba(170,30,24,.13), rgba(255,211,111,.055) 48%, rgba(170,30,24,.08));',
      '  --ua07-sr-item-border: rgba(223,184,91,.24);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(128,27,21,.88), rgba(52,12,10,.90)), linear-gradient(90deg, rgba(255,211,104,.18), transparent 58%, rgba(255,211,104,.08));',
      '  --ua07-sr-item-hover-border: rgba(255,219,132,.74);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(255,219,132,.96), rgba(190,45,32,.78));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(232,190,88,.86), rgba(137,36,27,.78));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(235,196,105,.18), 0 10px 26px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.12);',
      '  --ua07-sr-input-border: rgba(235,196,105,.86);',
      '}',

      '.' + CONTAINER_CLASS + '.ua07-theme-ahly, #searchResults.' + PANEL_CLASS + '.ua07-theme-ahly{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(31,0,1,.985), rgba(10,3,4,.985) 48%, rgba(4,0,1,.99)), radial-gradient(circle at 16% -6%, rgba(255,214,112,.18), transparent 36%), radial-gradient(circle at 90% 4%, rgba(210,0,0,.20), transparent 34%);',
      '  --ua07-sr-panel-border: rgba(255,213,112,.46);',
      '  --ua07-sr-panel-border-top: rgba(255,226,146,.68);',
      '  --ua07-sr-panel-shadow: 0 24px 60px rgba(0,0,0,.70), 0 0 28px rgba(180,0,0,.18), inset 0 1px 0 rgba(255,255,255,.12);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(198,0,0,.88) 18%, rgba(255,217,126,.95) 52%, rgba(198,0,0,.70) 82%, transparent);',
      '  --ua07-sr-text: rgba(255,248,225,.98);',
      '  --ua07-sr-muted: rgba(255,224,156,.84);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.026) 46%, rgba(0,0,0,.24)), linear-gradient(90deg, rgba(160,0,0,.18), rgba(255,213,112,.055), rgba(40,0,0,.10));',
      '  --ua07-sr-item-border: rgba(255,213,112,.24);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(150,0,0,.92), rgba(43,0,1,.94)), linear-gradient(90deg, rgba(255,214,112,.18), transparent 58%, rgba(255,214,112,.08));',
      '  --ua07-sr-item-hover-border: rgba(255,225,145,.70);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(255,226,146,.96), rgba(204,0,0,.82));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(255,226,146,.90), rgba(185,0,0,.82));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(255,213,112,.16), 0 10px 28px rgba(0,0,0,.46), 0 0 20px rgba(180,0,0,.14), inset 0 1px 0 rgba(255,255,255,.12);',
      '  --ua07-sr-input-border: rgba(255,213,112,.70);',
      '}',

      '.' + CONTAINER_CLASS + '.ua07-theme-legacy, #searchResults.' + PANEL_CLASS + '.ua07-theme-legacy{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(28,28,34,.985), rgba(8,8,12,.985) 50%, rgba(3,3,7,.99)), radial-gradient(circle at 18% -6%, rgba(255,255,255,.15), transparent 34%), radial-gradient(circle at 86% 6%, rgba(128,106,255,.14), transparent 32%);',
      '  --ua07-sr-panel-border: rgba(210,210,230,.28);',
      '  --ua07-sr-panel-border-top: rgba(245,245,255,.42);',
      '  --ua07-sr-panel-shadow: 0 22px 56px rgba(0,0,0,.66), 0 0 0 1px rgba(255,255,255,.06), inset 0 1px 0 rgba(255,255,255,.14);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(255,255,255,.70) 20%, rgba(130,20,20,.72) 52%, rgba(200,190,255,.58) 82%, transparent);',
      '  --ua07-sr-text: rgba(247,244,255,.98);',
      '  --ua07-sr-muted: rgba(215,210,255,.78);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.025) 48%, rgba(0,0,0,.22)), linear-gradient(90deg, rgba(135,0,0,.12), rgba(255,255,255,.040), rgba(128,106,255,.075));',
      '  --ua07-sr-item-border: rgba(190,174,255,.16);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(135,0,0,.74), rgba(23,18,40,.88)), linear-gradient(90deg, rgba(255,255,255,.13), transparent 56%, rgba(128,106,255,.12));',
      '  --ua07-sr-item-hover-border: rgba(230,222,255,.46);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(255,255,255,.96), rgba(128,106,255,.72));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(255,255,255,.78), rgba(128,106,255,.70));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(220,220,255,.12), 0 10px 26px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.14);',
      '  --ua07-sr-input-border: rgba(245,245,255,.44);',
      '}',

      '.' + CONTAINER_CLASS + '.ua07-theme-eid, #searchResults.' + PANEL_CLASS + '.ua07-theme-eid{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(7,11,20,.985), rgba(9,13,24,.985) 50%, rgba(5,8,14,.99)), radial-gradient(circle at 18% -6%, rgba(255,231,166,.20), transparent 35%), radial-gradient(circle at 86% 8%, rgba(113,160,255,.16), transparent 34%);',
      '  --ua07-sr-panel-border: rgba(255,239,186,.42);',
      '  --ua07-sr-panel-border-top: rgba(255,239,186,.62);',
      '  --ua07-sr-panel-shadow: 0 22px 58px rgba(0,0,0,.62), 0 0 34px rgba(255,223,144,.08), inset 0 1px 0 rgba(255,255,255,.14);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(113,160,255,.60) 18%, rgba(243,211,122,.95) 52%, rgba(255,165,118,.55) 82%, transparent);',
      '  --ua07-sr-text: rgba(244,247,255,.98);',
      '  --ua07-sr-muted: rgba(255,239,186,.78);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.090), rgba(255,255,255,.028) 46%, rgba(0,0,0,.22)), linear-gradient(90deg, rgba(255,231,166,.10), rgba(113,160,255,.055), rgba(255,165,118,.07));',
      '  --ua07-sr-item-border: rgba(255,239,186,.20);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(255,231,166,.18), rgba(7,11,20,.88)), linear-gradient(90deg, rgba(113,160,255,.20), rgba(255,165,118,.12));',
      '  --ua07-sr-item-hover-border: rgba(255,239,186,.58);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(255,239,186,.96), rgba(113,160,255,.72));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(255,239,186,.88), rgba(113,160,255,.72));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(255,239,186,.14), 0 10px 26px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.13);',
      '  --ua07-sr-input-border: rgba(255,239,186,.62);',
      '}',

      '.' + CONTAINER_CLASS + '.ua07-theme-ramadan, #searchResults.' + PANEL_CLASS + '.ua07-theme-ramadan{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(7,22,40,.985), rgba(5,16,26,.985) 50%, rgba(3,9,15,.99)), radial-gradient(circle at 18% -6%, rgba(16,185,129,.18), transparent 35%), radial-gradient(circle at 86% 8%, rgba(212,175,55,.18), transparent 34%);',
      '  --ua07-sr-panel-border: rgba(241,210,122,.42);',
      '  --ua07-sr-panel-border-top: rgba(241,210,122,.64);',
      '  --ua07-sr-panel-shadow: 0 22px 58px rgba(0,0,0,.62), 0 0 30px rgba(16,185,129,.08), inset 0 1px 0 rgba(255,255,255,.13);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(16,185,129,.70) 18%, rgba(241,210,122,.95) 52%, rgba(16,185,129,.52) 82%, transparent);',
      '  --ua07-sr-text: rgba(255,255,255,.96);',
      '  --ua07-sr-muted: rgba(241,210,122,.80);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.090), rgba(255,255,255,.028) 46%, rgba(0,0,0,.22)), linear-gradient(90deg, rgba(16,185,129,.12), rgba(212,175,55,.055), rgba(16,185,129,.06));',
      '  --ua07-sr-item-border: rgba(241,210,122,.20);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(16,185,129,.28), rgba(6,26,26,.88)), linear-gradient(90deg, rgba(212,175,55,.16), rgba(16,185,129,.10));',
      '  --ua07-sr-item-hover-border: rgba(241,210,122,.58);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(241,210,122,.96), rgba(16,185,129,.74));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(241,210,122,.88), rgba(16,185,129,.74));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(241,210,122,.14), 0 10px 26px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.13);',
      '  --ua07-sr-input-border: rgba(241,210,122,.62);',
      '}',

      '.' + CONTAINER_CLASS + '.ua07-theme-off, #searchResults.' + PANEL_CLASS + '.ua07-theme-off{',
      '  --ua07-sr-panel-bg: linear-gradient(180deg, rgba(12,16,32,.985), rgba(5,8,20,.985) 50%, rgba(2,4,12,.99)), radial-gradient(circle at 18% -6%, rgba(120,190,255,.16), transparent 35%), radial-gradient(circle at 86% 8%, rgba(35,120,255,.16), transparent 34%);',
      '  --ua07-sr-panel-border: rgba(128,194,255,.34);',
      '  --ua07-sr-panel-border-top: rgba(170,215,255,.50);',
      '  --ua07-sr-panel-shadow: 0 22px 58px rgba(0,0,0,.62), 0 0 28px rgba(78,160,255,.10), inset 0 1px 0 rgba(255,255,255,.13);',
      '  --ua07-sr-top-line: linear-gradient(90deg, transparent, rgba(78,160,255,.65) 18%, rgba(230,244,255,.86) 52%, rgba(78,160,255,.48) 82%, transparent);',
      '  --ua07-sr-text: rgba(238,245,255,.98);',
      '  --ua07-sr-muted: rgba(190,220,255,.78);',
      '  --ua07-sr-item-bg: linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.028) 46%, rgba(0,0,0,.22)), linear-gradient(90deg, rgba(78,160,255,.11), rgba(255,255,255,.038), rgba(78,160,255,.06));',
      '  --ua07-sr-item-border: rgba(128,194,255,.18);',
      '  --ua07-sr-item-hover-bg: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.024)), linear-gradient(90deg, rgba(19,73,168,.58), rgba(7,20,56,.40) 58%, rgba(0,0,0,.18));',
      '  --ua07-sr-item-hover-border: rgba(128,194,255,.48);',
      '  --ua07-sr-accent: linear-gradient(180deg, rgba(230,244,255,.95), rgba(78,160,255,.76));',
      '  --ua07-sr-scroll: linear-gradient(180deg, rgba(230,244,255,.88), rgba(78,160,255,.76));',
      '  --ua07-sr-input-glow: 0 0 0 1px rgba(128,194,255,.13), 0 10px 26px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.13);',
      '  --ua07-sr-input-border: rgba(128,194,255,.58);',
      '}',

      '.' + CONTAINER_CLASS + ' input, .' + CONTAINER_CLASS + ' input[type="text"], .' + CONTAINER_CLASS + ' input[type="search"]{',
      '  transition: border-color .16s ease, box-shadow .16s ease, border-radius .16s ease, background .16s ease !important;',
      '}',
      '.' + CONTAINER_CLASS + '.' + OPEN_CLASS + ' input, .' + CONTAINER_CLASS + '.' + OPEN_CLASS + ' input[type="text"], .' + CONTAINER_CLASS + '.' + OPEN_CLASS + ' input[type="search"]{',
      '  border-bottom-left-radius: 10px !important;',
      '  border-bottom-right-radius: 10px !important;',
      '  border-color: var(--ua07-sr-input-border) !important;',
      '  box-shadow: var(--ua07-sr-input-glow) !important;',
      '}',

      '#searchResults.' + PANEL_CLASS + ', #searchResults.search-results.' + PANEL_CLASS + ', #searchResults#searchResults.' + PANEL_CLASS + '{',
      '  position: absolute !important;',
      '  top: calc(100% + 3px) !important;',
      '  left: var(--ua07-search-left, 0px) !important;',
      '  right: auto !important;',
      '  bottom: auto !important;',
      '  width: var(--ua07-search-width, min(420px, calc(100vw - 24px))) !important;',
      '  min-width: 0 !important;',
      '  max-width: calc(100vw - 24px) !important;',
      '  max-height: var(--ua07-search-max-height, min(350px, calc(100vh - 110px))) !important;',
      '  margin: 0 !important;',
      '  padding: 8px 8px 9px !important;',
      '  box-sizing: border-box !important;',
      '  overflow-y: auto !important;',
      '  overflow-x: hidden !important;',
      '  overscroll-behavior: contain !important;',
      '  scrollbar-gutter: stable !important;',
      '  border-radius: 0 0 18px 18px !important;',
      '  border: 1px solid var(--ua07-sr-panel-border) !important;',
      '  border-top-color: var(--ua07-sr-panel-border-top) !important;',
      '  background: var(--ua07-sr-panel-bg) !important;',
      '  background-blend-mode: normal, screen, screen !important;',
      '  color: var(--ua07-sr-text) !important;',
      '  -webkit-text-fill-color: var(--ua07-sr-text) !important;',
      '  box-shadow: var(--ua07-sr-panel-shadow) !important;',
      '  text-align: center !important;',
      '  z-index: var(--sr-layer-search-results, 80) !important;',
      '  transform: translate3d(0,0,0) !important;',
      '  pointer-events: auto !important;',
      '  isolation: isolate !important;',
      '  contain: none !important;',
      '  counter-reset: none !important;',
      '  backdrop-filter: blur(10px) saturate(1.12) !important;',
      '  -webkit-backdrop-filter: blur(10px) saturate(1.12) !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + ':empty, #searchResults.search-results.' + PANEL_CLASS + ':empty{',
      '  display: none !important;',
      '  padding: 0 !important;',
      '  border-width: 0 !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + '::before, #searchResults.search-results.' + PANEL_CLASS + '::before, #searchResults#searchResults.' + PANEL_CLASS + '::before{',
      '  content: "" !important;',
      '  display: block !important;',
      '  height: 2px !important;',
      '  margin: 0 11px 8px !important;',
      '  border-radius: 999px !important;',
      '  background: var(--ua07-sr-top-line) !important;',
      '  box-shadow: 0 0 16px color-mix(in srgb, var(--ua07-sr-muted) 24%, transparent) !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + '::after, #searchResults.search-results.' + PANEL_CLASS + '::after, #searchResults#searchResults.' + PANEL_CLASS + '::after{',
      '  content: "" !important;',
      '  position: absolute !important;',
      '  left: 14px !important;',
      '  right: 14px !important;',
      '  top: -5px !important;',
      '  height: 7px !important;',
      '  border-radius: 999px !important;',
      '  background: var(--ua07-sr-top-line) !important;',
      '  opacity: .30 !important;',
      '  pointer-events: none !important;',
      '  z-index: -1 !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + ' a, #searchResults.search-results.' + PANEL_CLASS + ' a, #searchResults#searchResults.' + PANEL_CLASS + ' a{',
      '  position: relative !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  width: 100% !important;',
      '  min-height: 40px !important;',
      '  margin: 6px 0 !important;',
      '  padding: 10px 18px !important;',
      '  box-sizing: border-box !important;',
      '  border-radius: 14px !important;',
      '  border: 1px solid var(--ua07-sr-item-border) !important;',
      '  background: var(--ua07-sr-item-bg) !important;',
      '  color: var(--ua07-sr-text) !important;',
      '  -webkit-text-fill-color: var(--ua07-sr-text) !important;',
      '  font-weight: 900 !important;',
      '  font-size: 14px !important;',
      '  line-height: 1.36 !important;',
      '  text-align: center !important;',
      '  text-decoration: none !important;',
      '  text-shadow: 0 1px 2px rgba(0,0,0,.74) !important;',
      '  white-space: normal !important;',
      '  overflow-wrap: anywhere !important;',
      '  transform: translateZ(0) !important;',
      '  box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 7px 14px rgba(0,0,0,.14) !important;',
      '  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease, transform .15s ease, color .15s ease !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + ' a::before, #searchResults.search-results.' + PANEL_CLASS + ' a::before, #searchResults#searchResults.' + PANEL_CLASS + ' a::before{',
      '  content: "" !important;',
      '  position: absolute !important;',
      '  left: 8px !important;',
      '  top: 9px !important;',
      '  bottom: 9px !important;',
      '  width: 3px !important;',
      '  border-radius: 999px !important;',
      '  background: var(--ua07-sr-accent) !important;',
      '  opacity: .72 !important;',
      '  box-shadow: 0 0 10px rgba(255,255,255,.12) !important;',
      '  counter-increment: none !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + ' a::after, #searchResults.search-results.' + PANEL_CLASS + ' a::after, #searchResults#searchResults.' + PANEL_CLASS + ' a::after{',
      '  content: "" !important;',
      '  position: absolute !important;',
      '  inset: 1px !important;',
      '  border-radius: 13px !important;',
      '  border-top: 1px solid rgba(255,255,255,.105) !important;',
      '  pointer-events: none !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + ' a:hover, #searchResults.' + PANEL_CLASS + ' a:focus, #searchResults.search-results.' + PANEL_CLASS + ' a:hover, #searchResults.search-results.' + PANEL_CLASS + ' a:focus, #searchResults#searchResults.' + PANEL_CLASS + ' a:hover, #searchResults#searchResults.' + PANEL_CLASS + ' a:focus{',
      '  outline: none !important;',
      '  padding: 10px 18px !important;',
      '  color: #fff !important;',
      '  -webkit-text-fill-color: #fff !important;',
      '  border-color: var(--ua07-sr-item-hover-border) !important;',
      '  background: var(--ua07-sr-item-hover-bg) !important;',
      '  box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 11px 24px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.06) !important;',
      '  transform: translateY(-1px) translateZ(0) !important;',
      '}',
      '#searchResults.' + PANEL_CLASS + ' a:active{ transform: translateY(0) translateZ(0) !important; }',
      '#searchResults.' + PANEL_CLASS + '::-webkit-scrollbar{ width: 8px !important; }',
      '#searchResults.' + PANEL_CLASS + '::-webkit-scrollbar-track{ background: rgba(0,0,0,.22) !important; border-radius: 999px !important; margin: 12px 0 !important; }',
      '#searchResults.' + PANEL_CLASS + '::-webkit-scrollbar-thumb{ background: var(--ua07-sr-scroll) !important; border-radius: 999px !important; border: 2px solid rgba(8,8,12,.92) !important; }',
      '#searchResults.' + PANEL_CLASS + '::-webkit-scrollbar-thumb:hover{ filter: brightness(1.08) !important; }',
      '@supports not (background: color-mix(in srgb, red 10%, transparent)){',
      '  #searchResults.' + PANEL_CLASS + '::before{ box-shadow: 0 0 12px rgba(255,255,255,.12) !important; }',
      '}'
    ].join('\n');

    (document.head || document.documentElement).appendChild(style);
  }

  function setImportant(el, prop, value) {
    if (!el) return;
    try { el.style.setProperty(prop, value, 'important'); } catch (_) {}
  }

  function hasVisibleResults(results) {
    if (!results) return false;
    var text = (results.textContent || '').replace(/\s+/g, '').trim();
    return !!text && results.children && results.children.length > 0;
  }

  function applyThemeClass(el, themeClassName) {
    if (!el || !el.classList) return;
    THEME_CLASSES.forEach(function (cls) { el.classList.remove(cls); });
    el.classList.add(themeClassName || 'ua07-theme-default');
  }

  function setOpenState(container, results) {
    var isOpen = hasVisibleResults(results);
    var themeClassName = getThemeClassName();

    if (container && container.classList) {
      container.classList.toggle(OPEN_CLASS, isOpen);
      container.classList.add(CONTAINER_CLASS);
      applyThemeClass(container, themeClassName);
    }
    if (results && results.classList) {
      results.classList.add(PANEL_CLASS);
      applyThemeClass(results, themeClassName);
    }
  }

  function alignNow() {
    raf = 0;
    injectCss();

    var input = getInput();
    var results = getResults();
    if (!input || !results) return;

    var container = getContainer(input, results);
    if (!container) return;

    if (results.parentElement !== container) {
      try { container.appendChild(results); } catch (_) {}
    }

    setOpenState(container, results);

    // Hidden or empty results do not need geometry reads. A result mutation
    // schedules one frame as soon as content appears.
    if (!hasVisibleResults(results)) return;

    var inputRect = input.getBoundingClientRect();
    var containerRect = container.getBoundingClientRect();
    var viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, 320);
    var viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0, 320);

    if (!inputRect.width || !containerRect.width) return;

    var gap = 8;
    var desiredWidth = Math.min(Math.max(inputRect.width, 320), 460, viewportW - (gap * 2));
    desiredWidth = Math.max(270, Math.round(desiredWidth));

    var left = Math.round(inputRect.left - containerRect.left + ((inputRect.width - desiredWidth) / 2));
    var panelViewportLeft = Math.round(containerRect.left + left);
    var panelViewportRight = panelViewportLeft + desiredWidth;

    if (panelViewportLeft < gap) left += gap - panelViewportLeft;
    if (panelViewportRight > viewportW - gap) left -= panelViewportRight - (viewportW - gap);

    var topInViewport = Math.round(inputRect.bottom + 3);
    var maxHeight = Math.round(Math.max(160, Math.min(355, viewportH - topInViewport - 12)));
    left = Math.round(left);

    // Write only changed geometry values to avoid style/layout churn.
    if (left !== lastLeft) {
      lastLeft = left;
      results.style.setProperty('--ua07-search-left', left + 'px');
    }
    if (desiredWidth !== lastWidth) {
      lastWidth = desiredWidth;
      results.style.setProperty('--ua07-search-width', desiredWidth + 'px');
    }
    if (maxHeight !== lastMaxHeight) {
      lastMaxHeight = maxHeight;
      results.style.setProperty('--ua07-search-max-height', maxHeight + 'px');
    }
  }

  function scheduleAlign() {
    if (raf) return;
    raf = window.requestAnimationFrame ? window.requestAnimationFrame(alignNow) : setTimeout(alignNow, 0);
  }

  function bindThemeSignal() {
    if (themeSignalBound) return;
    themeSignalBound = true;
    window.addEventListener('sr:themechange', scheduleAlign, { passive: true });
  }

  function bindGeometryObservers(input, results, container) {
    if (!resizeObserver && window.ResizeObserver) {
      try {
        resizeObserver = new ResizeObserver(scheduleAlign);
        resizeObserver.observe(input);
        if (container && container !== input) resizeObserver.observe(container);
      } catch (_) {}
    }

    if (!resultsObserver && window.MutationObserver) {
      try {
        resultsObserver = new MutationObserver(scheduleAlign);
        resultsObserver.observe(results, { childList: true, subtree: true });
      } catch (_) {}
    }
  }

  function bind() {
    injectCss();
    bindThemeSignal();

    var input = getInput();
    var results = getResults();
    var container = getContainer(input, results);

    if (container) {
      if (container.classList) container.classList.add(CONTAINER_CLASS);
    }
    if (results && results.classList) results.classList.add(PANEL_CLASS);
    setOpenState(container, results);

    if (!input || !results || !container || bound) {
      scheduleAlign();
      return;
    }

    bound = true;
    input.addEventListener('input', scheduleAlign, { passive: true });
    input.addEventListener('focus', scheduleAlign, { passive: true });
    window.addEventListener('resize', scheduleAlign, { passive: true });
    window.addEventListener('orientationchange', scheduleAlign, { passive: true });

    bindGeometryObservers(input, results, container);
    scheduleAlign();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  window.ua07RefreshSearchResultsOverlay = scheduleAlign;
}());

(function () {
  'use strict';

  /*
   * UA07 V13: Safe dropdown scroll only.
   *
   * Why this version is conservative:
   * CSS overflow scrolling clips any child submenu that opens outside the panel.
   * To avoid breaking nested/internal menus, this adds internal scroll only to:
   *  - normal dropdown panels that do NOT contain .sub-dropdown
   *  - submenu panels themselves
   *
   * It intentionally does NOT change fonts, colors, padding, backgrounds,
   * borders, display rules, hover rules, or menu positioning.
   */

  var STYLE_ID = 'ua07-dropdown-scroll-safe-no-submenu-break-v13';
  var OLD_STYLE_IDS = [
    'ua07-dropdown-internal-scroll-v8',
    'ua07-dropdown-scroll-only-v9',
    'ua07-dropdown-scroll-pure-v10',
    'ua07-dropdown-scroll-submenu-safe-v11',
    'ua07-dropdown-scroll-popout-v12'
  ];
  var OLD_CLASSES = [
    'ua07-menu-internal-scroll-panel',
    'ua07-menu-open-up',
    'ua07-menu-fixed-subpanel',
    'ua07-dropdown-scroll-only-v9-panel',
    'ua07-submenu-viewport',
    'ua07-submenu-open',
    'ua07-dropdown-needs-scroll',
    'ua07-submenu-popout-source-v12'
  ];

  function removeOldDropdownEdits(root = document) {
    OLD_STYLE_IDS.forEach(function (id) {
      var el = root.querySelector('[id="' + id + '"]');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    var popouts = root.querySelectorAll('[data-ua07-submenu-popout="true"]');
    popouts.forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    root.querySelectorAll('.dropdown-content, .sub-dropdown-content, .sub-dropdown').forEach(function (el) {
      if (!el || !el.classList) return;
      OLD_CLASSES.forEach(function (cls) { el.classList.remove(cls); });

      [
        '--ua07-menu-top',
        '--ua07-menu-left',
        '--ua07-menu-width',
        '--ua07-menu-min-width',
        '--ua07-menu-max-height',
        '--ua07-menu-scroll-max-height',
        '--ua07-submenu-top',
        '--ua07-submenu-left',
        '--ua07-submenu-max-height',
        '--ua07-dropdown-max-height'
      ].forEach(function (prop) { el.style.removeProperty(prop); });

      [
        'max-height',
        'overflow',
        'overflow-y',
        'overflow-x',
        'position',
        'top',
        'left',
        'right',
        'z-index',
        'width',
        'min-width',
        'display',
        'visibility',
        'pointer-events'
      ].forEach(function (prop) { el.style.removeProperty(prop); });
    });
  }

  function injectCss() {
    removeOldDropdownEdits();
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '/* UA07 V13: scroll only, no visual redesign, no nested-menu clipping. */',
      '@supports selector(.dropdown-content:not(:has(.sub-dropdown))){',
      '  .dropdown-content:not(:has(.sub-dropdown)){',
      '    max-height: min(420px, calc(100vh - 135px)) !important;',
      '    overflow-y: auto !important;',
      '    overscroll-behavior: contain !important;',
      '    -webkit-overflow-scrolling: touch !important;',
      '  }',
      '}',
      '.sub-dropdown-content{',
      '  max-height: min(420px, calc(100vh - 135px)) !important;',
      '  overflow-y: auto !important;',
      '  overscroll-behavior: contain !important;',
      '  -webkit-overflow-scrolling: touch !important;',
      '}',
      '@media (max-height: 620px){',
      '  @supports selector(.dropdown-content:not(:has(.sub-dropdown))){',
      '    .dropdown-content:not(:has(.sub-dropdown)){ max-height: min(320px, calc(100vh - 105px)) !important; }',
      '  }',
      '  .sub-dropdown-content{ max-height: min(320px, calc(100vh - 105px)) !important; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCss, { once: true });
  } else {
    injectCss();
  }

  window.addEventListener('load', injectCss, { once: true, passive: true });
  window.addEventListener('sr:catalog-ready', event => removeOldDropdownEdits(event.detail.doc));
  window.addEventListener('sr:catalog-mounted', event => removeOldDropdownEdits(event.detail.root));
  if (window.__srCatalog?.peek()) removeOldDropdownEdits(window.__srCatalog.peek().doc);
}());

(function () {
  'use strict';

  /*
   * UA07 V15: top-and-bottom scroll handoff for internal menus.
   *
   * Some menu panels intentionally have their own scrollbar so nested menus stay usable.
   * When the user reaches the END of a menu panel and keeps scrolling down,
   * this safely forwards the extra downward scroll to the main page.
   * When the user reaches the START of a menu panel and keeps scrolling up,
   * this safely forwards the extra upward scroll to the main page.
   *
   * It does NOT change menu layout, theme styling, links, or submenu behavior.
   */

  var MENU_SCROLL_SELECTOR = [
    '.dropdown-content',
    '.sub-dropdown-content',
    '.ltMenu',
    '#searchResults.search-results',
    '.search-results'
  ].join(',');

  var EDGE_TOLERANCE = 2;
  var touchState = null;

  function getMainScroller() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function canPageScrollDown() {
    var root = getMainScroller();
    if (!root) return false;
    return (root.scrollTop + root.clientHeight) < (root.scrollHeight - EDGE_TOLERANCE);
  }

  function canPageScrollUp() {
    var root = getMainScroller();
    if (!root) return false;
    return root.scrollTop > EDGE_TOLERANCE;
  }

  function isScrollableMenu(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return false;
    return (el.scrollHeight - el.clientHeight) > EDGE_TOLERANCE;
  }

  function findScrollableMenu(target) {
    var el = target && target.closest ? target.closest(MENU_SCROLL_SELECTOR) : null;
    return isScrollableMenu(el) ? el : null;
  }

  function isAtMenuBottom(el) {
    if (!el) return false;
    return (el.scrollTop + el.clientHeight) >= (el.scrollHeight - EDGE_TOLERANCE);
  }

  function isAtMenuTop(el) {
    if (!el) return false;
    return el.scrollTop <= EDGE_TOLERANCE;
  }

  function forwardToPage(amount) {
    if (!amount) return false;

    if (amount > 0 && !canPageScrollDown()) return false;
    if (amount < 0 && !canPageScrollUp()) return false;

    window.scrollBy({ top: amount, left: 0, behavior: 'auto' });
    return true;
  }

  function shouldHandOff(menu, amount) {
    if (!menu || !amount) return false;
    if (amount > 0) return isAtMenuBottom(menu);
    if (amount < 0) return isAtMenuTop(menu);
    return false;
  }

  function onWheel(e) {
    if (!e || e.defaultPrevented || !e.deltaY) return;

    var menu = findScrollableMenu(e.target);
    if (!shouldHandOff(menu, e.deltaY)) return;

    if (forwardToPage(e.deltaY)) {
      e.preventDefault();
    }
  }

  function onTouchStart(e) {
    if (!e || !e.touches || e.touches.length !== 1) {
      touchState = null;
      return;
    }

    var menu = findScrollableMenu(e.target);
    if (!menu) {
      touchState = null;
      return;
    }

    touchState = {
      menu: menu,
      lastY: e.touches[0].clientY
    };
  }

  function onTouchMove(e) {
    if (!touchState || !e || !e.touches || e.touches.length !== 1) return;

    var currentY = e.touches[0].clientY;
    var amount = touchState.lastY - currentY; // positive scrolls page down, negative scrolls page up
    touchState.lastY = currentY;

    if (!amount) return;
    if (!isScrollableMenu(touchState.menu) || !shouldHandOff(touchState.menu, amount)) return;

    if (forwardToPage(amount)) {
      e.preventDefault();
    }
  }

  function onTouchEnd() {
    touchState = null;
  }

  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
}());
