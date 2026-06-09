// GTM verification helper — include only during testing, never in production
(function () {
  var GTM_ID = 'GTM-TRSQ4N54';

  function log(msg, ok) {
    var style = ok ? 'color:#16a34a;font-weight:bold' : 'color:#dc2626;font-weight:bold';
    console.log('%c[GTM] ' + msg, style);
  }

  window.verifyGTM = function () {
    // 1. dataLayer exists
    if (!window.dataLayer) {
      log('dataLayer NÃO encontrado', false);
      return;
    }
    log('dataLayer encontrado ✓', true);

    // 2. GTM script loaded
    var scripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
    if (scripts.length === 0) {
      log('Script GTM NÃO encontrado no DOM', false);
    } else {
      log('Script GTM carregado ✓ (' + scripts[0].src + ')', true);
    }

    // 3. Correct GTM ID
    var found = false;
    scripts.forEach(function (s) { if (s.src.indexOf(GTM_ID) !== -1) found = true; });
    if (found) {
      log('ID correto: ' + GTM_ID + ' ✓', true);
    } else {
      log('ID ' + GTM_ID + ' NÃO encontrado nos scripts', false);
    }

    // 4. noscript iframe
    var iframes = document.querySelectorAll('iframe[src*="googletagmanager.com/ns.html"]');
    log('noscript iframe: ' + (iframes.length > 0 ? 'presente ✓' : 'ausente (normal se JS estiver ativo)'), iframes.length > 0);

    // 5. dataLayer events
    var events = window.dataLayer.filter(function (e) { return e.event; }).map(function (e) { return e.event; });
    log('Eventos no dataLayer: [' + events.join(', ') + ']', events.length > 0);

    // 6. Print full dataLayer
    console.group('%c[GTM] dataLayer completo', 'color:#2563eb;font-weight:bold');
    window.dataLayer.forEach(function (item, i) { console.log(i, item); });
    console.groupEnd();
  };

  // Fire a test event
  window.gtmTestEvent = function (eventName, params) {
    window.dataLayer = window.dataLayer || [];
    var payload = Object.assign({ event: eventName || 'gtm_test' }, params || {});
    window.dataLayer.push(payload);
    log('Evento disparado: ' + JSON.stringify(payload), true);
  };

  // Auto-run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(window.verifyGTM, 1000);
    });
  } else {
    setTimeout(window.verifyGTM, 1000);
  }
})();
