/* auto-images.js — 생성한 슬라이드 편성안의 '이미지/시각' 제안으로 이미지를 자동으로 만들어 붙인다
 *   - 내용 슬라이드(표지·목차·마무리 제외) 가운데 시각 제안이 있는 슬라이드를 고르게 골라 부(차시)마다 최대 N장
 *   - 만든 이미지는 참고 이미지(교수안 말미 갤러리 · 슬롯에서 고르기)에 넣고,
 *     편성안의 '이미지/시각' 줄에 [이미지:id] 표시를 달아 빌드할 때 그 슬라이드 칸에 채운다
 *   - Google 키(Gemini 이미지 모델)가 있을 때만 동작한다 — 없으면 건너뛴다
 *   - 같은 프롬프트는 이 창에서 다시 만들지 않는다(다시 빌드해도 같은 이미지)
 *   window.KBuilder.autoImages = { OPTIONS, count, setCount, available, run, resolveVisual, tagDeck, pick }
 *   window.KBuilder.resolveVisual(visual) → {text, src}  (슬라이드 렌더러·PPTX 내보내기가 사용) */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var KEY = "kb-auto-img";
  var OPTIONS = [["0", "끔"], ["2", "부마다 2장"], ["4", "부마다 4장"], ["8", "부마다 8장"]];
  var DEFAULT = 4;
  var MAX_SIDE = 1280;
  var REF_ROOM = 16; // 참고 이미지 칸(최대 24) 가운데 자동 이미지는 16장까지 — 나머지는 직접 올리는 자리
  var store = Object.create(null), memo = Object.create(null), seq = 0;
  var VISUAL_LINE = /^(\s*[-*]?\s*(?:이미지\s*[\/·]\s*시각|이미지)\s*[:：].*?)\s*$/;

  function count() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return v == null ? DEFAULT : Math.max(0, parseInt(v, 10) || 0);
  }
  function setCount(n) {
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
    // 화면 곳곳의 같은 설정 칸을 함께 맞춘다 (원고로 생성 · 과정 설계 산출물)
    if (typeof document !== "undefined" && document.querySelectorAll) {
      document.querySelectorAll("select[data-auto-img]").forEach(function (sel) { sel.value = String(n); });
    }
  }
  function available() {
    return typeof K.genImage === "function" && !!(K.AI && (K.AI.imageEndpoint || (typeof K.AI.hasKey === "function" && K.AI.hasKey())));
  }

  /* 시각 제안 문자열에서 [이미지:id] · ![](주소) 를 떼어 이미지 주소와 설명으로 나눈다 */
  function resolveVisual(visual) {
    var src = "";
    var text = String(visual || "").replace(/\s*\[이미지:([^\]\s]+)\]/g, function (m, id) {
      if (!src && store[id]) src = store[id];
      return "";
    }).replace(/\s*!\[[^\]]*\]\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/g, function (m, url) {
      if (!src) src = url;
      return "";
    });
    return { text: text.trim(), src: src };
  }

  /* 시각 제안이 있는 내용 슬라이드를 고르게 n장 — [{i, s}] (i = 편성안의 슬라이드 순번) */
  function pick(slides, n) {
    var cands = [];
    (slides || []).forEach(function (s, i) {
      if (!s.visual || /^(cover|toc|closing)$/.test(s.kind)) return;
      if (K.slideShowsImage && !K.slideShowsImage(s)) return; // 비교·카드·한 문장 레이아웃은 이미지 칸이 없다
      if (/\[이미지:[^\]\s]+\]|!\[[^\]]*\]\(/.test(s.visual)) return; // 이미 이미지가 있음
      cands.push({ i: i, s: s });
    });
    if (cands.length <= n) return cands;
    var out = [];
    for (var k = 0; k < n; k++) out.push(cands[Math.min(cands.length - 1, Math.floor((k + 0.5) * cands.length / n))]);
    return out;
  }

  /* 편성안의 i번째 슬라이드(### 머리글 순번) '이미지/시각' 줄 끝에 [이미지:id] 를 단다 */
  function tagDeck(deckMd, tags) {
    var byIdx = {};
    tags.forEach(function (t) { byIdx[t.slide] = t.id; });
    var lines = String(deckMd || "").split("\n"), slide = -1, done = {};
    return lines.map(function (line) {
      if (/^###\s+/.test(line)) { slide++; return line; }
      var id = byIdx[slide];
      if (id && !done[slide] && VISUAL_LINE.test(line)) { done[slide] = 1; return line.replace(VISUAL_LINE, "$1 [이미지:" + id + "]"); }
      return line;
    }).join("\n");
  }

  /* 큰 이미지는 줄여 메모리·내보내기 용량을 아낀다 */
  function shrink(url) {
    return new Promise(function (res) {
      if (typeof Image === "undefined" || typeof document === "undefined") { res(url); return; }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
        if (r >= 1 && url.length < 700000) { res(url); return; }
        try {
          var c = document.createElement("canvas");
          c.width = Math.round(w * r); c.height = Math.round(h * r);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL("image/webp", 0.86));
        } catch (e) { res(url); }
      };
      img.onerror = function () { res(url); };
      img.src = url;
    });
  }

  /* 만들 이미지 목록 — [{part, slide, title, prompt}] */
  function planJobs(list, n) {
    var jobs = [];
    list.forEach(function (p, pi) {
      if (!p || !p.deckMd || !K.parseDeck) return;
      var parsed = K.parseDeck(p.deckMd);
      var subject = (parsed.meta && parsed.meta["주제"]) || p.title || "";
      pick(parsed.slides, n).forEach(function (c) {
        var prompt = K.recommendImagePrompt
          ? K.recommendImagePrompt({ visual: resolveVisual(c.s.visual).text, title: c.s.title, subject: subject })
          : resolveVisual(c.s.visual).text;
        jobs.push({ part: pi, slide: c.i, title: c.s.title, prompt: prompt });
      });
    });
    return jobs;
  }
  /* 새로 만들어야 하는 이미지 수 (이 창에서 이미 만든 프롬프트는 빼고) — 많으면 먼저 묻는 데 쓴다 */
  function countJobs(parts) {
    var n = count();
    if (!n || !available()) return 0;
    return planJobs((parts || []).slice(), n).filter(function (j) { return !memo[j.prompt]; }).length;
  }

  /* parts = [{label, title, docMd, deckMd, …}] → 새 목록(편성안에 이미지 표시) + 결과 개수
     onProg(done, total, label) · cancelled() 가 true 면 새 이미지를 더 시작하지 않고(만들던 것까지 넣고) 끝낸다
     discard() 가 true 면(생성 자체를 취소) 늦게 도착한 이미지도 넣지 않는다 */
  function run(parts, onProg, cancelled, discard) {
    var n = count();
    var list = (parts || []).slice();
    if (!n) return Promise.resolve({ parts: list, made: 0, failed: 0, total: 0, skipped: "off" });
    if (!available()) return Promise.resolve({ parts: list, made: 0, failed: 0, total: 0, skipped: "nokey" });
    var prog = typeof onProg === "function" ? onProg : function () {};
    var isCancelled = function () { return !!(cancelled && cancelled()); };
    var jobs = planJobs(list, n);
    var made = 0, failed = 0, inRow = 0, stop = false, chain = Promise.resolve();
    jobs.forEach(function (j, k) {
      chain = chain.then(function () {
        if (stop || isCancelled()) return;
        prog(k, jobs.length, "🖼 이미지 자동 생성 중… (" + (k + 1) + "/" + jobs.length + ") " + j.title);
        var hit = memo[j.prompt];
        return (hit ? Promise.resolve(hit) : K.genImage(j.prompt).then(shrink)).then(function (url) {
          if (discard && discard()) return; // 생성을 취소한 뒤 늦게 도착한 이미지는 넣지 않는다
          memo[j.prompt] = url;
          j.id = "ai" + Date.now().toString(36) + (seq++);
          store[j.id] = url;
          made++; inRow = 0;
          if (!hit && K.refImagesAddUrl && (K.refImages || []).length < REF_ROOM) K.refImagesAddUrl(url, j.title);
        }).catch(function () {
          failed++; inRow++;
          if (inRow >= 2) stop = true; // 키·권한·할당량 문제로 연달아 실패하면 남은 이미지는 건너뛴다
        });
      });
    });
    return chain.then(function () {
      var out = list.map(function (p, pi) {
        var mine = jobs.filter(function (j) { return j.part === pi && j.id; });
        return mine.length ? Object.assign({}, p, { deckMd: tagDeck(p.deckMd, mine) }) : p;
      });
      prog(jobs.length, jobs.length, "이미지 " + made + "장 완료");
      return { parts: out, made: made, failed: failed, total: jobs.length, stopped: stop, cancelled: isCancelled() };
    });
  }

  function summary(r) {
    if (!r || r.skipped === "off") return "";
    if (r.skipped === "nokey") return "이미지 자동 생성은 Google API 키가 있어야 합니다 — 키를 저장하면 슬라이드 이미지와 참고 이미지가 함께 만들어집니다.";
    if (!r.total) return "";
    var tail = (r.cancelled ? " 남은 이미지는 건너뛰었습니다." : r.stopped ? " 연달아 실패해 남은 이미지는 건너뛰었습니다 — 키·할당량을 확인하세요." : "");
    if (!r.made) return "🖼 이미지를 만들지 못했습니다" + (r.failed ? " (실패 " + r.failed + "장)" : "") + "." + tail;
    return "🖼 이미지 " + r.made + "장을 자동으로 만들어 참고 이미지와 슬라이드 칸에 넣었습니다" + (r.failed ? " (실패 " + r.failed + "장)" : "") + "." + tail;
  }

  /* [이미지:id] 표시를 실제 그림(![](data:…))으로 — 내려받은 MD 를 나중에 다시 올려도 그림이 남는다. 모르는 표시는 지운다 */
  function expandTags(md) {
    return String(md || "").replace(/\s*\[이미지:([^\]\s]+)\]/g, function (m, id) {
      return store[id] ? " ![이미지](" + store[id] + ")" : "";
    });
  }

  /* 설정 선택칸 — <select data-auto-img> 마다 같은 값을 쓴다 */
  function wireSelects(rootEl) {
    (rootEl || document).querySelectorAll("select[data-auto-img]").forEach(function (sel) {
      if (sel.dataset.wired) { sel.value = String(count()); return; }
      sel.dataset.wired = "1";
      sel.innerHTML = OPTIONS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("");
      sel.value = String(OPTIONS.some(function (o) { return o[0] === String(count()); }) ? count() : DEFAULT);
      sel.addEventListener("change", function () { setCount(sel.value); });
    });
  }

  K.resolveVisual = resolveVisual;
  K.autoImages = { OPTIONS: OPTIONS, count: count, setCount: setCount, available: available, run: run, summary: summary, countJobs: countJobs,
    resolveVisual: resolveVisual, tagDeck: tagDeck, pick: pick, wireSelects: wireSelects, expandTags: expandTags };
  if (typeof document !== "undefined" && document.querySelectorAll) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { wireSelects(); });
    else wireSelects();
  }
})();
