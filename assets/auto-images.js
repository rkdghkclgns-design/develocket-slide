/* auto-images.js — 이미지를 내용에 맞게 자동으로 만들어 슬라이드와 MD 본문에 넣는다
 *   - 내용 슬라이드(표지·목차·학습목표·체크리스트·마무리 제외) 가운데 이미지 칸이 있는 슬라이드를 고르게 골라 부(차시)마다 최대 N장
 *   - 프롬프트는 슬라이드 제목·문구(핵심 내용)·구체적인 시각 제안으로 만든다 — '관련 이미지'처럼 막연한 제안은 내용으로 대신한다
 *   - 교안 본문 이미지(part.images, lesson-images.js)와 내용이 맞는 슬라이드는 새로 만들지 않고 그 이미지를 쓴다
 *   - 넣는 곳: 편성안 '이미지/시각' 줄 끝 [이미지:id] · 교수안은 대응 단계 제목 아래 · 교안은 내용이 맞는 소제목 아래 [이미지:id] 줄
 *   - 만든 이미지는 이 브라우저(IndexedDB)에 보관 — 다시 열어도 같은 그림, 같은 프롬프트는 다시 만들지 않는다
 *   - Google 키(Gemini 이미지 모델)가 있을 때만 동작한다 — 없으면 건너뛴다
 *   window.KBuilder.autoImages = { OPTIONS, count, setCount, available, run, resolveVisual, tagDeck, pick, expandTags, genOne, put, remove, ready, … }
 *   window.KBuilder.resolveVisual(visual) → {text, src}  (슬라이드 렌더러·PPTX 내보내기가 사용) */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var KEY = "kb-auto-img";
  var OPTIONS = [["0", "끔"], ["2", "부마다 2장"], ["4", "부마다 4장"], ["8", "부마다 8장"]];
  var DEFAULT = 4;
  var MAX_SIDE = 1280;
  var REF_ROOM = 16; // 참고 이미지 칸(최대 24) 가운데 자동 이미지는 16장까지 — 나머지는 직접 올리는 자리
  var KEEP = 400;    // 보관 개수 — 넘으면 교안에 넣지 않은(고정 안 한) 오래된 이미지부터 지운다
  var MATCH = 0.34;  // 슬라이드 ↔ 교안 이미지 · 소제목이 '같은 내용'으로 볼 유사도
  var store = Object.create(null), alts = Object.create(null), memo = Object.create(null), meta = Object.create(null), seq = 0;
  var VISUAL_LINE = /^(\s*[-*]?\s*(?:이미지\s*[\/·]\s*시각|이미지)\s*[:：].*?)\s*$/;
  /* 내용을 알려 주지 않는 시각 제안 — 프롬프트는 슬라이드 내용으로 만든다 */
  var GENERIC = /^(?:-|없음|이미지|관련\s*(?:이미지|그림)|체크리스트|목표\s*체크\s*아이콘|단계를\s*잇는\s*흐름\s*그래픽|다음\s*단계로\s*나아가는\s*장면|\(.*\)|.*(?:상징하는|어울리는)\s*(?:대표\s*)?(?:일러스트|이미지|그림))$/;
  /* 꾸밈용 슬라이드(학습목표·체크리스트·흐름) — 내용 그림을 넣을 자리가 아니다 */
  var DECOR_TITLE = /^(?:학습\s*목표|체크\s*리스트|목차|차례|(?:이번\s*)?차시\s*흐름|오늘의\s*학습)/;
  var DECOR_VISUAL = /^(?:목표\s*체크\s*아이콘|체크리스트|단계를\s*잇는\s*흐름\s*그래픽)$/;

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
  function enabled() { return count() > 0 && available(); }

  /* ---------- 보관소 (IndexedDB) — 없거나 막혀 있으면 이 창에서만 기억한다 ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (typeof indexedDB === "undefined") { rej(new Error("IndexedDB 없음")); return; }
      var rq = indexedDB.open("kb-images", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("img", { keyPath: "id" }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    dbp.catch(function () {});
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("img", mode), rq = fn(t.objectStore("img"));
        t.oncomplete = function () { res(rq && rq.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function remember(rec) {
    store[rec.id] = rec.url;
    alts[rec.id] = rec.title || "";
    meta[rec.id] = { at: rec.at || 0, pin: !!rec.pin, fixed: !!rec.fixed };
    if (rec.prompt) memo[rec.prompt] = rec.id;
  }
  function forget(id) {
    delete store[id]; delete alts[id]; delete meta[id];
    Object.keys(memo).forEach(function (p) { if (memo[p] === id) delete memo[p]; });
  }
  var ready = tx("readonly", function (os) { return os.getAll(); }).then(function (list) {
    (list || []).forEach(function (r) { if (r && r.id && r.url && !store[r.id]) remember(r); });
    // 예전 그림의 검은 띠는 화면을 다 그린 뒤 천천히 잘라 둔다
    setTimeout(function () { fixStored().catch(function () {}); }, 1500);
  }).catch(function () {});
  /* 보관하지 못하면(저장 공간 부족·사생활 보호 창) 한 번 알린다 — 이 창에서는 보이지만 다시 열면 사라질 수 있다 */
  var warned = false;
  function storeFailed(e) {
    if (warned) return;
    warned = true;
    if (typeof console !== "undefined") console.warn("이미지를 IndexedDB 에 보관하지 못했습니다: " + ((e && e.message) || e));
    if (typeof document !== "undefined" && document.dispatchEvent && typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent("kb-images-store-fail"));
  }
  var held = Object.create(null); // 지금 생성 중인 작업(run)이 쓰는 그림 — 끝날 때까지 정리하지 않는다
  /* 교안에 넣지 않은(고정 안 한) 그림이 KEEP 장을 넘으면 오래된 것부터 지운다 — 방금 만든 그림·작업 중인 그림은 빼고 */
  function prune(justMade) {
    var loose = Object.keys(meta).filter(function (id) { return !meta[id].pin; });
    var over = loose.length - KEEP;
    if (over <= 0) return;
    loose.filter(function (id) { return id !== justMade && !held[id]; }).sort(function (a, b) { return meta[a].at - meta[b].at; })
      .slice(0, over).forEach(remove);
  }
  /* 그림 하나를 보관하고 id 를 돌려준다 (pin = 교안 본문에 넣은 그림 → 자동 정리에서 빼기) */
  function put(url, title, prompt, pin) {
    var rec = { id: "ai" + Date.now().toString(36) + (seq++), url: url, title: String(title || "").slice(0, 80), prompt: prompt || "", at: Date.now(), pin: !!pin, fixed: 1 };
    remember(rec);
    tx("readwrite", function (os) { return os.put(rec); }).catch(storeFailed);
    prune(rec.id);
    return rec.id;
  }
  function remove(id) {
    if (!id) return;
    forget(id);
    tx("readwrite", function (os) { return os.delete(id); }).catch(function () {});
  }
  function has(id) { return !!store[id]; }
  /* 교안에 고정한 그림 가운데 keep(지금 과정이 쓰는 id 목록)에 없는 것을 지운다 — 블록·과정을 영구 삭제했을 때 */
  function releasePinned(keep) {
    var used = Object.create(null);
    (keep || []).forEach(function (id) { used[id] = 1; });
    Object.keys(meta).forEach(function (id) { if (meta[id].pin && !used[id] && !held[id]) remove(id); });
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

  /* ---------- 내용 비교 (글자 두 개씩 묶어 겹치는 비율) ---------- */
  function grams(s) {
    var t = String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""), g = Object.create(null), n = 0;
    for (var i = 0; i < t.length - 1; i++) { var k = t.substr(i, 2); if (!g[k]) { g[k] = 1; n++; } }
    return { g: g, n: n };
  }
  function sim(a, b) {
    var A = grams(a), B = grams(b), c = 0;
    if (!A.n || !B.n) return 0;
    for (var k in A.g) if (B.g[k]) c++;
    return 2 * c / (A.n + B.n);
  }
  /* 슬라이드 문구에서 내용 줄만 — (제목)·(5분) 같은 표시는 뺀다 */
  function pointsOf(s) {
    var out = (s.lines || []).map(function (l) { return String(l.text || l).replace(/^\((?:제목|부제|하단|큰 문구)\)\s*/, "").trim(); })
      .filter(function (t) { return t && !/^\(\s*\d+\s*분\s*\)$/.test(t); });
    if (s.key) out.push(s.key);
    return out.slice(0, 5);
  }

  /* 내용 그림이 들어갈 슬라이드를 고르게 n장 — [{i, s}] (i = 편성안의 슬라이드 순번) */
  function pick(slides, n) {
    var cands = [];
    (slides || []).forEach(function (s, i) {
      if (!s.visual || /^(cover|toc|closing)$/.test(s.kind)) return;
      if (DECOR_TITLE.test(String(s.title || "").trim()) || DECOR_VISUAL.test(resolveVisual(s.visual).text)) return; // 학습목표·체크리스트·흐름
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

  /* ---------- MD 본문에 넣기 — 제목 바로 아래 [이미지:id] 줄 (코드 블록 안은 건드리지 않음) ---------- */
  /* 줄마다 코드 블록(``` · ~~~) 안인지 — 울타리 줄 자신도 안으로 본다. 코드의 # 주석을 제목으로 보지 않게 */
  function fenced(lines) {
    var inside = false;
    return lines.map(function (l) {
      if (/^\s*(```|~~~)/.test(l)) { inside = !inside; return true; }
      return inside;
    });
  }
  function insertBelow(lines, at, id) {
    var add = ["", "[이미지:" + id + "]"];
    if (lines[at + 1] != null && String(lines[at + 1]).trim()) add.push("");
    Array.prototype.splice.apply(lines, [at + 1, 0].concat(add));
  }
  function hasImageBelow(lines, at) {
    for (var i = at + 1, seen = 0; i < lines.length && seen < 2; i++) {
      var t = String(lines[i]).trim();
      if (!t) continue;
      if (/^\[이미지:[^\]\s]+\]$|^!\[[^\]]*\]\(/.test(t)) return true;
      seen++;
    }
    return false;
  }
  function headingBlock(lines, at, fz) {
    var out = [lines[at].replace(/^#+\s*/, "")];
    for (var i = at + 1; i < lines.length && !(/^#{1,6}\s/.test(lines[i]) && !fz[i]); i++) out.push(lines[i]);
    return out.join(" ");
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  /* 슬라이드 내용과 가장 비슷한 제목 줄 번호 (코드 블록 안·이미 그림이 있는 제목은 건너뜀) — 없으면 -1 */
  function bestHeading(lines, j, levels) {
    var best = -1, score = 0, fz = fenced(lines);
    lines.forEach(function (l, i) {
      if (fz[i] || !levels.test(l) || hasImageBelow(lines, i)) return;
      var sc = Math.max(sim(j.title, l.replace(/^#+\s*/, "")), sim(j.title + " " + j.text, headingBlock(lines, i, fz)));
      if (sc > score) { score = sc; best = i; }
    });
    return score >= MATCH ? best : -1;
  }
  /* 교수안 — 내용이 같은 진행 단계 제목 아래, 없으면 슬라이드의 '대응 교수안'이 전개 단계(전개 2 …)일 때 그 제목 아래
     (도입·정리 단계에는 내용 그림을 억지로 넣지 않는다) */
  function placeDoc(md, items) {
    if (!md) return md;
    var lines = String(md).split("\n");
    items.forEach(function (j) {
      if (!j.id || lines.join("\n").indexOf("[이미지:" + j.id + "]") !== -1) return;
      var at = bestHeading(lines, j, /^#{3,4}\s/), label = String(j.maps || "").trim();
      if (at === -1 && /^전개\s*\d/.test(label)) {
        var re = new RegExp("^#{2,4}\\s+" + escRe(label) + "(?![0-9])"), fz = fenced(lines);
        for (var i = 0; i < lines.length; i++) if (!fz[i] && re.test(lines[i])) { if (!hasImageBelow(lines, i)) at = i; break; }
      }
      if (at !== -1) insertBelow(lines, at, j.id);
    });
    return lines.join("\n");
  }
  /* 교안 — 슬라이드 내용과 가장 비슷한 소제목(##·#) 아래 (이미 그림이 있는 소제목은 건너뜀) */
  function placeText(md, items) {
    if (!md) return md;
    var lines = String(md).split("\n");
    items.forEach(function (j) {
      if (!j.id || lines.join("\n").indexOf("[이미지:" + j.id + "]") !== -1) return;
      var at = bestHeading(lines, j, /^#{1,3}\s/);
      if (at !== -1) insertBelow(lines, at, j.id);
    });
    return lines.join("\n");
  }

  /* 가장자리의 검은(또는 투명한) 띠 — 이미지 모델이 정사각 캔버스에 넓은 그림을 넣고 남긴 레터박스.
     줄·칸 전체(97%)가 거의 검정인 가장자리만 띠로 보고, 남는 그림이 가로·세로 절반 이상일 때만 자른다(어두운 장면은 그대로).
     → 원본 좌표 {x, y, w, h} 또는 null */
  function darkBorders(img) {
    var W = img.naturalWidth, H = img.naturalHeight;
    if (!W || !H) return null;
    var s = Math.min(1, 240 / Math.max(W, H)), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data;
    var dark = function (x, y) { var i = (y * w + x) * 4; return d[i + 3] < 16 || Math.max(d[i], d[i + 1], d[i + 2]) < 28; };
    var rowDark = function (y) { var n = 0; for (var x = 0; x < w; x++) if (dark(x, y)) n++; return n >= w * 0.97; };
    var colDark = function (x, y0, y1) { var n = 0; for (var y = y0; y < y1; y++) if (dark(x, y)) n++; return n >= (y1 - y0) * 0.97; };
    var top = 0, bot = h, left = 0, right = w;
    while (top < h && rowDark(top)) top++;
    while (bot > top && rowDark(bot - 1)) bot--;
    while (left < w && colDark(left, top, bot)) left++;
    while (right > left && colDark(right - 1, top, bot)) right--;
    if (Math.max(top, h - bot, left, w - right) < 3) return null; // 띠 없음 (가장자리 한두 줄은 무시)
    if (bot - top < h * 0.5 || right - left < w * 0.5) return null;
    // 경계의 흐린 줄까지 한 칸 더 안쪽에서 자른다
    if (top) top++; if (bot < h) bot--; if (left) left++; if (right < w) right--;
    return { x: left / s, y: top / s, w: (right - left) / s, h: (bot - top) / s };
  }
  /* 큰 이미지는 줄여 메모리·내보내기 용량을 아끼고, 검은 띠는 잘라낸다 */
  function shrink(url) {
    return new Promise(function (res) {
      if (typeof Image === "undefined" || typeof document === "undefined") { res(url); return; }
      var img = new Image();
      img.onload = function () {
        var crop = null;
        try { crop = darkBorders(img); } catch (e) { crop = null; }
        var sx = crop ? crop.x : 0, sy = crop ? crop.y : 0;
        var w = crop ? crop.w : img.naturalWidth, h = crop ? crop.h : img.naturalHeight, r = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
        if (!crop && r >= 1 && url.length < 700000) { res(url); return; }
        try {
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
          c.getContext("2d").drawImage(img, sx, sy, w, h, 0, 0, c.width, c.height);
          res(c.toDataURL("image/webp", 0.86));
        } catch (e) { res(url); }
      };
      img.onerror = function () { res(url); };
      img.src = url;
    });
  }
  /* 예전에 보관한 그림의 검은 띠를 한 번 잘라 둔다 (fixed 표시 — 그림마다 한 번) */
  function fixStored() {
    if (typeof Image === "undefined" || typeof document === "undefined") return Promise.resolve(0);
    var ids = Object.keys(meta).filter(function (id) { return !meta[id].fixed; }), n = 0, chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var url = store[id];
        if (!url) return;
        return shrink(url).then(function (next) {
          if (!store[id] || store[id] !== url) return; // 그사이 지웠거나 바뀜
          meta[id].fixed = true;
          if (next !== url) { store[id] = next; n++; }
          var rec = { id: id, url: store[id], title: alts[id], prompt: "", at: meta[id].at, pin: meta[id].pin, fixed: 1 };
          Object.keys(memo).forEach(function (p) { if (memo[p] === id) rec.prompt = p; });
          return tx("readwrite", function (os) { return os.put(rec); }).catch(function () {});
        });
      });
    });
    return chain.then(function () {
      if (n && typeof document !== "undefined" && document.dispatchEvent && typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent("kb-images-updated"));
      return n;
    });
  }
  /* 프롬프트 하나로 그림 하나 — 같은 프롬프트로 만든 그림이 있으면 그것을 쓴다(fresh 면 새로). → Promise<id> */
  function genOne(prompt, title, pin, fresh) {
    var hit = memo[prompt];
    if (hit && store[hit] && !fresh) {
      if (meta[hit]) meta[hit].at = Date.now(); // 다시 쓴 그림은 최근 것으로 — 정리 순서에서 뒤로
      if (pin && meta[hit] && !meta[hit].pin) {
        meta[hit].pin = true;
        tx("readwrite", function (os) { return os.put({ id: hit, url: store[hit], title: alts[hit], prompt: prompt, at: meta[hit].at, pin: true, fixed: meta[hit].fixed ? 1 : 0 }); }).catch(function () {});
      }
      return Promise.resolve(hit);
    }
    return K.genImage(prompt).then(shrink).then(function (url) { return put(url, title, prompt, pin); });
  }

  /* 교안 이미지 가운데 슬라이드와 내용이 같은 것 (images = [{id, title, text}]) */
  function bestPhoto(images, title, text, used) {
    var best = null, score = 0;
    (images || []).forEach(function (p) {
      if (!p || !p.id || !store[p.id] || used[p.id]) return;
      var sc = Math.max(sim(title, p.title), sim(title + " " + text, p.title + " " + (p.text || "")));
      if (sc > score) { score = sc; best = p.id; }
    });
    return score >= MATCH ? best : null;
  }

  /* 만들(또는 교안 이미지를 쓸) 목록 — [{part, slide, title, maps, text, prompt | id+reuse}] */
  function planJobs(list, n) {
    var jobs = [];
    list.forEach(function (p, pi) {
      if (!p || !p.deckMd || !K.parseDeck) return;
      var parsed = K.parseDeck(p.deckMd);
      var subject = (parsed.meta && parsed.meta["주제"]) || p.title || "";
      var used = {};
      pick(parsed.slides, n).forEach(function (c) {
        var pts = pointsOf(c.s), text = pts.join(" ");
        var base = { part: pi, slide: c.i, title: c.s.title, maps: c.s.maps, text: text };
        var reuse = bestPhoto(p.images, c.s.title, text, used);
        if (reuse) { used[reuse] = 1; jobs.push(Object.assign(base, { id: reuse, reuse: true })); return; }
        var v = resolveVisual(c.s.visual).text;
        var visual = GENERIC.test(v) ? "" : v;
        base.prompt = K.recommendImagePrompt
          ? K.recommendImagePrompt({ visual: visual, title: c.s.title, subject: subject, points: pts })
          : [visual, c.s.title, text].filter(Boolean).join(", ");
        jobs.push(base);
      });
    });
    return jobs;
  }
  /* 새로 만들어야 하는 이미지 수 (이미 만든 프롬프트·교안 이미지로 채우는 슬라이드는 빼고) — 많으면 먼저 묻는 데 쓴다 */
  function countJobs(parts) {
    var n = count();
    if (!n || !available()) return 0;
    return planJobs((parts || []).slice(), n).filter(function (j) { return !j.reuse && !(memo[j.prompt] && store[memo[j.prompt]]); }).length;
  }

  /* parts = [{label, title, docMd, deckMd, textMd?, images?}] → 새 목록(편성안·교수안·교안에 이미지 표시) + 결과 개수
     onProg(done, total, label) · cancelled() 가 true 면 새 이미지를 더 시작하지 않고(만들던 것까지 넣고) 끝낸다
     discard() 가 true 면(생성 자체를 취소) 늦게 도착한 이미지도 넣지 않는다 */
  function run(parts, onProg, cancelled, discard) {
    var n = count();
    var list = (parts || []).slice();
    if (!n) return Promise.resolve({ parts: list, made: 0, reused: 0, failed: 0, total: 0, skipped: "off" });
    if (!available()) return Promise.resolve({ parts: list, made: 0, reused: 0, failed: 0, total: 0, skipped: "nokey" });
    var prog = typeof onProg === "function" ? onProg : function () {};
    var isCancelled = function () { return !!(cancelled && cancelled()); };
    var jobs = planJobs(list, n), gen = jobs.filter(function (j) { return !j.reuse; });
    var made = 0, failed = 0, inRow = 0, stop = false, chain = Promise.resolve(), mineIds = [];
    var hold = function (id) { if (id && !held[id]) { held[id] = 1; mineIds.push(id); } };
    jobs.forEach(function (j) { if (j.reuse) hold(j.id); });
    gen.forEach(function (j, k) {
      chain = chain.then(function () {
        if (stop || isCancelled()) return;
        prog(k, gen.length, "🖼 이미지 자동 생성 중… (" + (k + 1) + "/" + gen.length + ") " + j.title);
        var known = !!(memo[j.prompt] && store[memo[j.prompt]]);
        if (known) hold(memo[j.prompt]);
        return genOne(j.prompt, j.title, false).then(function (id) {
          hold(id); // 이 작업이 끝날 때까지 다음 그림이 정리하지 않게
          if (discard && discard()) return; // 생성을 취소한 뒤 늦게 도착한 이미지는 넣지 않는다
          j.id = id;
          made++; inRow = 0;
          if (!known && K.refImagesAddUrl && (K.refImages || []).length < REF_ROOM) K.refImagesAddUrl(store[id], j.title);
        }).catch(function () {
          failed++; inRow++;
          if (inRow >= 2) stop = true; // 키·권한·할당량 문제로 연달아 실패하면 남은 이미지는 건너뛴다
        });
      });
    });
    return chain.then(function () {
      mineIds.forEach(function (id) { delete held[id]; });
      var out = list.map(function (p, pi) {
        var mine = jobs.filter(function (j) { return j.part === pi && j.id; });
        // 슬라이드에 쓰지 않은 교안 그림도 내용이 같은 교수안 단계가 있으면 그 아래에 (새로 만들지 않음)
        var extra = (p.images || []).filter(function (img) { return img && store[img.id] && !mine.some(function (j) { return j.id === img.id; }); })
          .map(function (img) { return { id: img.id, title: img.title, text: img.text || "" }; });
        if (!mine.length && !extra.length) return p;
        return Object.assign({}, p, { deckMd: mine.length ? tagDeck(p.deckMd, mine) : p.deckMd, docMd: placeDoc(p.docMd, mine.concat(extra)), textMd: placeText(p.textMd, mine) });
      });
      prog(gen.length, gen.length, "이미지 " + made + "장 완료");
      return { parts: out, made: made, reused: jobs.length - gen.length, failed: failed, total: gen.length, stopped: stop, cancelled: isCancelled() };
    });
  }

  function summary(r) {
    if (!r || r.skipped === "off") return "";
    if (r.skipped === "nokey") return "이미지 자동 생성은 Google API 키가 있어야 합니다 — 키를 저장하면 슬라이드 이미지와 참고 이미지가 함께 만들어집니다.";
    if (!r.total && !r.reused) return "";
    var tail = (r.cancelled ? " 남은 이미지는 건너뛰었습니다." : r.stopped ? " 연달아 실패해 남은 이미지는 건너뛰었습니다 — 키·할당량을 확인하세요." : "");
    var reuse = r.reused ? " 교안 본문 이미지 " + r.reused + "장을 내용이 같은 슬라이드에 넣었습니다." : "";
    if (!r.made) return (r.total ? "🖼 이미지를 만들지 못했습니다" + (r.failed ? " (실패 " + r.failed + "장)" : "") + "." : "🖼") + reuse + tail;
    return "🖼 이미지 " + r.made + "장을 슬라이드 내용에 맞춰 만들어 슬라이드 칸과 교수안·교안 본문(대응 단계·소제목 아래), 참고 이미지에 넣었습니다" +
      (r.failed ? " (실패 " + r.failed + "장)" : "") + "." + reuse + tail;
  }

  /* [이미지:id] 표시를 실제 그림(![](data:…))으로 — 내려받은 MD 를 나중에 다시 올려도 그림이 남는다. 모르는 표시는 지운다
     줄 하나를 차지한 표시는 그 줄을 그림으로(교안·교수안 본문), 줄 끝 표시는 같은 줄에(편성안 시각 줄) */
  function altOf(id) { return String(alts[id] || "이미지").replace(/[\[\]\r\n]+/g, " ").trim() || "이미지"; }
  function expandTags(md) {
    return String(md || "").replace(/^([ \t]*)\[이미지:([^\]\s]+)\][ \t]*$/gm, function (m, sp, id) {
      return store[id] ? sp + "![" + altOf(id) + "](" + store[id] + ")" : "";
    }).replace(/[ \t]*\[이미지:([^\]\s]+)\]/g, function (m, id) {
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
  K.autoImages = { OPTIONS: OPTIONS, count: count, setCount: setCount, available: available, enabled: enabled, run: run, summary: summary, countJobs: countJobs,
    resolveVisual: resolveVisual, tagDeck: tagDeck, pick: pick, wireSelects: wireSelects, expandTags: expandTags,
    placeDoc: placeDoc, placeText: placeText, sim: sim, genOne: genOne, put: put, remove: remove, has: has, ready: ready, GENERIC: GENERIC,
    releasePinned: releasePinned, fenced: fenced, KEEP: KEEP,
    url: function (id) { return store[id] || ""; } };
  if (typeof document !== "undefined" && document.querySelectorAll) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { wireSelects(); });
    else wireSelects();
  }
})();
