/* layouts.js — 슬라이드 레이아웃 갤러리 (새 슬라이드 추가 / 현재 슬라이드 교체) */
(function () {
  "use strict";
  var nidC = 0;
  function nid() { return "tpl-" + (Date.now() % 100000) + "-" + (++nidC); }
  function slot(h) {
    return '<image-slot id="' + nid() + '" class="imgslot" shape="rounded" radius="36" fit="contain"' +
      (h ? ' frame="fit" style="height:' + h + 'px"' : '') + ' placeholder="이미지를 끌어다 놓기"></image-slot>';
  }
  function logo() { return (window.KBuilder && window.KBuilder.logoHTML) ? window.KBuilder.logoHTML() : '<img class="logo" src="assets/logo-worlds.png" alt="" style="display:none" />'; }
  function eb(t) { return '<span class="eyebrow"><span class="dot"></span>' + t + '</span>'; }
  function sec(kind, accent, inner) {
    return '<section class="slide kind-' + kind + '" data-screen-label="새 슬라이드" style="--accent:var(--' + accent + ')">' + logo() + inner + '</section>';
  }
  function items(n) {
    var s = '<ul class="items">';
    for (var i = 0; i < n; i++) s += '<li><span class="chk">✓</span><span>내용을 입력하세요</span></li>';
    return s + '</ul>';
  }
  function cards(n) {
    var P = ["--pink", "--sky", "--lime", "--orange"];
    var s = '<div class="card-grid">';
    for (var i = 0; i < n; i++) s += '<div class="ct-card"><div class="ct-no" style="background:var(' + P[i % 4] + ')">' + (i + 1) + '</div><div class="ct-t">제목</div><p class="ct-b">설명을 입력하세요</p></div>';
    return s + '</div>';
  }

  var LAYOUTS = [
    { id: "cover", name: "표지 (제목+이미지)", make: function () {
      return sec("cover", "mush", '<div class="frame cover"><div class="cover-left">' +
        '<span class="cover-course"><span class="mush">🍄</span> 과정명</span>' +
        '<h1 class="cover-title">단원 명칭</h1><p class="cover-sub">부제를 입력하세요</p></div>' +
        '<div class="cover-right"><div class="mushcard">' + slot() + '</div></div></div>');
    } },
    { id: "part", name: "구분 (Part)", make: function () {
      return sec("content", "sky", '<div class="frame statement">' +
        '<span class="st-kicker">PART 1</span><span class="st-bar"></span>' +
        '<h2 class="st-big">제목</h2><p class="st-lead">부제를 입력하세요</p></div>');
    } },
    { id: "statement", name: "소결 / 인트로 (중앙 문구)", make: function () {
      return sec("content", "sky", '<div class="frame statement">' +
        '<span class="st-kicker">INTRODUCTION</span><span class="st-bar"></span>' +
        '<h2 class="st-big">핵심 문구를 입력하세요</h2><p class="st-lead">설명 문장을 입력하세요.</p></div>');
    } },
    { id: "toccards", name: "목차 카드", make: function () {
      var s = '<div class="toc-grid">';
      var P = ["--pink", "--sky", "--lime", "--orange"];
      for (var i = 0; i < 4; i++) s += '<div class="toc-card"><div class="no" style="background:var(' + P[i] + ')">' + (i + 1) + '</div><div class="txt">항목을 입력하세요</div></div>';
      s += '</div>';
      return sec("toc", "pink", '<div class="frame">' + eb("AGENDA") + '<h2 class="slidetitle">오늘의 여정</h2>' + s + '</div>');
    } },
    { id: "cards2", name: "카드 2개", make: function () {
      return sec("content", "pink", '<div class="frame">' + eb("01") + '<h2 class="slidetitle">타이틀</h2>' + cards(2) + '</div>');
    } },
    { id: "cards3", name: "카드 3개", make: function () {
      return sec("content", "sky", '<div class="frame">' + eb("01") + '<h2 class="slidetitle">타이틀</h2>' + cards(3) + '</div>');
    } },
    { id: "bullets", name: "불릿 + 이미지", make: function () {
      return sec("content", "lime", '<div class="frame">' + eb("01") + '<h2 class="slidetitle">타이틀</h2>' +
        '<div class="cols"><div class="col-main">' + items(3) + '</div><div class="col-side">' + slot(540) + '</div></div></div>');
    } },
    { id: "checklist", name: "체크리스트 패널", make: function () {
      return sec("content", "orange", '<div class="frame">' + eb("01") + '<h2 class="slidetitle">타이틀</h2>' +
        '<div class="cols solo"><div class="col-main"><div class="panel">' + items(4) + '</div></div></div></div>');
    } },
    { id: "table", name: "표 (3열)", make: function () {
      var row = '<tr><td>내용</td><td>내용</td><td>내용</td></tr>';
      return sec("content", "sky", '<div class="frame">' + eb("01") + '<h2 class="slidetitle">타이틀</h2>' +
        '<table class="tbl"><thead><tr><th>구분</th><th>구분</th><th>구분</th></tr></thead><tbody>' + row + row + '</tbody></table></div>');
    } },
    { id: "caseduo", name: "케이스 (이미지 2개)", make: function () {
      function col() { return '<div class="duo-col"><h3 class="duo-title">예시 제목</h3>' + slot(520) + '</div>'; }
      return sec("content", "pink", '<div class="frame">' + eb("CASE STUDY") + '<div class="duo">' + col() + col() + '</div></div>');
    } },
    { id: "closing", name: "마무리 (제목+이미지)", make: function () {
      return sec("closing", "mush", '<div class="frame closing">' +
        '<div class="closing-left"><div class="mushcard">' + slot() + '</div></div>' +
        '<div class="closing-right"><span class="cover-course"><span class="mush">🍄</span> 마무리</span>' +
        '<h2 class="closing-title">마무리 문구</h2><p class="closing-lead">한 줄 정리를 입력하세요</p></div></div>');
    } }
  ];

  /* ---------- 사용자 정의 레이아웃 (현재 슬라이드 저장 → 재사용) ---------- */
  var CUSTOM_KEY = "kb-custom-layouts";
  function esc(s) { return window.KBuilder.escapeHtml ? window.KBuilder.escapeHtml(s) : String(s == null ? "" : s); }
  function loadCustom() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); } catch (e) { return []; } }
  function saveCustom(arr) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr)); return true; } catch (e) { alert("저장 공간이 부족해 레이아웃을 저장하지 못했어요. (이미지가 큰 슬라이드는 용량을 많이 차지합니다)"); return false; } }
  function captureCurrent() {
    var ctrl = window.KBuilder.lastDeck && window.KBuilder.lastDeck.ctrl; if (!ctrl) return null;
    var cur = ctrl.slidesNow()[ctrl.index]; if (!cur) return null;
    var clone = cur.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll(".rs-handle,.marquee,.ph-spacer")).forEach(function (x) { x.remove(); });
    Array.prototype.slice.call(clone.querySelectorAll(".sel-elem")).forEach(function (x) { x.classList.remove("sel-elem"); });
    Array.prototype.slice.call(clone.querySelectorAll("[contenteditable]")).forEach(function (x) { x.removeAttribute("contenteditable"); });
    clone.removeAttribute("data-deck-active"); clone.style.display = "";
    // image-slot 의 현재 이미지(src)를 속성으로 보존 (적용 시 재현)
    var liveSlots = cur.querySelectorAll("image-slot"), cloneSlots = clone.querySelectorAll("image-slot");
    Array.prototype.slice.call(liveSlots).forEach(function (s, k) {
      var src = (s._img && /^data:/.test(s._img.src)) ? s._img.src : (s.getAttribute("src") || "");
      if (cloneSlots[k]) { if (src) cloneSlots[k].setAttribute("src", src); }
    });
    return clone.outerHTML;
  }
  function addCustomFromCurrent() {
    var html = captureCurrent();
    if (!html) { alert("먼저 슬라이드를 선택해 주세요."); return; }
    var name = prompt("레이아웃 이름을 입력하세요", "내 레이아웃 " + (loadCustom().length + 1));
    if (name == null) return;
    var arr = loadCustom();
    arr.push({ id: "custom-" + Date.now(), name: (name.trim() || "내 레이아웃"), html: html });
    if (saveCustom(arr)) { renderGrid(); requestAnimationFrame(sizePreviews); }
  }
  function deleteCustom(id) {
    if (!confirm("이 레이아웃을 삭제할까요?")) return;
    saveCustom(loadCustom().filter(function (c) { return c.id !== id; }));
    renderGrid(); requestAnimationFrame(sizePreviews);
  }
  function getLayout(id) {
    var b = LAYOUTS.find(function (x) { return x.id === id; });
    if (b) return b;
    var c = loadCustom().find(function (x) { return x.id === id; });
    return c ? { id: c.id, name: c.name, make: function () { return c.html; } } : null;
  }

  /* ---------- 패널 ---------- */
  var panel = null, gridEl = null;
  function itemHTML(L, custom) {
    return '<div class="lp-item">' +
      '<div class="lp-preview"><div class="lp-stage deck-stage-inner">' + L.make() + '</div></div>' +
      '<div class="lp-name">' + esc(L.name) + (custom ? ' <button class="lp-del" data-del="' + L.id + '" title="삭제">🗑</button>' : '') + '</div>' +
      '<div class="lp-actions"><button data-act="add" data-id="' + L.id + '">＋ 새 슬라이드</button>' +
      '<button data-act="replace" data-id="' + L.id + '">↺ 현재 교체</button></div></div>';
  }
  function renderGrid() {
    if (!gridEl) return;
    var custom = loadCustom();
    var html = LAYOUTS.map(function (L) { return itemHTML(L, false); }).join("");
    if (custom.length) {
      html += '<div class="lp-sep">내 레이아웃</div>';
      html += custom.map(function (c) { return itemHTML({ id: c.id, name: c.name, make: function () { return c.html; } }, true); }).join("");
    }
    gridEl.innerHTML = html;
  }
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "layout-panel";
    panel.innerHTML = '<div class="lp-card"><div class="lp-head"><b>레이아웃 선택</b>' +
      '<span class="lp-hint">현재 테마에 맞춰 적용됩니다</span>' +
      '<button class="lp-save" id="lp-save-cur" title="현재 슬라이드를 내 레이아웃으로 저장">＋ 현재 슬라이드를 레이아웃으로 추가</button>' +
      '<button class="lp-close" title="닫기">✕</button></div><div class="lp-grid"></div></div>';
    document.querySelector(".deck-main").appendChild(panel);
    gridEl = panel.querySelector(".lp-grid");
    renderGrid();
    panel.addEventListener("click", function (e) {
      if (e.target === panel || e.target.closest(".lp-close")) { panel.classList.remove("open"); return; }
      if (e.target.closest("#lp-save-cur")) { addCustomFromCurrent(); return; }
      var del = e.target.closest("[data-del]"); if (del) { e.stopPropagation(); deleteCustom(del.getAttribute("data-del")); return; }
      var b = e.target.closest("[data-act]"); if (!b) return;
      applyLayout(b.dataset.id, b.dataset.act);
      panel.classList.remove("open");
    });
    return panel;
  }
  /* ---------- 현재 슬라이드 내용 → 새 레이아웃으로 이전(migration) ---------- */
  function slotSrc(id) {
    var sl = document.getElementById(id); if (!sl) return "";
    return (sl._img && sl._img.src && sl._img.src.indexOf("data:") === 0) ? sl._img.src : (sl.getAttribute("src") || "");
  }
  function txt(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }
  function firstTxt(slide, sels) { for (var j = 0; j < sels.length; j++) { var e = slide.querySelector(sels[j]); if (e && txt(e)) return txt(e); } return ""; }
  function extractBundle(slide) {
    var b = { title: "", sub: "", bullets: [], key: "", images: [] };
    b.title = firstTxt(slide, [".cover-title", ".st-big", ".closing-title", ".slidetitle"]);
    b.sub = firstTxt(slide, [".cover-sub", ".st-lead", ".closing-lead"]);
    Array.prototype.slice.call(slide.querySelectorAll(".items li")).forEach(function (li) { var t = txt(li).replace(/^✓\s*/, ""); if (t) b.bullets.push(t); });
    Array.prototype.slice.call(slide.querySelectorAll(".cmp-col")).forEach(function (col) {
      var head = txt(col.querySelector(".cmp-head"));
      var items = Array.prototype.slice.call(col.querySelectorAll(".cmp-list li")).map(txt).filter(Boolean);
      var body = items.length ? items.join(", ") : txt(col.querySelector(".cmp-one"));
      if (head) b.bullets.push(head + (body ? ": " + body : ""));
    });
    Array.prototype.slice.call(slide.querySelectorAll(".ct-card")).forEach(function (c) {
      var t = txt(c.querySelector(".ct-t")), bd = txt(c.querySelector(".ct-b")); if (t) b.bullets.push(t + (bd ? ": " + bd : ""));
    });
    Array.prototype.slice.call(slide.querySelectorAll(".toc-card .txt")).forEach(function (e) { var t = txt(e); if (t) b.bullets.push(t); });
    Array.prototype.slice.call(slide.querySelectorAll(".steps-list .step-txt")).forEach(function (e) { var t = txt(e); if (t) b.bullets.push(t); });
    Array.prototype.slice.call(slide.querySelectorAll(".flow .step")).forEach(function (e) { var t = txt(e); if (t) b.bullets.push(t); });
    Array.prototype.slice.call(slide.querySelectorAll(".chips .chip")).forEach(function (e) { var t = txt(e); if (t) b.bullets.push(t); });
    Array.prototype.slice.call(slide.querySelectorAll(".tbl tbody tr")).forEach(function (tr) {
      var cells = Array.prototype.slice.call(tr.querySelectorAll("td")).map(txt).filter(Boolean); if (cells.length) b.bullets.push(cells.join(": "));
    });
    var kb = slide.querySelector(".keybar"); if (kb) b.key = txt(kb).replace(/^핵심\s*/, "");
    Array.prototype.slice.call(slide.querySelectorAll("image-slot")).forEach(function (s) { var src = slotSrc(s.id) || s.getAttribute("src") || ""; if (src) b.images.push(src); });
    Array.prototype.slice.call(slide.querySelectorAll(".pasted-img img")).forEach(function (im) { if (im.src) b.images.push(im.src); });
    return b;
  }
  function fillBody(node, bullets) {
    if (!bullets.length) return false;
    var P = ["--pink", "--sky", "--lime", "--orange"];
    var ul = node.querySelector(".items");
    if (ul) { ul.innerHTML = bullets.map(function (t) { return '<li><span class="chk">✓</span><span>' + esc(t) + '</span></li>'; }).join(""); return true; }
    var grid = node.querySelector(".card-grid");
    if (grid) {
      grid.innerHTML = bullets.map(function (t, idx) { var p = t.split(/:\s*/); return '<div class="ct-card"><div class="ct-no" style="background:var(' + P[idx % 4] + ')">' + (idx + 1) + '</div><div class="ct-t">' + esc(p[0]) + '</div><p class="ct-b">' + esc(p.slice(1).join(": ")) + '</p></div>'; }).join(""); return true;
    }
    var toc = node.querySelector(".toc-grid");
    if (toc) { toc.innerHTML = bullets.map(function (t, idx) { return '<div class="toc-card pop"><div class="no" style="background:var(' + P[idx % 4] + ')">' + (idx + 1) + '</div><div class="txt">' + esc(t) + '</div></div>'; }).join(""); return true; }
    var cmp = node.querySelector(".cmp-grid");
    if (cmp) {
      cmp.className = "cmp-grid cmp-" + Math.min(4, Math.max(2, bullets.length));
      cmp.innerHTML = bullets.slice(0, 4).map(function (t, idx) {
        var p = t.split(/:\s*/), rest = p.slice(1).join(": "); var items = rest ? rest.split(/,\s*/) : [];
        var body = items.length ? '<ul class="cmp-list">' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '<p class="cmp-one">' + esc(rest) + '</p>';
        return '<div class="cmp-col pop" style="--c:var(' + P[idx % 4] + ')"><div class="cmp-head">' + esc(p[0]) + '</div>' + body + '</div>';
      }).join(""); return true;
    }
    var steps = node.querySelector(".steps-list");
    if (steps) { steps.innerHTML = bullets.map(function (t, idx) { return '<div class="step-row pop"><span class="step-num" style="background:var(' + P[idx % 4] + ')">' + (idx + 1) + '</span><span class="step-txt">' + esc(t) + '</span></div>'; }).join(""); return true; }
    var tbody = node.querySelector(".tbl tbody");
    if (tbody) { tbody.innerHTML = bullets.map(function (t) { var c = t.split(/[:,]\s*/); return '<tr>' + [0, 1, 2].map(function (ci) { return '<td>' + esc(c[ci] || "") + '</td>'; }).join("") + '</tr>'; }).join(""); return true; }
    return false;
  }
  function migrateContent(oldSlide, node) {
    var b = extractBundle(oldSlide);
    var nt = node.querySelector(".cover-title, .st-big, .closing-title, .slidetitle");
    if (nt && b.title) nt.textContent = b.title;
    var lead = node.querySelector(".cover-sub, .st-lead, .closing-lead");
    if (b.sub) { if (lead) lead.textContent = b.sub; else b.bullets.unshift(b.sub); }
    var filled = fillBody(node, b.bullets);
    if (!filled && b.bullets.length && lead && !txt(lead)) lead.textContent = b.bullets.join(" · ");
    var nk = node.querySelector(".keybar span:last-child");
    if (nk && b.key) nk.textContent = b.key;
    else if (b.key && !node.querySelector(".keybar")) {
      var fr = node.querySelector(".frame");
      if (fr) { var kb = document.createElement("div"); kb.className = "keybar anim3"; kb.innerHTML = '<span class="klab">핵심</span><span>' + esc(b.key) + '</span>'; fr.appendChild(kb); }
    }
    Array.prototype.slice.call(node.querySelectorAll("image-slot")).forEach(function (s, idx) { if (b.images[idx]) s.setAttribute("src", b.images[idx]); });
  }

  function applyLayout(id, mode) {
    var L = getLayout(id); if (!L) return;
    var ctrl = window.KBuilder.lastDeck && window.KBuilder.lastDeck.ctrl; if (!ctrl) return;
    var ed = window.KBuilder.editor;
    var slides = ctrl.slidesNow(); var i = ctrl.index;
    var tmp = document.createElement("div"); tmp.innerHTML = L.make();
    var node = tmp.firstElementChild; if (!node) return;
    Array.prototype.slice.call(node.querySelectorAll("image-slot")).forEach(function (s) { s.id = nid(); }); // id 중복 방지
    if (ed && ed.snapshot) ed.snapshot(); // Ctrl+Z 되돌리기용
    if (mode === "replace") {
      migrateContent(slides[i], node);   // 기존 작성 내용을 새 레이아웃으로 이전 (삭제 대신 적용)
      slides[i].parentNode.replaceChild(node, slides[i]);
      ed.buildRail(); ctrl.sync(i);
    } else {
      slides[i].parentNode.insertBefore(node, slides[i].nextSibling);
      ed.buildRail(); ctrl.goTo(i + 1);
    }
  }
  /* 각 레이아웃의 실제 렌더를 1920 기준으로 축소해 미니 미리보기로 보여준다 */
  function sizePreviews() {
    if (!panel) return;
    var dark = !!document.querySelector("#deck-mount .deck-stage-inner.theme-dark");
    Array.prototype.slice.call(panel.querySelectorAll(".lp-preview")).forEach(function (box) {
      var stage = box.querySelector(".lp-stage");
      if (!stage) return;
      stage.classList.toggle("theme-dark", dark);
      var sc = (box.clientWidth || 200) / 1920;
      stage.style.transform = "scale(" + sc + ")";
      box.style.height = Math.round(1080 * sc) + "px";
    });
  }
  var btn = document.getElementById("btn-layout");
  if (btn) btn.addEventListener("click", function () {
    var p = ensurePanel(); p.classList.toggle("open");
    if (p.classList.contains("open")) { renderGrid(); requestAnimationFrame(sizePreviews); }
  });
})();
