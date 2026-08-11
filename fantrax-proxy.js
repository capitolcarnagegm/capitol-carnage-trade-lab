/* GMS Locker Fantrax transport.
 * Production default: the deployed standalone Cloudflare Worker.
 * Set window.GMS_FANTRAX_PROXY before app.js to override the Worker URL.
 */
(function () {
  "use strict";

  var originalFetch = window.fetch.bind(window);
  var FANTRAX_PREFIX = "https://www.fantrax.com/fxea/general/";
  var WORKERS_DEV_PROXY = "https://gmslocker-fantrax-proxy.robinharvey001.workers.dev/";

  function proxyBase() {
    var configured = String(window.GMS_FANTRAX_PROXY || "").trim();
    return configured || WORKERS_DEV_PROXY;
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
