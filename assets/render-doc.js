/* render-doc.js — 파싱된 교수안 → 읽기 좋은 교안 문서
   window.KBuilder.buildDoc(parsed, mountEl) */
(function () {
  "use strict";
  var esc = function (s) { return window.KBuilder.escapeHtml(s == null ? "" : s); };

  function renderList(b) {
    var tag = b.ordered ? "ol" : "ul";
    var cls = b.ordered ? "doc-ol" : "doc-ul";
    // 깊이 기반 중첩
    var html = "";
    var stack = [];
    var curDepth = 0;
    html += '<' + tag + ' class="' + cls + '">';
    b.items.forEach(function (it) {
      if (it.depth > curDepth) {
        html += '<' + tag + ' class="' + cls + ' nested">';
        curDepth = it.depth;
      } else {
        while (it.depth < curDepth) { html += '</' + tag + '>'; curDepth--; }
      }
      html += '<li>' + it.text + '</li>';
    });
    while (curDepth > 0) { html += '</' + tag + '>'; curDepth--; }
    html += '</' + tag + '>';
    return html;
  }

  function renderTable(b) {
    return '<div class="doc-table-wrap"><table class="doc-table">' +
      '<thead><tr>' + b.headers.map(function (h) { return '<th>' + h + '</th>'; }).join("") + '</tr></thead>' +
      '<tbody>' + b.rows.map(function (r) {
        return '<tr>' + r.map(function (c, ci) { return '<td' + (ci === 0 ? ' class="td-key"' : "") + '>' + c + '</td>'; }).join("") + '</tr>';
      }).join("") + '</tbody></table></div>';
  }

  function renderMeta(meta) {
    var keys = Object.keys(meta).filter(function (k) { return k !== "date" && k !== "status"; });
    if (!keys.length && !meta.date && !meta.status) return "";
    var pills = "";
    if (meta["소요"]) pills += '<span class="meta-pill">⏱ ' + esc(meta["소요"]) + '</span>';
    if (meta["status"]) pills += '<span class="meta-pill status">' + esc(meta["status"]) + '</span>';
    if (meta["date"]) pills += '<span class="meta-pill date">' + esc(meta["date"]) + '</span>';
    return pills ? '<div class="doc-meta-pills">' + pills + '</div>' : "";
  }

  function buildDoc(parsed, mount) {
    var meta = parsed.meta || {};
    var out = [];

    // 표지 헤더
    out.push('<header class="doc-hero">' +
      (meta["교과목"] ? '<span class="doc-course">' + esc(meta["교과목"]) + '</span>' : "") +
      '<h1 class="doc-h1">' + esc(meta["주제"] || parsed.title || "교수안") + '</h1>' +
      renderMeta(meta) +
    '</header>');

    out.push('<div class="doc-layout"><div class="doc-body">');

    parsed.blocks.forEach(function (b) {
      if (b.type === "heading") {
        if (b.level === 1) return; // 제목은 hero에서 처리
        var lvl = Math.min(b.level, 4);
        out.push('<h' + lvl + ' class="doc-h' + lvl + '">' + esc(b.text) + '</h' + lvl + '>');
      } else if (b.type === "para") {
        out.push('<p class="doc-p">' + b.html + '</p>');
      } else if (b.type === "list") {
        out.push(renderList(b));
      } else if (b.type === "table") {
        out.push(renderTable(b));
      } else if (b.type === "image") {
        out.push('<figure class="doc-figure"><img src="' + esc(b.src) + '" alt="' + esc(b.alt || "") + '" loading="lazy" />' +
          (b.alt ? '<figcaption>' + esc(b.alt) + '</figcaption>' : "") + '</figure>');
      } else if (b.type === "labelpara") {
        var lc = labelClass(b.label);
        out.push('<div class="doc-label ' + lc + '"><span class="dl-tag">' + esc(b.label) + '</span><div class="dl-body">' + b.html + '</div></div>');
      } else if (b.type === "callout") {
        out.push('<div class="doc-callout"><span class="dc-tag">💬 ' + esc(b.label) + '</span><p class="dc-quote">' + b.html + '</p></div>');
      }
    });

    // 참고 이미지 — 양 모드에서 모은 이미지를 교수안 말미에 갤러리로 인용
    out.push(refGalleryHtml());

    out.push('</div></div>');
    mount.innerHTML = '<article class="doc-page">' + out.join("") + '</article>';

    // 본문 헤딩으로 목차 사이드 생성
    buildTocSidebar(mount, parsed);
  }

  function refGalleryHtml() {
    var refs = (window.KBuilder.getRefImages && window.KBuilder.getRefImages()) || [];
    if (!refs.length) return "";
    var items = refs.map(function (r) {
      return '<figure class="doc-ref-item"><img src="' + esc(r.url) + '" alt="' + esc(r.name) + '" loading="lazy" />' +
        (r.name ? '<figcaption>' + esc(r.name) + '</figcaption>' : "") + '</figure>';
    }).join("");
    return '<section class="doc-refs"><h2 class="doc-h2">참고 이미지</h2><div class="doc-ref-grid">' + items + '</div></section>';
  }

  function labelClass(label) {
    var l = label.replace(/\s+/g, "");
    if (/강사/.test(l)) return "lab-teacher";
    if (/설명/.test(l)) return "lab-explain";
    if (/학생|수행/.test(l)) return "lab-student";
    return "lab-default";
  }

  function buildTocSidebar(mount, parsed) {
    // h2/h3을 id 부여 + 사이드 목차
    var headings = parsed.blocks.filter(function (b) { return b.type === "heading" && (b.level === 2 || b.level === 3); });
    var hEls = Array.prototype.slice.call(mount.querySelectorAll(".doc-h2, .doc-h3"));
    var nav = [];
    hEls.forEach(function (el, i) {
      var id = "sec-" + i;
      el.id = id;
      var lvl = el.classList.contains("doc-h3") ? "l3" : "l2";
      nav.push('<a href="#' + id + '" class="toc-link ' + lvl + '">' + esc(el.textContent) + '</a>');
    });
    if (!nav.length) return;
    var aside = document.createElement("aside");
    aside.className = "doc-toc";
    aside.innerHTML = '<div class="doc-toc-head">목차</div><nav>' + nav.join("") + '</nav>';
    var layout = mount.querySelector(".doc-layout");
    layout.insertBefore(aside, layout.firstChild);
    mount.querySelector(".doc-page").classList.add("has-toc");

    // 부드러운 스크롤
    aside.querySelectorAll(".toc-link").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var t = mount.querySelector(a.getAttribute("href"));
        if (t) {
          var scroller = mount.closest(".pane-scroll") || mount;
          scroller.scrollTo({ top: t.offsetTop - 24, behavior: "smooth" });
        }
      });
    });
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.buildDoc = buildDoc;
})();
