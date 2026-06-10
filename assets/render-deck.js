/* render-deck.js — 파싱된 편성안 → 메이플스토리 월드 템플릿 16:9 슬라이드
   window.KBuilder.buildDeck(parsed, mountEl) */
(function () {
  "use strict";
  var esc = function (s) { return window.KBuilder.escapeHtml(s == null ? "" : s); };
  // 인라인 마크다운(**굵게**, `코드`)을 슬라이드 텍스트에도 적용한다.
  // 편성안 MD의 ** 가 슬라이드에 그대로 노출되던 문제 해결. (속성/ID에는 쓰지 말 것)
  function inlineMd(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  }
  var POINTS = ["--pink", "--sky", "--lime", "--orange"];
  function pad2(n) { var s = String(n).replace(/[^0-9]/g, ""); return s.length < 2 ? "0" + s : s; }

  function tagOf(text) {
    var m = text.match(/^\(([^)]{1,8})\)\s*(.*)$/);
    if (!m) return { tag: "", text: text };
    var t = m[1].replace(/\s+/g, "");
    var map = { "제목": "title", "부제": "subtitle", "큰문구": "big", "하단": "foot", "한줄": "cap" };
    return { tag: map[t] || "", text: m[2].trim() };
  }
  function isFlow(t) { return t.indexOf("→") !== -1 && t.split("→").length >= 2; }
  function isChips(t) { var p = t.split(/\s*[\/·]\s*/); return p.length >= 3 && p.every(function (x) { return x.trim().length <= 16; }); }
  function isStep(t) { return /^\s*(\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/.test(t); }

  function deckKey(meta) {
    var base = (meta["주제"] || meta["교과목"] || "deck");
    var h = 0; for (var i = 0; i < base.length; i++) { h = (h * 31 + base.charCodeAt(i)) % 100000; }
    return "d" + h;
  }

  /* ---------- 본문 ---------- */
  function renderBody(lines) {
    var out = [], buf = [];
    function flush() {
      if (!buf.length) return;
      out.push('<ul class="items anim2">' + buf.map(function (b) {
        var sub = b.depth > 0 ? " sub" : "";
        return '<li class="' + sub.trim() + '"><span class="chk">✓</span><span>' + inlineMd(b.text) + '</span></li>';
      }).join("") + '</ul>');
      buf = [];
    }
    lines.forEach(function (item) {
      var info = tagOf(item.text), text = info.text;
      if (info.tag === "big" || info.tag === "title" || info.tag === "subtitle") { flush(); out.push('<p class="lead anim" style="font-size:var(--type-subtitle);color:var(--ink);font-weight:700;max-width:none">' + inlineMd(text) + '</p>'); return; }
      if (info.tag === "foot" || info.tag === "cap") { flush(); out.push('<p class="lead anim3">' + inlineMd(text) + '</p>'); return; }
      if (isFlow(text)) { flush(); out.push(flowHtml(text)); return; }
      if (isStep(text) && item.depth === 0) { flush(); out.push(stepHtml(text)); return; }
      if (isChips(text) && item.depth === 0) { flush(); out.push(chipsHtml(text)); return; }
      buf.push(item);
    });
    flush();
    return out.join("");
  }
  function flowHtml(text) {
    var steps = text.split("→").map(function (s) { return s.trim(); }).filter(Boolean);
    return '<div class="flow anim2">' + steps.map(function (s, i) {
      var m = s.match(/^\s*(\d+)[.)]\s*(.*)$/);
      var no = m ? '<span class="no">' + m[1] + '</span>' : "";
      var lab = m ? m[2] : s;
      return '<div class="step">' + no + '<span>' + inlineMd(lab) + '</span></div>' + (i < steps.length - 1 ? '<span class="arrow">→</span>' : "");
    }).join("") + '</div>';
  }
  function stepHtml(text) {
    var no = text.match(/^\s*(\d+|[①②③④⑤⑥⑦⑧⑨])/)[1];
    var rest = text.replace(/^\s*(\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/, "");
    return '<div class="flow anim2"><div class="step"><span class="no">' + esc(no) + '</span><span>' + inlineMd(rest) + '</span></div></div>';
  }
  function chipsHtml(text) {
    var parts = text.split(/\s*[\/·]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    return '<div class="chips anim2">' + parts.map(function (p) { return '<span class="chip">' + inlineMd(p) + '</span>'; }).join("") + '</div>';
  }

  /* ---------- 가구 ---------- */
  // 로고: 사용자가 업로드한 src가 있고 표시(shown)일 때만 보인다. 기본은 숨김.
  function logo() {
    var L = (window.KBuilder && window.KBuilder.logo) || {};
    var show = !!(L.shown && L.src);
    return '<img class="logo" src="' + (L.src || "assets/logo-worlds.png") + '" alt=""' + (show ? '' : ' style="display:none"') + ' />';
  }
  function pagenum(cur, total) { return ""; } // 페이지 표시 제거 (사용자 요청)
  function brandfoot(meta) { return ""; } // 우측 하단 푸터 제거 (사용자 요청)
  function eyebrow(label) { return '<span class="eyebrow anim"><span class="dot"></span>' + esc(label) + '</span>'; }
  function keybar(key) { return key ? '<div class="keybar anim3"><span class="klab">핵심</span><span>' + inlineMd(key) + '</span></div>' : ""; }
  // 이미지는 절대 잘리지 않도록 항상 contain. fitFrame=true면 프레임이 이미지 비율에 맞춰져
  // 여백(레터박스) 없이 영역을 가득 채운다. (image-slot의 frame="fit" 처리)
  function imgslot(id, placeholder, cls, src, fitFrame) {
    return '<image-slot id="' + esc(id) + '" class="' + cls + '" shape="rounded" radius="36" fit="contain"' +
      (fitFrame ? ' frame="fit"' : '') +
      (src ? ' src="' + src + '"' : '') + ' placeholder="' + esc(placeholder || "이미지를 끌어다 놓기") + '"></image-slot>';
  }

  /* ---------- 레이아웃 ---------- */
  function slideCover(s, meta, key) {
    var titleItem = s.lines.find(function (l) { return tagOf(l.text).tag === "title"; });
    var subItem = s.lines.find(function (l) { return tagOf(l.text).tag === "subtitle"; });
    var title = titleItem ? tagOf(titleItem.text).text : (meta["주제"] || s.title);
    var sub = subItem ? tagOf(subItem.text).text : (meta["부제"] || "");
    return logo() +
      '<div class="frame cover solo">' +
        '<div class="cover-left">' +
          '<span class="cover-course"><span class="mush">🍄</span> ' + esc(meta["교과목"] || "메이플스토리 월드 코딩 교실") + '</span>' +
          '<h1 class="cover-title anim">' + inlineMd(title) + '</h1>' +
          (sub ? '<p class="cover-sub anim2">' + inlineMd(sub) + '</p>' : "") +
        '</div>' +
      '</div>' +
      brandfoot(meta);
  }

  function slideToc(s, num, total) {
    var heading = "", items = [];
    s.lines.forEach(function (l) {
      var t = tagOf(l.text).text;
      if (isStep(t)) items.push(t.replace(/^\s*\d+[.)]\s*/, ""));
      else if (!items.length && !heading) heading = t;
      else if (items.length) items.push(t);
    });
    if (!heading) heading = "오늘의 여정";
    return logo() +
      '<div class="frame">' +
        eyebrow("AGENDA") +
        '<h2 class="slidetitle">' + inlineMd(heading) + '</h2>' +
        '<div class="toc-grid">' + items.map(function (it, i) {
          var c = "var(" + POINTS[i % 4] + ")";
          return '<div class="toc-card pop"><div class="no" style="background:' + c + '">' + (i + 1) + '</div><div class="txt">' + inlineMd(it) + '</div></div>';
        }).join("") + '</div>' +
      '</div>' +
      pagenum(num, total);
  }

  /* ---------- 레이아웃 자동 선택 헬퍼 ---------- */
  function statementInfo(lines) {
    var bigItem = null, rest = [];
    lines.forEach(function (l) {
      var info = tagOf(l.text);
      if (info.tag === "big" && !bigItem) bigItem = info.text;
      else rest.push(tagOf(l.text).text);
    });
    return bigItem ? { big: bigItem, rest: rest } : null;
  }
  function collectCards(lines) {
    var cards = [], cur = null, ok = true;
    lines.forEach(function (l) {
      var info = tagOf(l.text);
      if (info.tag) { ok = false; return; }
      var t = info.text;
      if (l.depth === 0) {
        if (isFlow(t) || isChips(t) || isStep(t)) { ok = false; return; }
        cur = { t: t, b: [] }; cards.push(cur);
      } else if (cur) cur.b.push(t);
    });
    if (!ok || cards.length < 2 || cards.length > 4) return null;
    if (!cards.every(function (c) { return c.t.length <= 22; })) return null;
    return cards;
  }

  function slideStatement(s, num, total, info) {
    var lead = info.rest.join(" ") || s.key || "";
    return logo() +
      '<div class="frame statement">' +
        '<span class="st-kicker anim">' + inlineMd(s.title) + '</span>' +
        '<span class="st-bar anim"></span>' +
        '<h2 class="st-big anim2">' + inlineMd(info.big) + '</h2>' +
        (lead ? '<p class="st-lead anim3">' + inlineMd(lead) + '</p>' : "") +
      '</div>' +
      pagenum(num, total);
  }

  function slideCards(s, num, total, cards) {
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        '<div class="card-grid">' + cards.map(function (c, i) {
          var col = "var(" + POINTS[i % 4] + ")";
          return '<div class="ct-card pop"><div class="ct-no" style="background:' + col + '">' + (i + 1) + '</div>' +
            '<div class="ct-t">' + inlineMd(c.t) + '</div>' +
            (c.b.length ? '<p class="ct-b">' + inlineMd(c.b.join(" ")) + '</p>' : "") + '</div>';
        }).join("") + '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function slideContent(s, num, total, key, variant) {
    variant = variant || {};
    var hasVisual = !!s.visual;
    var body = renderBody(s.lines);
    if (variant.panel && /class="items/.test(body)) body = '<div class="panel">' + body + '</div>';
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        '<div class="cols' + (hasVisual ? (variant.flip ? " flip" : "") : " solo") + '">' +
          '<div class="col-main">' + body + '</div>' +
          (hasVisual ? '<div class="col-side pop">' + imgslot(key + "-img-" + s.num, s.visual, "imgslot", "", true) + '</div>' : "") +
        '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function slideActivity(s, num, total, key) {
    var hasVisual = !!s.visual;
    var cleanTitle = s.title.replace(/^\[?활동\]?\s*[:：]?\s*/, "");
    return logo() +
      '<div class="frame">' +
        eyebrow("활동 · " + pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(cleanTitle) + '</h2>' +
        '<div class="cols' + (hasVisual ? "" : " solo") + '">' +
          '<div class="col-main">' + renderBody(s.lines) + '</div>' +
          (hasVisual ? '<div class="col-side pop">' + imgslot(key + "-img-" + s.num, s.visual, "imgslot", "", true) + '</div>' : "") +
        '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function slideClosing(s, meta, key) {
    var bigItem = s.lines.find(function (l) { return tagOf(l.text).tag === "big" || tagOf(l.text).tag === "title"; });
    var big = bigItem ? tagOf(bigItem.text).text : (s.key || s.title);
    var lead = s.lines.filter(function (l) { return l !== bigItem; }).map(function (l) { return tagOf(l.text).text; })[0] || s.key || "";
    return logo() +
      '<div class="frame closing">' +
        '<div class="closing-left pop"><div class="mushcard">' + imgslot(key + "-mush-closing", "버섯 캐릭터(교체 가능)", "imgslot", "assets/mushroom.png") + '</div></div>' +
        '<div class="closing-right">' +
          '<span class="cover-course"><span class="mush">🍄</span> ' + esc(s.title) + '</span>' +
          '<h2 class="closing-title anim">' + inlineMd(big) + '</h2>' +
          (lead && lead !== big ? '<p class="closing-lead anim2">' + inlineMd(lead) + '</p>' : "") +
        '</div>' +
      '</div>' +
      brandfoot(meta);
  }

  /* ---------- 비교/대조 (label: 내용 묶음 2~4개) ---------- */
  function splitItems(body) {
    return body.split(/\s*[·/、,]\s*|\s{2,}/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function footOf(lines) {
    var f = lines.filter(function (l) { var t = tagOf(l.text).tag; return t === "foot" || t === "cap"; })
      .map(function (l) { return tagOf(l.text).text; })[0];
    return f || "";
  }
  function labeledGroups(lines) {
    var groups = [], others = 0;
    lines.forEach(function (l) {
      if (l.depth > 0) return;
      var info = tagOf(l.text);
      if (info.tag) { if (info.tag === "foot" || info.tag === "cap") return; others++; return; }
      var m = info.text.match(/^([^:：]{1,16})[:：]\s*(.+)$/);
      if (m && !/https?/i.test(m[1])) groups.push({ label: m[1].trim(), body: m[2].trim() });
      else others++;
    });
    if (groups.length >= 2 && groups.length <= 4 && others <= 1 &&
        groups.some(function (g) { return g.body.length > 2; })) return groups;
    return null;
  }
  function slideCompare(s, num, total, groups) {
    var foot = footOf(s.lines);
    var cols = groups.map(function (g, i) {
      var c = "var(" + POINTS[i % 4] + ")";
      var items = splitItems(g.body);
      var body = items.length > 1
        ? '<ul class="cmp-list">' + items.map(function (it) { return '<li>' + inlineMd(it) + '</li>'; }).join("") + '</ul>'
        : '<p class="cmp-one">' + inlineMd(g.body) + '</p>';
      return '<div class="cmp-col pop" style="--c:' + c + '"><div class="cmp-head">' + inlineMd(g.label) + '</div>' + body + '</div>';
    }).join("");
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        '<div class="cmp-grid cmp-' + groups.length + '">' + cols + '</div>' +
        (foot ? '<p class="cmp-foot anim3">' + inlineMd(foot) + '</p>' : "") +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  /* ---------- 단계/절차 (번호 목록 3+개, → 없는 경우) ---------- */
  function stepSequence(lines) {
    var steps = [], ok = true;
    lines.forEach(function (l) {
      if (l.depth > 0) return;
      var info = tagOf(l.text);
      if (info.tag) { if (info.tag === "foot" || info.tag === "cap") return; ok = false; return; }
      if (isFlow(info.text)) { ok = false; return; }
      if (isStep(info.text)) steps.push(info.text.replace(/^\s*(\d+[.)]|[①②③④⑤⑥⑦⑧⑨])\s*/, ""));
      else ok = false;
    });
    return (ok && steps.length >= 3) ? steps : null;
  }
  function slideSteps(s, num, total, key, steps) {
    var hasVisual = !!s.visual;
    var list = '<div class="steps-list">' + steps.map(function (t, i) {
      var c = "var(" + POINTS[i % 4] + ")";
      return '<div class="step-row pop"><span class="step-num" style="background:' + c + '">' + (i + 1) + '</span><span class="step-txt">' + inlineMd(t) + '</span></div>';
    }).join("") + '</div>';
    return logo() +
      '<div class="frame">' +
        eyebrow(pad2(s.num)) +
        '<h2 class="slidetitle">' + inlineMd(s.title) + '</h2>' +
        '<div class="cols' + (hasVisual ? "" : " solo") + '">' +
          '<div class="col-main">' + list + '</div>' +
          (hasVisual ? '<div class="col-side pop">' + imgslot(key + "-img-" + s.num, s.visual, "imgslot", "", true) + '</div>' : "") +
        '</div>' +
        keybar(s.key) +
      '</div>' +
      pagenum(num, total);
  }

  function renderSlide(s, meta, num, total, key, accentIdx) {
    var inner, accent = "var(--mush)";
    switch (s.kind) {
      case "cover": inner = slideCover(s, meta, key); break;
      case "toc": inner = slideToc(s, num, total); accent = "var(" + POINTS[accentIdx % 4] + ")"; break;
      case "activity": accent = "var(" + POINTS[accentIdx % 4] + ")"; inner = slideActivity(s, num, total, key); break;
      case "closing": inner = slideClosing(s, meta, key); break;
      default:
        accent = "var(" + POINTS[accentIdx % 4] + ")";
        var st = statementInfo(s.lines);
        var groups = labeledGroups(s.lines);
        var cards = collectCards(s.lines);
        var steps = stepSequence(s.lines);
        if (st && s.lines.length <= 3) inner = slideStatement(s, num, total, st);
        else if (groups) inner = slideCompare(s, num, total, groups);       // 비교·대조 / 용어 풀이
        else if (cards) inner = slideCards(s, num, total, cards);            // 카드 (제목+설명)
        else if (steps) inner = slideSteps(s, num, total, key, steps);       // 단계·절차
        else inner = slideContent(s, num, total, key, { flip: accentIdx % 2 === 1, panel: accentIdx % 3 === 2 });
    }
    return '<section class="slide kind-' + s.kind + '" data-screen-label="' + esc(pad2(s.num)) + ' ' + esc(s.title) + '" style="--accent:' + accent + '">' + inner + '</section>';
  }

  /* ---------- 빌드 + 스테이지 ---------- */
  function buildDeck(parsed, mount) {
    var meta = parsed.meta || {};
    var key = deckKey(meta);
    var total = parsed.slides.length;
    var accentIdx = 0;
    var slidesHtml = parsed.slides.map(function (s, i) {
      var ai = accentIdx;
      if (s.kind === "content" || s.kind === "activity" || s.kind === "toc") accentIdx++;
      return renderSlide(s, meta, i + 1, total, key, ai);
    }).join("");
    return mountStage(slidesHtml, mount, parsed, key);
  }

  /* 슬라이드 HTML을 스테이지에 장착 (빌드·불러오기 공용) */
  function mountStage(slidesHtml, mount, parsed, key) {
    var total = (parsed.slides && parsed.slides.length) || "";
    mount.innerHTML =
      '<div class="deck-viewport" tabindex="0">' +
        '<div class="deck-scaler"><div class="deck-stage-inner">' + slidesHtml + '</div></div>' +
        '<button class="deck-nav prev" aria-label="이전">‹</button>' +
        '<button class="deck-nav next" aria-label="다음">›</button>' +
        '<div class="deck-counter"><span class="dc-cur">1</span> / <span class="dc-tot">' + total + '</span></div>' +
      '</div>';

    var viewport = mount.querySelector(".deck-viewport");
    var scaler = mount.querySelector(".deck-scaler");
    var stageInner = mount.querySelector(".deck-stage-inner");
    var idx = 0;
    var curEl = mount.querySelector(".dc-cur");
    var totEl = mount.querySelector(".dc-tot");
    var onShow = null;

    function slidesNow() { return Array.prototype.slice.call(stageInner.querySelectorAll(".slide")); }
    function show(n) {
      var slides = slidesNow();
      idx = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach(function (sl, i) {
        if (i === idx) { sl.setAttribute("data-deck-active", ""); sl.style.display = "block"; }
        else { sl.removeAttribute("data-deck-active"); sl.style.display = "none"; }
      });
      curEl.textContent = idx + 1;
      totEl.textContent = slides.length;
      if (onShow) onShow(idx, slides);
    }
    function fit() {
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (vw < 2 || vh < 2) return false;
      scaler.style.transform = "translate(-50%,-50%) scale(" + Math.min(vw / 1920, vh / 1080) + ")";
      return true;
    }
    function fitWhenReady(t) { if (fit() || t <= 0) return; requestAnimationFrame(function () { fitWhenReady(t - 1); }); }

    mount.querySelector(".deck-nav.prev").addEventListener("click", function () { show(idx - 1); });
    mount.querySelector(".deck-nav.next").addEventListener("click", function () { show(idx + 1); });
    viewport.addEventListener("keydown", function (e) {
      if (e.target && e.target.isContentEditable) return;
      if (viewport.classList.contains("editing")) return; // 편집 모드: 에디터가 키 처리
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { show(idx + 1); e.preventDefault(); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { show(idx - 1); e.preventDefault(); }
    });

    var ro = new ResizeObserver(fit);
    ro.observe(viewport);
    window.addEventListener("resize", fit);
    fitWhenReady(30); show(0);

    var ctrl = {
      goTo: show, refit: function () { fitWhenReady(30); },
      get index() { return idx; },
      get count() { return slidesNow().length; },
      slidesNow: slidesNow, sync: function (n) { show(n == null ? idx : n); },
      stageInner: stageInner, viewport: viewport, mount: mount,
      setOnShow: function (fn) { onShow = fn; },
      destroy: function () { ro.disconnect(); }
    };
    window.KBuilder.lastDeck = { parsed: parsed, key: key, ctrl: ctrl };
    return ctrl;
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.buildDeck = buildDeck;
  window.KBuilder.logoHTML = logo; // 로고 상태 기반 <img> (layouts/editor 공용)
  /* 내용→레이아웃 판별 휴리스틱 공유 — PPTX 내보내기가 화면 렌더와 같은 레이아웃을 쓰게 한다 */
  window.KBuilder.deckHeuristics = {
    tagOf: tagOf, isFlow: isFlow, isChips: isChips, isStep: isStep,
    statementInfo: statementInfo, collectCards: collectCards,
    labeledGroups: labeledGroups, stepSequence: stepSequence,
    footOf: footOf, splitItems: splitItems
  };
  /* 내보낸 HTML의 슬라이드를 그대로 장착해 이어서 편집 */
  window.KBuilder.mountDeckHtml = function (slidesHtml, mount, meta) {
    var parsed = { meta: meta || {}, slides: [] };
    var ctrl = mountStage(slidesHtml, mount, parsed, deckKey(meta || {}));
    window.KBuilder.lastDeck.imported = true;
    return ctrl;
  };
})();
