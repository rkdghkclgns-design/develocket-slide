/* export.js — 슬라이드 덱을 HTML(단독 파일) / PPTX로 내보내기
   window.KBuilder.exportHTML(), window.KBuilder.exportPPTX() */
(function () {
  "use strict";
  var esc = function (s) { return window.KBuilder.escapeHtml(s == null ? "" : s); };

  function download(filename, data, mime) {
    var blob = new Blob([data], { type: (mime || "text/plain") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
  }
  function fetchText(path) { return fetch(path).then(function (r) { return r.text(); }); }

  /* 웹폰트(Jua·Gothic A1)를 dataURL로 내장한 CSS 생성 (1회 캐시) */
  var FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Jua&family=Gothic+A1:wght@400;700;900&display=swap";
  var fontCssCache = null;
  function getFontCss() {
    if (fontCssCache) return Promise.resolve(fontCssCache);
    return fetch(FONT_CSS_URL).then(function (r) { return r.text(); }).then(function (css) {
      var urls = [], re = /url\((https:[^)]+)\)/g, m;
      while ((m = re.exec(css))) urls.push(m[1]);
      var uniq = Array.from(new Set(urls));
      return Promise.all(uniq.map(function (u) {
        return fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
          return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res([u, fr.result]); }; fr.readAsDataURL(b); });
        });
      })).then(function (pairs) {
        pairs.forEach(function (p) { css = css.split(p[0]).join(p[1]); });
        fontCssCache = css;
        return css;
      });
    });
  }
  function fetchDataUrl(path) {
    return fetch(path).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); });
    });
  }
  function slotSrc(id) {
    var sl = document.getElementById(id);
    if (!sl) return "";
    return (sl._img && sl._img.src && sl._img.src.indexOf("data:") === 0) ? sl._img.src : (sl.getAttribute("src") || "");
  }

  /* ============ HTML 단독 파일 내보내기 ============ */
  function exportHTML() {
    var deck = window.KBuilder.lastDeck;
    var inner = document.querySelector("#deck-mount .deck-stage-inner");
    if (!deck || !inner) { alert("먼저 슬라이드를 만들어 주세요."); return; }
    var btn = document.getElementById("btn-html"); var old = btn.textContent; btn.textContent = "⏳ 폰트 포함 중…";

    // 모든 슬라이드의 애니 순서를 굽고 인라인 딜레이를 박아 — 내보낸 HTML도 같은 순서로 재생
    if (window.KBuilder.animOrder) window.KBuilder.animOrder.ensureAll(inner);
    Promise.all([fetchText("assets/styles.css"), fetchText("assets/slides.css"), getFontCss().catch(function () { return null; })]).then(function (parts) {
      var css = parts[0] + "\n" + parts[1];
      var fontCss = parts[2];
      var clone = inner.cloneNode(true);
      // 편집 잔여물 제거 (핸들·선택 외곽선)
      Array.prototype.slice.call(clone.querySelectorAll(".rs-handle")).forEach(function (h) { h.remove(); });
      Array.prototype.slice.call(clone.querySelectorAll(".sel-elem")).forEach(function (x) { x.classList.remove("sel-elem"); });
      // image-slot → <div><img></div> (현재 이미지 또는 placeholder)
      var slots = Array.prototype.slice.call(clone.querySelectorAll("image-slot"));
      slots.forEach(function (sl) {
        var src = slotSrc(sl.id) || sl.getAttribute("src") || "";
        var fit = sl.getAttribute("fit") || "contain";
        var wrap = document.createElement("div");
        wrap.className = sl.className;
        wrap.setAttribute("style", "overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f3eee0");
        if (src) {
          var im = document.createElement("img");
          im.src = src; im.setAttribute("style", "width:100%;height:100%;object-fit:" + fit);
          wrap.appendChild(im);
        } else {
          wrap.style.color = "#9a8f78"; wrap.style.fontSize = "24px"; wrap.style.padding = "24px"; wrap.style.textAlign = "center";
          wrap.textContent = sl.getAttribute("placeholder") || "";
        }
        sl.parentNode.replaceChild(wrap, sl);
      });
      // 상대경로 이미지(logo/mushroom)를 dataURL로 인라인
      var imgs = Array.prototype.slice.call(clone.querySelectorAll("img")).filter(function (im) {
        var s = im.getAttribute("src") || ""; return s.indexOf("assets/") === 0 || (s.indexOf("data:") !== 0 && s.indexOf("http") !== 0);
      });
      return Promise.all(imgs.map(function (im) {
        return fetchDataUrl(im.getAttribute("src")).then(function (d) { im.setAttribute("src", d); }).catch(function () {});
      })).then(function () {
        var themeCls = inner.classList.contains("theme-dark") ? " theme-dark" : "";
        var doc = standaloneDoc(deck.parsed, clone.innerHTML, css, themeCls, fontCss);
        download((deck.parsed.meta["주제"] || "슬라이드") + ".html", doc, "text/html");
        btn.textContent = old;
      });
    }).catch(function (e) { console.error(e); alert("HTML 내보내기 실패: " + e); btn.textContent = old; });
  }

  function standaloneDoc(parsed, innerHTML, css, themeCls, fontCss) {
    var title = esc(parsed.meta["주제"] || "슬라이드");
    var fontPart = fontCss
      ? '<style>' + fontCss + '</style>'
      : '<link href="https://fonts.googleapis.com/css2?family=Jua&family=Gothic+A1:wght@400;500;700;800;900&display=swap" rel="stylesheet"/>';
    // 교수안·편성안·소스 원고 MD를 내장 — '내보낸 HTML 불러오기'에서 한번에 복원·수정 가능
    var src = window.KBuilder.getSource ? window.KBuilder.getSource() : null;
    var srcPart = "";
    if (src && (src.doc || src.deck || src.source)) {
      srcPart = '<script type="application/json" id="kb-source">' +
        JSON.stringify(src).replace(/</g, "\\u003c") + '<\/script>';
    }
    return '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
      '<title>' + title + '</title>' + fontPart +
      '<style>html,body{margin:0;height:100%;background:#18213a}\n' + css + '\n' +
      '.deck-viewport{position:fixed;inset:0}</style></head><body>' +
      '<div class="deck-viewport" tabindex="0">' +
      '<div class="deck-scaler"><div class="deck-stage-inner' + (themeCls || "") + '">' + innerHTML + '</div></div>' +
      '<button class="deck-nav prev" aria-label="이전">‹</button>' +
      '<button class="deck-nav next" aria-label="다음">›</button>' +
      '<div class="deck-counter"><span class="dc-cur">1</span> / <span class="dc-tot">' + parsed.slides.length + '</span></div>' +
      '</div>' + srcPart + '<script>' + stageScript() + '<\/script></body></html>';
  }

  function stageScript() {
    return "(function(){var vp=document.querySelector('.deck-viewport'),sc=document.querySelector('.deck-scaler')," +
      "ss=[].slice.call(document.querySelectorAll('.slide')),i=0,cur=document.querySelector('.dc-cur');" +
      "function show(n){i=Math.max(0,Math.min(ss.length-1,n));ss.forEach(function(s,k){if(k===i){s.setAttribute('data-deck-active','');s.style.display='block';}else{s.removeAttribute('data-deck-active');s.style.display='none';}});cur.textContent=i+1;}" +
      "function fit(){var w=vp.clientWidth,h=vp.clientHeight;if(w<2||h<2)return;sc.style.transform='translate(-50%,-50%) scale('+Math.min(w/1920,h/1080)+')';}" +
      "document.querySelector('.deck-nav.prev').onclick=function(){show(i-1);};document.querySelector('.deck-nav.next').onclick=function(){show(i+1);};" +
      "addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){show(i+1);}if(e.key==='ArrowLeft'||e.key==='PageUp'){show(i-1);}});" +
      "addEventListener('resize',fit);new ResizeObserver(fit).observe(vp);fit();show(0);})();";
  }

  /* ============ PPTX 내보내기 (PptxGenJS, 편집 가능 텍스트) ============ */
  var IW = 13.333, IH = 7.5;
  function X(px) { return +(px / 1920 * IW).toFixed(2); }
  function Y(px) { return +(px / 1080 * IH).toFixed(2); }
  function PT(px) { return Math.max(12, Math.round(px * 0.5)); }
  var C = { ink: "2B2240", soft: "5C5470", mush: "F5A623", pink: "F48FB6", sky: "5CC6F0", lime: "A9C63E", orange: "F3994F", paper: "FFFDF6" };
  var BASE = JSON.parse(JSON.stringify(C));
  var THEME = { bg: "FFF3E0", phFill: "F3EEE0", phText: "9A8F78", phLine: "FFFFFF", dark: false };
  var POINTS = ["pink", "sky", "lime", "orange"];

  function tagOf(text) {
    var m = text.match(/^\(([^)]{1,8})\)\s*(.*)$/);
    if (!m) return { tag: "", text: text };
    var t = m[1].replace(/\s+/g, "");
    var map = { "제목": "title", "부제": "subtitle", "큰문구": "big", "하단": "foot", "한줄": "cap" };
    return { tag: map[t] || "", text: m[2].trim() };
  }
  function bodyLines(s) {
    var arr = [];
    s.lines.forEach(function (l) {
      var info = tagOf(l.text); var t = info.text;
      if (info.tag === "title" || info.tag === "subtitle") return; // 표지/별도 처리
      t = t.replace(/\s*→\s*/g, "  →  ");
      arr.push({ text: t, indent: l.depth > 0 ? 1 : 0, tag: info.tag });
    });
    return arr;
  }

  function exportPPTX() {
    var deck = window.KBuilder.lastDeck;
    if (!deck) { alert("먼저 슬라이드를 만들어 주세요."); return; }
    if (deck.imported || !deck.parsed.slides.length) { alert("불러온 HTML 덱은 PPTX 변환을 지원하지 않아요. HTML 또는 PDF로 내보내 주세요."); return; }
    if (typeof PptxGenJS === "undefined") { alert("PPTX 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
    var btn = document.getElementById("btn-pptx"); var old = btn.textContent; btn.textContent = "⏳ PPTX…";

    // 테마 반영
    var darkTheme = !!document.querySelector("#deck-mount .deck-stage-inner.theme-dark");
    Object.assign(C, BASE);
    if (darkTheme) Object.assign(C, { ink: "E9EEF7", soft: "93A1B8", mush: "29B6E8", pink: "29B6E8", sky: "4FC7F0", lime: "35C3EA", orange: "29B6E8", paper: "1A2336" });
    Object.assign(THEME, darkTheme
      ? { bg: "0E1628", phFill: "101A2E", phText: "6D7C97", phLine: "33415E", dark: true }
      : { bg: "FFF3E0", phFill: "F3EEE0", phText: "9A8F78", phLine: "FFFFFF", dark: false });

    var Lg = window.KBuilder.logo || {};
    var logoData = (Lg.shown && Lg.src) ? Lg.src : null;
    Promise.all([fetchDataUrl("assets/mushroom.png")]).then(function (imgs) {
      var mush = imgs[0];
      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: "MW", width: IW, height: IH });
      pptx.layout = "MW";
      var meta = deck.parsed.meta || {};
      var key = deck.key;
      var accentIdx = 0;

      deck.parsed.slides.forEach(function (s, i) {
        var slide = pptx.addSlide();
        slide.background = { color: THEME.bg };
        var accent = C.mush;
        if (s.kind === "content" || s.kind === "activity" || s.kind === "toc") { accent = C[POINTS[accentIdx % 4]]; accentIdx++; }

        // 사용자 로고 (표시 설정 시에만, 비율 유지)
        if (logoData) slide.addImage({ data: logoData, x: X(1920 - 64 - 300), y: Y(44), w: X(300), h: Y(132), sizing: { type: "contain", w: X(300), h: Y(132) } });

        if (s.kind === "cover") coverSlide(slide, s, meta, mush, key);
        else if (s.kind === "closing") closingSlide(slide, s, meta, mush, key);
        else if (s.kind === "toc") tocSlide(slide, s, accent);
        else contentSlide(slide, s, accent, key, mush);

        // 우측 하단 푸터 제거 (사용자 요청)
      });

      pptx.writeFile({ fileName: (meta["주제"] || "슬라이드") + ".pptx" }).then(function () { btn.textContent = old; });
    }).catch(function (e) { console.error(e); alert("PPTX 내보내기 실패: " + e); btn.textContent = old; });
  }
  function pad2(n) { var s = String(n).replace(/[^0-9]/g, ""); return s.length < 2 ? "0" + s : s; }

  function coverSlide(slide, s, meta, mush, key) {
    var titleItem = s.lines.find(function (l) { return tagOf(l.text).tag === "title"; });
    var subItem = s.lines.find(function (l) { return tagOf(l.text).tag === "subtitle"; });
    var title = titleItem ? tagOf(titleItem.text).text : (meta["주제"] || s.title);
    var sub = subItem ? tagOf(subItem.text).text : (meta["부제"] || "");
    slide.addText("🍄 " + (meta["교과목"] || "메이플스토리 월드 코딩 교실"), { x: X(110), y: Y(300), w: X(1000), h: Y(60), fontSize: 13, color: C.mush, bold: true });
    slide.addText(title, { x: X(110), y: Y(360), w: X(1050), h: Y(320), fontSize: PT(110), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });
    if (sub) slide.addText(sub, { x: X(110), y: Y(690), w: X(1050), h: Y(80), fontSize: PT(38), color: C.soft });
    var img = slotSrc(key + "-mush-cover");
    if (img) slide.addImage({ data: img.indexOf("data:") === 0 ? img : undefined, path: img.indexOf("data:") === 0 ? undefined : img, x: X(1230), y: Y(240), w: X(560), h: X(560), rounding: true });
  }

  function closingSlide(slide, s, meta, mush, key) {
    var bigItem = s.lines.find(function (l) { var t = tagOf(l.text).tag; return t === "big" || t === "title"; });
    var big = bigItem ? tagOf(bigItem.text).text : (s.key || s.title);
    var img = slotSrc(key + "-mush-closing") || mush;
    slide.addImage({ data: img.indexOf("data:") === 0 ? img : undefined, path: img.indexOf("data:") === 0 ? undefined : img, x: X(130), y: Y(240), w: X(560), h: X(560), rounding: true });
    slide.addText("🍄 " + s.title, { x: X(760), y: Y(360), w: X(1000), h: Y(60), fontSize: 13, color: C.mush, bold: true });
    slide.addText(big, { x: X(760), y: Y(420), w: X(1030), h: Y(260), fontSize: PT(64), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });
  }

  function tocSlide(slide, s, accent) {
    var heading = "", items = [];
    s.lines.forEach(function (l) {
      var t = tagOf(l.text).text;
      if (/^\s*\d+[.)]/.test(t)) items.push(t.replace(/^\s*\d+[.)]\s*/, ""));
      else if (!items.length && !heading) heading = t;
      else if (items.length) items.push(t);
    });
    slide.addText(heading || "오늘의 여정", { x: X(110), y: Y(150), w: X(1400), h: Y(90), fontSize: PT(60), fontFace: "Jua", color: C.ink, bold: true });
    var cols = 2, cw = 820, ch = 120, gx = 40, gy = 26, x0 = 110, y0 = 320;
    items.slice(0, 8).forEach(function (it, i) {
      var cx = x0 + (i % cols) * (cw + gx), cy = y0 + Math.floor(i / cols) * (ch + gy);
      var c = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(cx), y: Y(cy), w: X(cw), h: Y(ch), fill: { color: C.paper }, line: { color: "FFFFFF" }, rectRadius: 0.12 });
      slide.addText(String(i + 1), { x: X(cx + 22), y: Y(cy + 22), w: X(76), h: Y(76), fill: { color: c }, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Jua", fontSize: PT(48), rectRadius: 0.1 });
      slide.addText(it, { x: X(cx + 120), y: Y(cy), w: X(cw - 140), h: Y(ch), valign: "middle", fontSize: PT(30), color: C.ink, bold: true });
    });
  }

  /* ---------- 내용 레이아웃별 본문 렌더러 (화면 렌더와 동일한 판별·순서) ---------- */
  function keybarShape(slide, s, accent, bw) {
    if (!s.key) return;
    slide.addShape("roundRect", { x: X(110), y: Y(880), w: X(bw), h: Y(96), fill: { color: accent }, rectRadius: 0.14 });
    slide.addText([{ text: "핵심 ", options: { fontFace: "Jua", color: "FFFFFF" } }, { text: s.key, options: { color: "FFFFFF", bold: true } }], { x: X(140), y: Y(880), w: X(bw - 60), h: Y(96), valign: "middle", fontSize: PT(28) });
  }
  function imageBlock(slide, s, key) {
    if (!s.visual) return;
    var img = slotSrc(key + "-img-" + s.num);
    if (img) slide.addImage({ data: img, x: X(1180), y: Y(330), w: X(610), h: Y(500) });
    else {
      slide.addShape("roundRect", { x: X(1180), y: Y(330), w: X(610), h: Y(500), fill: { color: THEME.phFill }, line: { color: THEME.phLine, width: 3 }, rectRadius: 0.1 });
      slide.addText("🖼  " + (s.visual || "이미지"), { x: X(1210), y: Y(380), w: X(550), h: Y(400), align: "center", valign: "middle", fontSize: PT(26), color: THEME.phText });
    }
  }
  function statementBody(slide, s, st) {
    slide.addText(st.big, { x: X(160), y: Y(360), w: X(1600), h: Y(320), align: "center", valign: "middle", fontSize: PT(72), fontFace: "Jua", color: C.ink, bold: true });
    var lead = (st.rest || []).join(" ") || s.key || "";
    if (lead) slide.addText(lead, { x: X(260), y: Y(700), w: X(1400), h: Y(90), align: "center", fontSize: PT(30), color: C.soft });
  }
  function compareBody(slide, s, groups, H) {
    var n = Math.min(4, groups.length);
    var gap = 36, x0 = 110, w = (1700 - gap * (n - 1)) / n, y0 = 330, h = s.key ? 460 : 510;
    groups.slice(0, n).forEach(function (g, i) {
      var cx = x0 + i * (w + gap);
      var col = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(cx), y: Y(y0), w: X(w), h: Y(h), fill: { color: C.paper }, line: { color: THEME.phLine, width: 1 }, rectRadius: 0.06 });
      slide.addShape("rect", { x: X(cx + 10), y: Y(y0), w: X(w - 20), h: Y(12), fill: { color: col } });
      slide.addText(g.label, { x: X(cx + 30), y: Y(y0 + 34), w: X(w - 60), h: Y(74), fontSize: PT(38), fontFace: "Jua", color: col, bold: true });
      var items = (H.splitItems ? H.splitItems(g.body) : [g.body]).filter(Boolean);
      var runs = items.map(function (t) { return { text: t, options: { bullet: { code: "2022", indent: 12 }, fontSize: PT(26), color: C.ink, paraSpaceAfter: 8 } }; });
      if (runs.length) slide.addText(runs, { x: X(cx + 30), y: Y(y0 + 120), w: X(w - 60), h: Y(h - 150), valign: "top" });
    });
    var foot = H.footOf ? H.footOf(s.lines) : "";
    if (foot && !s.key) slide.addText(foot, { x: X(260), y: Y(880), w: X(1400), h: Y(70), align: "center", fontSize: PT(26), color: C.soft });
  }
  function cardsBody(slide, s, cards) {
    var n = Math.min(4, cards.length);
    var gap = 36, x0 = 110, w = (1700 - gap * (n - 1)) / n, y0 = 350, h = s.key ? 430 : 480;
    cards.slice(0, n).forEach(function (cdef, i) {
      var cx = x0 + i * (w + gap);
      var col = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(cx), y: Y(y0), w: X(w), h: Y(h), fill: { color: C.paper }, line: { color: THEME.phLine, width: 1 }, rectRadius: 0.06 });
      slide.addText(String(i + 1), { x: X(cx + w / 2 - 38), y: Y(y0 + 36), w: X(76), h: Y(76), fill: { color: col }, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Jua", fontSize: PT(40) });
      slide.addText(cdef.t, { x: X(cx + 24), y: Y(y0 + 130), w: X(w - 48), h: Y(100), align: "center", fontSize: PT(30), color: C.ink, bold: true });
      if (cdef.b && cdef.b.length) slide.addText(cdef.b.join(" "), { x: X(cx + 24), y: Y(y0 + 240), w: X(w - 48), h: Y(h - 260), align: "center", fontSize: PT(24), color: C.soft });
    });
  }
  function stepsBody(slide, s, steps, accent, bw) {
    var n = Math.min(6, steps.length);
    var gap = 16, areaH = 520, rh = Math.min(90, (areaH - gap * (n - 1)) / n), y = 330;
    steps.slice(0, n).forEach(function (t, i) {
      var col = C[POINTS[i % 4]];
      slide.addShape("roundRect", { x: X(110), y: Y(y), w: X(bw), h: Y(rh), fill: { color: C.paper }, line: { color: accent, width: 1.5 }, rectRadius: 0.12 });
      slide.addText(String(i + 1), { x: X(132), y: Y(y + (rh - 56) / 2), w: X(56), h: Y(56), fill: { color: col }, color: "FFFFFF", align: "center", valign: "middle", fontFace: "Jua", fontSize: PT(30) });
      slide.addText(t, { x: X(210), y: Y(y), w: X(bw - 120), h: Y(rh), valign: "middle", fontSize: PT(27), color: C.ink, bold: true });
      y += rh + gap;
    });
  }

  function contentSlide(slide, s, accent, key, mush) {
    var isAct = s.kind === "activity";
    var title = isAct ? s.title.replace(/^\[?활동\]?\s*[:：]?\s*/, "") : s.title;
    var H = window.KBuilder.deckHeuristics || {};

    // 문구(statement) 레이아웃은 화면처럼 큰 제목 없이 작은 키커 + 중앙 큰 문구만 그린다
    var st = !isAct && H.statementInfo ? H.statementInfo(s.lines) : null;
    if (st && s.lines.length <= 3) {
      slide.addText(title, { x: X(260), y: Y(240), w: X(1400), h: Y(60), align: "center", fontSize: PT(26), color: accent, bold: true });
      statementBody(slide, s, st);
      return;
    }

    // 아이브로 + 제목 (문구 외 모든 내용 레이아웃 공통)
    slide.addText((isAct ? "활동 · " : "") + pad2(s.num), { x: X(110), y: Y(96), w: X(400), h: Y(54), fontSize: PT(24), color: C.soft, bold: true });
    slide.addText(title, { x: X(110), y: Y(150), w: X(1500), h: Y(150), fontSize: PT(60), fontFace: "Jua", color: C.ink, bold: true, valign: "top" });

    var hasVisual = !!s.visual;
    var bw = hasVisual ? 980 : 1700;

    // 화면 렌더(renderSlide)와 같은 우선순위: 비교 → 카드 → 단계 → 불릿
    if (!isAct) {
      var groups = H.labeledGroups ? H.labeledGroups(s.lines) : null;
      if (groups) { compareBody(slide, s, groups, H); keybarShape(slide, s, accent, 1700); return; }
      var cards = H.collectCards ? H.collectCards(s.lines) : null;
      if (cards) { cardsBody(slide, s, cards); keybarShape(slide, s, accent, 1700); return; }
      var steps = H.stepSequence ? H.stepSequence(s.lines) : null;
      if (steps) { stepsBody(slide, s, steps, accent, bw); imageBlock(slide, s, key); keybarShape(slide, s, accent, bw); return; }
    }

    // 기본: 불릿 + 이미지
    var lines = bodyLines(s);
    var textRuns = lines.map(function (l) {
      return { text: l.text, options: { bullet: l.tag ? false : { code: "2022", indent: 14 }, indentLevel: l.indent, fontSize: l.tag === "big" ? PT(40) : PT(30), color: l.indent ? C.soft : C.ink, bold: l.tag === "big", paraSpaceAfter: 10 } };
    });
    if (textRuns.length) slide.addText(textRuns, { x: X(110), y: Y(330), w: X(bw), h: Y(520), valign: "top" });
    imageBlock(slide, s, key);
    keybarShape(slide, s, accent, bw);
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.exportHTML = exportHTML;
  window.KBuilder.exportPPTX = exportPPTX;
  window.KBuilder.standaloneDoc = standaloneDoc; // 순수 조립 함수 (테스트/QA용)
})();
