/* GMS Locker Fantrax transport.
 * Production default: same-origin /api/fantrax?endpoint=...
 * Set window.GMS_FANTRAX_PROXY before app.js to use a standalone Worker URL.
 */
(function () {
  "use strict";

  var originalFetch = window.fetch.bind(window);
  var FANTRAX_PREFIX = "https://www.fantrax.com/fxea/general/";

  function proxyBase() {
    var configured = String(window.GMS_FANTRAX_PROXY || "").trim();
    return configured || (window.location.origin + "/api/fantrax");
  }

  window.fetch = function (input, init) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    if (raw.indexOf(FANTRAX_PREFIX) !== 0) return originalFetch(input, init);

    var source = new URL(raw);
    var endpoint = source.pathname.split("/").pop();
    var target = new URL(proxyBase(), window.location.href);
    target.searchParams.set("endpoint", endpoint);
    source.searchParams.forEach(function (value, key) {
      target.searchParams.append(key, value);
    });

    return originalFetch(target.toString(), Object.assign({}, init || {}, {
      headers: Object.assign({ Accept: "application/json" }, (init && init.headers) || {})
    }));
  };
})();
