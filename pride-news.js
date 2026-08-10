// NFL News on gmslocker.com — ESPN direct
(function () {
  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function ensureView() {
    if (document.getElementById("newsfeed")) return;
    var sec = document.createElement("section");
    sec.id = "newsfeed";
    sec.className = "view";
    (document.querySelector(".app") || document.body).appendChild(sec);
  }
  function patchNav() {
    var navEl = document.getElementById("nav");
    if (!navEl || navEl.querySelector('[data-view="newsfeed"]')) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.view = "newsfeed";
    btn.textContent = "NFL News";
    btn.onclick = function () { showView("newsfeed"); };
    navEl.appendChild(btn);
  }
  window.renderNewsFeed = async function () {
    ensureView();
    var root = document.getElementById("newsfeed");
    if (!root) return;
    root.innerHTML =
      '<div class="card"><div class="sectionhead"><h2>NFL News</h2><span class="pill">ESPN</span></div>' +
      '<button type="button" onclick="window.prideLoadNews()">REFRESH NEWS</button>' +
      '<div id="newsList" style="margin-top:12px">Loading…</div></div>';
    await window.prideLoadNews();
  };
  window.prideLoadNews = async function () {
    var list = document.getElementById("newsList");
    if (!list) return;
    try {
      var res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=40", { cache: "no-store" });
      var data = await res.json();
      var arts = data.articles || [];
      list.innerHTML = arts.map(function (a) {
        var link = (a.links && a.links.web && a.links.web.href) || "";
        return '<div class="gate"><span><b>' + esc(a.headline) + '</b><br><span class="small">' +
          esc(a.description || "") + '</span></span>' +
          (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener" style="color:#f1cf62">Open</a>' : '') +
          '</div>';
      }).join("") || "<div class=\"notice\">No articles</div>";
    } catch (e) {
      list.innerHTML = "<div class=\"notice\">News failed: " + esc(e.message || e) + "</div>";
    }
  };
  var orig = window.showView;
  window.showView = function (id) {
    if (id === "newsfeed") {
      ensureView();
      document.querySelectorAll(".view").forEach(function (x) { x.classList.remove("active"); });
      var el = document.getElementById("newsfeed");
      if (el) el.classList.add("active");
      window.renderNewsFeed();
      return;
    }
    if (typeof orig === "function") orig(id);
  };
  setTimeout(patchNav, 800);
  setInterval(patchNav, 4000);
})();
