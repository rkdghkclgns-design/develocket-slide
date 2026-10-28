/* main.js — 빌더 셸 로직 (업로드 변환 + 소스 원고 AI 생성) */
(function () {
  "use strict";
  var K = window.KBuilder;
  var state = { docText: "", deckText: "", sourceText: "" };
  var deckCtrl = null;
  var genToken = 0;
  var cameFromReview = false;

  var app = document.getElementById("app");

  /* ---------- 화면 전환 ---------- */
  function showScreen(name) {
    app.dataset.screen = name; // intro | gen | review | result
    if (name === "result" && deckCtrl) refitDeckSoon();
  }
  showScreen("intro");

  /* ---------- 공통 드롭존 ---------- */
  function markFilled(dz, name) {
    dz.classList.add("filled");
    dz.querySelector(".dz-file .fn").textContent = name;
  }
  function readFileTo(file, cb) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () { cb(file.name, String(r.result)); };
    r.readAsText(file, "utf-8");
  }
  function wireZone(dz, input, onText) {
    dz.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () { readFileTo(input.files[0], onText); });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); });
    });
    dz.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files[0];
      if (f) readFileTo(f, onText);
    });
  }

  var dzDoc = document.getElementById("dz-doc");
  var dzDeck = document.getElementById("dz-deck");
  var btnConvert = document.getElementById("btn-convert");
  wireZone(dzDoc, document.getElementById("file-doc"), function (name, text) {
    state.docText = text; markFilled(dzDoc, name); refreshConvert();
  });
  wireZone(dzDeck, document.getElementById("file-deck"), function (name, text) {
    state.deckText = text; markFilled(dzDeck, name); refreshConvert();
  });
  function refreshConvert() { btnConvert.disabled = !(state.docText || state.deckText); }

  /* 소스 드롭존 + 직접 붙여넣기 텍스트영역 (둘 중 무엇이든 가능) */
  var dzSource = document.getElementById("dz-source");
  var btnGenerate = document.getElementById("btn-generate");
  var srcText = document.getElementById("source-text");
  function refreshGenerate() {
    btnGenerate.disabled = !(state.sourceText && state.sourceText.trim());
    // 부(# N부. 제목)로 나뉜 원고면 부마다 따로 생성한다고 알린다
    var hint = document.getElementById("gen-parts-hint");
    var split = K.parts && state.sourceText ? K.parts.splitParts(state.sourceText) : null;
    if (hint) {
      hint.hidden = !split;
      if (split) hint.textContent = "🧩 " + split.parts.length + "개 부 감지 — 부마다 교수안·슬라이드를 따로 만들고, 결과 화면의 드롭다운으로 오갈 수 있습니다: " +
        split.parts.map(function (p) { return p.label; }).join(" · ");
    }
  }
  wireZone(dzSource, document.getElementById("file-source"), function (name, text) {
    state.sourceText = text;
    if (srcText) srcText.value = text;   // 올린 파일 내용을 붙여넣기 칸에 채워 편집 가능하게
    markFilled(dzSource, name); refreshGenerate();
  });
  if (srcText) srcText.addEventListener("input", function () { state.sourceText = srcText.value; refreshGenerate(); });

  /* ---------- AI 사용 가능 여부 (엣지 · 사용자 Google/Claude 키 · 호스트 폴백) ---------- */
  function aiAvailable() {
    return !!(K.AI && typeof K.AI.anyText === "function" && K.AI.anyText());
  }
  var AI_UNAVAILABLE_MSG = "AI 기능을 사용하려면 시작 화면의 '🔑 Google API 키' 또는 '🔑 Claude API 키' 칸에 본인의 키를 붙여넣고 저장해 주세요.\n" +
    "키는 이 컴퓨터의 브라우저에만 저장됩니다. (발급: aistudio.google.com/apikey · console.anthropic.com)";

  /* ---------- 역할 라우팅 안내 (어떤 작업을 어느 AI가 맡는지) ---------- */
  function routeSummary() {
    var A = K.AI;
    if (!A || !A.route) return "";
    var groups = {};
    Object.keys(A.ROLE_LABELS).forEach(function (role) {
      var p = A.route(role);
      var name = p === "claude" ? "Claude" : p === "gemini" ? "Gemini" : p === "host" ? "호스트 AI" : p === "edge" ? "서버" : null;
      if (!name) return;
      (groups[name] = groups[name] || []).push(A.ROLE_LABELS[role]);
    });
    var names = Object.keys(groups);
    if (!names.length) return "";
    var head = A.isMixed() ? "🔀 혼합 모드 — " : "🤖 ";
    return head + names.map(function (n) { return n + ": " + groups[n].join("·"); }).join("  /  ");
  }
  function refreshAi() {
    var el = document.getElementById("ai-route");
    if (el) el.textContent = routeSummary();
    refreshModelPicker();
    try { document.dispatchEvent(new CustomEvent("kb-ai-change")); } catch (e) {}
  }

  /* ---------- AI 키 입력 (localStorage 전용 · 외부 전송 없음) ---------- */
  function wireKey(o) {
    var input = document.getElementById(o.input);
    if (!input || !K.AI) return;
    var btnSave = document.getElementById(o.save);
    var btnClear = document.getElementById(o.clear);
    var status = document.getElementById(o.status);
    function refresh() {
      var has = o.has();
      btnClear.hidden = !has;
      status.textContent = has ? "✓ 저장됨" : "";
      input.placeholder = has ? "키가 저장되어 있어요 — 바꾸려면 새 키 입력" : o.placeholder;
      if (o.onRefresh) o.onRefresh(has);
      refreshAi();
    }
    btnSave.addEventListener("click", function () {
      var v = input.value.trim();
      if (!v) { alert("저장할 API 키를 입력해 주세요."); return; }
      o.set(v);
      input.value = "";
      refresh();
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") btnSave.click(); });
    btnClear.addEventListener("click", function () {
      if (!confirm("저장된 " + o.name + "를 삭제할까요?")) return;
      o.set("");
      refresh();
    });
    refresh();
  }

  /* Claude 모델 선택 (localStorage 기억) */
  var claudeSel = document.getElementById("claude-model");
  if (claudeSel && K.AI && Array.isArray(K.AI.claudeModels)) {
    var savedClaude = null;
    try { savedClaude = localStorage.getItem("kb-claude-model"); } catch (e) {}
    var cids = K.AI.claudeModels.map(function (m) { return m.id; });
    if (savedClaude && cids.indexOf(savedClaude) !== -1) K.AI.claudeModel = savedClaude;
    claudeSel.innerHTML = K.AI.claudeModels.map(function (m) { return '<option value="' + m.id + '">' + m.label + "</option>"; }).join("");
    claudeSel.value = K.AI.claudeModel;
    claudeSel.addEventListener("change", function () {
      K.AI.claudeModel = claudeSel.value;
      try { localStorage.setItem("kb-claude-model", claudeSel.value); } catch (e) {}
    });
  }

  if (K.AI && typeof K.AI.getKey === "function") {
    wireKey({ input: "api-key-input", save: "btn-key-save", clear: "btn-key-clear", status: "api-key-status", name: "Google API 키",
      placeholder: "AI 생성에 쓸 본인의 Google API 키 붙여넣기",
      has: function () { return K.AI.hasKey(); }, set: function (v) { K.AI.setKey(v); } });
    wireKey({ input: "claude-key-input", save: "btn-claude-save", clear: "btn-claude-clear", status: "claude-key-status", name: "Claude API 키",
      placeholder: "AI 생성에 쓸 본인의 Claude API 키 붙여넣기 (sk-ant-…)",
      has: function () { return K.AI.hasClaudeKey(); }, set: function (v) { K.AI.setClaudeKey(v); },
      onRefresh: function (has) { if (claudeSel) claudeSel.hidden = !has; } });
  }

  /* ---------- 소스 원고 만들기 (입력 → AI 원고 작성 → '소스 원고로 생성'으로 전달) ---------- */
  (function initWrite() {
    var brief = document.getElementById("write-brief");
    if (!brief) return;
    var btnWrite = document.getElementById("btn-write");
    var status = document.getElementById("write-status");
    var out = document.getElementById("write-out");
    var result = document.getElementById("write-result");
    var busy = false;
    var partsBox = document.getElementById("write-parts");
    var hoursInput = document.getElementById("write-hours");
    var IDLE_HINT = status.textContent;
    /* "주제 입력: …" + 하위 주제 목록이면 부(部)별 작성 안내와 시간 분할을 보여 준다 */
    function topicList() { return K.parts ? K.parts.detectTopicList(brief.value) : null; }
    /* updateStatus: 입력이 바뀌었을 때만 안내 문구를 갱신한다 (작업 결과 메시지를 덮지 않도록) */
    function refreshParts(updateStatus) {
      var t = topicList();
      if (partsBox) partsBox.hidden = !t;
      if (!t) { if (!busy && updateStatus) status.textContent = IDLE_HINT; return; }
      var total = Math.max(t.units.length, Math.round(Number(hoursInput.value) || 40));
      var hrs = K.parts.splitHours(t.units.length, total);
      document.getElementById("write-parts-n").textContent = t.units.length;
      document.getElementById("write-parts-split").textContent = "(" + hrs.map(function (h, i) { return (i + 1) + "부 " + h + "h"; }).join(" · ") + ")";
      if (!busy && updateStatus) status.textContent = "'" + t.title + "' 과정을 " + t.units.length + "개 부로 나눠, 부마다 원고를 쓴 뒤 하나의 소스 원고로 합칩니다. 다음 단계에서 부마다 교수안·슬라이드가 따로 만들어집니다.";
    }
    function refresh(updateStatus) { btnWrite.disabled = busy || !brief.value.trim(); refreshParts(updateStatus === true); }
    brief.addEventListener("input", function () { refresh(true); });
    if (hoursInput) hoursInput.addEventListener("input", function () { refreshParts(true); });

    /* 참고 MD 업로드 → 입력칸에 채워 확장 재료로 사용 */
    var dzWrite = document.getElementById("dz-write");
    if (dzWrite) wireZone(dzWrite, document.getElementById("file-write"), function (name, text) {
      var cur = brief.value.trim();
      brief.value = cur ? cur + "\n\n" + text : text;
      markFilled(dzWrite, name);
      refresh(true);
    });

    btnWrite.addEventListener("click", function () {
      if (busy || !brief.value.trim()) return;
      if (!aiAvailable() || !K.writeSource) {
        alert(AI_UNAVAILABLE_MSG);
        return;
      }
      var topic = topicList();
      busy = true; refresh();
      btnWrite.textContent = "🍁 작성 중…";
      status.textContent = topic
        ? "AI가 " + topic.units.length + "개 부의 소스 원고를 차례로 작성하고 있어요. 부마다 1~2분씩 걸립니다…"
        : "AI가 소스 원고를 작성하고 있어요. 분량에 따라 1~2분 걸릴 수 있습니다…";
      var onProg = function (done, total, label) { if (label) status.textContent = "🍁 " + label; };
      var job = topic
        ? K.parts.writeSourceParts(brief.value, onProg, { totalHours: Number(hoursInput.value) || 40 })
        : K.writeSource(brief.value, onProg);
      job.then(function (md) {
        result.value = md;
        out.hidden = false;
        status.textContent = "작성 완료! 아래에서 수정한 뒤 '소스 원고로 생성 →' 버튼으로 넘기세요." +
          (topic ? " (" + topic.units.length + "개 부 — '# N부. 제목' 머리글로 구분됩니다)" : "");
      }).catch(function (err) {
        if (err && err.partial) { result.value = err.partial; out.hidden = false; }
        status.textContent = "⚠ " + ((err && err.message) || "원고 작성에 실패했습니다. 다시 시도해 주세요.") +
          (err && err.partial ? " — 완료된 " + err.partialCount + "개 부까지는 아래에 남겨 두었습니다." : "");
      }).then(function () {
        busy = false; btnWrite.textContent = "✨ AI로 원고 작성"; refresh();
      });
    });

    document.getElementById("btn-write-dl").addEventListener("click", function () {
      if (result.value.trim()) download("소스 원고.md", result.value);
    });
    document.getElementById("btn-write-pass").addEventListener("click", function () {
      var md = result.value.trim();
      if (!md) { alert("먼저 AI로 원고를 작성해 주세요."); return; }
      state.sourceText = md;
      if (srcText) srcText.value = md;
      refreshGenerate();
      var gb = document.querySelector('.mode-btn[data-mode="generate"]');
      if (gb) gb.click();
    });
  })();

  /* ---------- 모드 전환 ---------- */
  document.querySelectorAll(".mode-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".mode-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
      var mode = b.dataset.mode;
      if (mode === "course") {
        showScreen("course");
        if (K.courseUI) K.courseUI.open();
        return;
      }
      document.getElementById("panel-write").hidden = mode !== "write";
      document.getElementById("panel-upload").hidden = mode !== "upload";
      document.getElementById("panel-generate").hidden = mode !== "generate";
    });
  });

  /* ---------- 샘플 ---------- */
  document.getElementById("btn-sample").addEventListener("click", function () {
    if (!K.samples) return;
    state.docText = K.samples.doc; markFilled(dzDoc, "교수안.md (샘플)");
    state.deckText = K.samples.deck; markFilled(dzDeck, "슬라이드 편성안.md (샘플)");
    refreshConvert();
  });
  document.getElementById("dl-sample-doc").addEventListener("click", function () { if (K.samples) download("교수안.md", K.samples.doc); });
  document.getElementById("dl-sample-deck").addEventListener("click", function () { if (K.samples) download("슬라이드 편성안.md", K.samples.deck); });

  /* ---------- 내보낸 HTML 불러오기 → 이어서 편집 ---------- */
  var importInput = document.getElementById("file-import-html");
  document.getElementById("btn-import-html").addEventListener("click", function () { importInput.click(); });
  importInput.addEventListener("change", function () {
    var f = importInput.files && importInput.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { importDeckHtml(String(r.result)); };
    r.readAsText(f, "utf-8");
    importInput.value = "";
  });
  /* 현재 소스 MD·참고이미지 — HTML 내보내기에 내장되어 '불러오기'에서 한번에 복원된다 */
  K.getSource = function () {
    return {
      doc: state.docText || "",
      deck: state.deckText || "",
      source: state.sourceText || "",
      refs: (K.getRefImages ? K.getRefImages() : [])
    };
  };
  /* 내보낸 HTML에 내장된 소스(JSON)를 읽는다 — 없으면 null (구버전 파일) */
  function readEmbeddedSource(doc) {
    var el = doc.getElementById("kb-source");
    if (!el) return null;
    try {
      var data = JSON.parse(el.textContent || el.text || "");
      return (data && typeof data === "object") ? data : null;
    } catch (e) { return null; }
  }

  /* 불러온 HTML에서 실행 가능 요소·핸들러를 제거 (innerHTML 마운트 전 세니타이즈) */
  function sanitizeImported(root) {
    Array.prototype.slice.call(root.querySelectorAll("script,iframe,object,embed,link,meta,base,form")).forEach(function (n) { n.remove(); });
    Array.prototype.slice.call(root.querySelectorAll("*")).forEach(function (el) {
      // 이름을 먼저 수집한 뒤 제거 — 살아있는 NamedNodeMap을 순회 중 변경하지 않는다
      var toRemove = [];
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n.indexOf("on") === 0 || n === "formaction") { toRemove.push(a.name); return; }
        if ((n === "href" || n === "src" || n === "xlink:href") && /^\s*javascript:/i.test(String(a.value || ""))) toRemove.push(a.name);
      });
      toRemove.forEach(function (name) { el.removeAttribute(name); });
    });
  }
  function importDeckHtml(text) {
    var doc = new DOMParser().parseFromString(text, "text/html");
    var stage = doc.querySelector(".deck-stage-inner");
    if (!stage || !stage.querySelector(".slide")) {
      alert("지원하지 않는 HTML입니다. 이 빌더에서 내보낸 슬라이드 HTML 파일을 선택해 주세요.");
      return;
    }
    setParts(null); // 불러온 HTML 은 한 부(덱) 단위
    // 내장 소스(교수안·편성안 MD·참고이미지) 복원 — 있으면 한번에 되살려 수정 가능하게 한다
    var src = readEmbeddedSource(doc); // 세니타이즈 전에 읽는다(DOMParser는 스크립트를 실행하지 않음)
    sanitizeImported(stage);
    var tabbar = document.getElementById("tabbar-tabs");
    tabbar.innerHTML = "";
    if (deckCtrl && deckCtrl.destroy) deckCtrl.destroy();

    if (src) {
      state.docText = src.doc || "";
      state.deckText = src.deck || "";
      state.sourceText = src.source || "";
      if (K.refImagesSet) K.refImagesSet(src.refs || []);
      // 검토 화면 MD 채우기 — '← 이전 단계'에서 MD를 고쳐 다시 빌드할 수 있다
      var rdoc = document.getElementById("rdoc"); if (rdoc) rdoc.value = state.docText;
      var rdeck = document.getElementById("rdeck"); if (rdeck) rdeck.value = state.deckText;
      if (state.docText) markFilled(dzDoc, "교수안.md (불러옴)");
      if (state.deckText) markFilled(dzDeck, "슬라이드 편성안.md (불러옴)");
      if (state.sourceText && srcText) srcText.value = state.sourceText;
      refreshConvert(); refreshGenerate();
      // 교수안 탭 — MD에서 문서를 다시 렌더(이미지·참고 이미지 갤러리 포함)
      if (state.docText) {
        K.buildDoc(K.parseDoc(state.docText), document.getElementById("doc-mount"));
        tabbar.appendChild(makeTab("doc", "📖 교수안", null));
      }
    }

    // 슬라이드 — 사용자가 편집한 HTML 그대로 마운트해 시각 편집을 보존한다
    deckCtrl = K.mountDeckHtml(stage.innerHTML, document.getElementById("deck-mount"), { "주제": doc.title || "불러온 슬라이드" });
    if (K.editor) K.editor.init(deckCtrl);
    applyTheme(stage.classList.contains("theme-dark") ? "dark" : "maple");
    tabbar.appendChild(makeTab("deck", "🎬 슬라이드", deckCtrl.count));

    document.getElementById("tab-tools").style.display = "flex";
    // 소스가 내장돼 있으면 '← 이전 단계'를 검토(MD 편집)로 연결한다
    cameFromReview = !!src;
    document.getElementById("btn-prev-step").style.display = cameFromReview ? "inline-flex" : "none";
    showScreen("result");
    activateTab("deck"); // 편집은 슬라이드 탭에서 — 교수안 탭은 옆에 함께 노출
    if (K.editor) K.editor.setEdit(true); // 불러오기 성공 → 바로 편집 가능
  }

  /* ---------- 부(部) 단위 결과 — 하위 주제마다 교수안·슬라이드, 드롭다운으로 이동 ----------
   * parts[i] = { label, docMd, deckMd, textMd?, deckHtml(편집한 슬라이드 스냅숏), builtHtml(빌드 직후 원본) } */
  var parts = null, partIdx = 0;
  var reviewPartSel = document.getElementById("review-part");
  var resultPartSel = document.getElementById("part-sel");

  function renderPartSelects() {
    [reviewPartSel, resultPartSel].forEach(function (sel) {
      if (!sel) return;
      sel.hidden = !parts;
      sel.innerHTML = parts ? parts.map(function (p, i) {
        return '<option value="' + i + '">' + K.escapeHtml(p.label || ((i + 1) + "부. " + (p.title || ""))) + "</option>";
      }).join("") : "";
      if (parts) sel.value = String(partIdx);
    });
  }
  function setParts(list, idx) {
    parts = list && list.length > 1 ? list.map(function (p) {
      return { label: p.label, title: p.title, docMd: p.docMd || "", deckMd: p.deckMd || "", textMd: p.textMd || "", deckHtml: null, builtHtml: null };
    }) : null;
    partIdx = parts ? Math.max(0, Math.min(idx || 0, parts.length - 1)) : 0;
    renderPartSelects();
  }
  function loadReviewPart() {
    var p = parts[partIdx];
    document.getElementById("rdoc").value = p.docMd;
    document.getElementById("rdeck").value = p.deckMd;
    document.getElementById("rtext").value = p.textMd || "";
    document.getElementById("rtab-text").hidden = !p.textMd;
    if (!p.textMd && activeReviewPane() && activeReviewPane().id === "rtext") selectReviewTab("rdoc");
  }
  function saveReviewPart() {
    if (!parts) return;
    var p = parts[partIdx];
    var doc = document.getElementById("rdoc").value, deck = document.getElementById("rdeck").value;
    if (doc !== p.docMd || deck !== p.deckMd) p.deckHtml = null; // MD를 고쳤으면 슬라이드는 MD에서 다시 만든다
    p.docMd = doc; p.deckMd = deck;
    if (p.textMd) p.textMd = document.getElementById("rtext").value;
  }
  /* 결과 화면에서 다른 부로 넘어가기 전, 슬라이드에서 편집한 내용을 보관한다 */
  function snapshotDeck() {
    if (!parts || !deckCtrl || !deckCtrl.stageInner) return;
    if (K.editor) K.editor.setEdit(false);
    var html = deckCtrl.stageInner.innerHTML;
    var p = parts[partIdx];
    if (html !== p.builtHtml) p.deckHtml = html;
  }
  function showPart(i) {
    partIdx = i;
    var p = parts[i];
    state.docText = p.docMd; state.deckText = p.deckMd;
    loadReviewPart();
    renderPartSelects();
  }
  if (reviewPartSel) reviewPartSel.addEventListener("change", function () {
    saveReviewPart();
    showPart(Number(reviewPartSel.value));
  });
  if (resultPartSel) resultPartSel.addEventListener("change", function () {
    var active = document.querySelector("#tabbar-tabs .tab.active");
    snapshotDeck();
    showPart(Number(resultPartSel.value));
    convert(active ? active.dataset.target : null);
  });

  /* ---------- 변환 (완성 MD → 결과) ---------- */
  btnConvert.addEventListener("click", function () { cameFromReview = false; setParts(null); convert(); });
  function convert(preferTab) {
    var hasDoc = !!state.docText, hasDeck = !!state.deckText;
    var tabbar = document.getElementById("tabbar-tabs");
    var part = parts ? parts[partIdx] : null;
    tabbar.innerHTML = "";
    if (hasDoc) {
      K.buildDoc(K.parseDoc(state.docText), document.getElementById("doc-mount"));
      tabbar.appendChild(makeTab("doc", "📖 교수안", null));
    }
    if (hasDeck) {
      var parsedDeck = K.parseDeck(state.deckText);
      var mount = document.getElementById("deck-mount");
      if (deckCtrl && deckCtrl.destroy) deckCtrl.destroy();
      if (part && part.deckHtml) {
        // 이 부에서 편집했던 슬라이드를 그대로 되살린다 (PPTX는 MD 기준이라 parsed 를 함께 연결)
        deckCtrl = K.mountDeckHtml(part.deckHtml, mount, parsedDeck.meta);
        K.lastDeck.parsed = parsedDeck;
        K.lastDeck.imported = false;
      } else {
        deckCtrl = K.buildDeck(parsedDeck, mount);
        if (part) part.builtHtml = deckCtrl.stageInner.innerHTML;
      }
      if (K.editor) K.editor.init(deckCtrl);
      applyTheme(localStorage.getItem("kb-theme") || "maple");
      tabbar.appendChild(makeTab("deck", "🎬 슬라이드", deckCtrl.count));
    }
    document.getElementById("tab-tools").style.display = "flex";
    document.getElementById("btn-prev-step").style.display = cameFromReview ? "inline-flex" : "none";
    showScreen("result");
    var want = preferTab && tabbar.querySelector('.tab[data-target="' + preferTab + '"]');
    var first = want || tabbar.querySelector(".tab");
    if (first) activateTab(first.dataset.target);
  }

  function makeTab(target, label, count) {
    var b = document.createElement("button");
    b.className = "tab";
    b.dataset.target = target;
    b.innerHTML = label + (count != null ? ' <span class="tcount">' + count + '</span>' : "");
    b.addEventListener("click", function () { activateTab(target); });
    return b;
  }
  function refitDeckSoon() {
    var vp = document.querySelector("#deck-pane .deck-viewport");
    if (deckCtrl) deckCtrl.refit();
    if (vp) requestAnimationFrame(function () { vp.focus(); });
  }
  function activateTab(target) {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.target === target); });
    document.querySelectorAll(".pane").forEach(function (p) { p.classList.toggle("active", p.id === target + "-pane"); });
    if (target === "deck" && deckCtrl) refitDeckSoon();
    document.getElementById("btn-print").dataset.kind = target;
    // 편집/HTML/PPTX는 슬라이드 탭에서만
    var deckOnly = target === "deck";
    ["btn-edit", "btn-html", "btn-pptx", "theme-sel", "btn-logo"].forEach(function (id) {
      document.getElementById(id).style.display = deckOnly ? "inline-flex" : "none";
    });
    if (!deckOnly && K.editor) K.editor.setEdit(false);
  }

  /* ---------- 테마 전환 ---------- */
  function applyTheme(t) {
    localStorage.setItem("kb-theme", t);
    document.getElementById("theme-sel").value = t;
    var stage = document.querySelector("#deck-mount .deck-stage-inner");
    var railEl = document.getElementById("deck-rail");
    [stage, railEl].forEach(function (el) { if (el) el.classList.toggle("theme-dark", t === "dark"); });
  }
  document.getElementById("theme-sel").addEventListener("change", function () { applyTheme(this.value); });

  /* ---------- 로고 (사용자 업로드 + 표시 토글, 기본 숨김) ---------- */
  K.logo = {
    src: localStorage.getItem("kb-logo-src") || "",
    shown: localStorage.getItem("kb-logo-shown") === "1"
  };
  K.applyLogo = function () {
    var L = K.logo || {};
    var show = !!(L.shown && L.src);
    Array.prototype.slice.call(document.querySelectorAll("#deck-mount .logo, #deck-rail .logo")).forEach(function (im) {
      im.src = L.src || "assets/logo-worlds.png";
      im.style.display = show ? "" : "none";
    });
  };
  function persistLogo() {
    try {
      if (K.logo.src) localStorage.setItem("kb-logo-src", K.logo.src); else localStorage.removeItem("kb-logo-src");
      localStorage.setItem("kb-logo-shown", K.logo.shown ? "1" : "0");
    } catch (e) { /* 용량 초과 등은 세션 메모리로만 유지 */ }
  }
  (function buildLogoControl() {
    var btn = document.getElementById("btn-logo");
    if (!btn) return;
    var pop = document.createElement("div");
    pop.className = "logo-pop";
    pop.innerHTML =
      '<div class="lg-row"><div class="lg-prev" id="lg-prev">로고 없음</div></div>' +
      '<button class="lg-btn" id="lg-up">📂 로고 이미지 업로드</button>' +
      '<label class="lg-toggle"><input type="checkbox" id="lg-show" /> 슬라이드에 로고 표시</label>' +
      '<button class="lg-btn lg-danger" id="lg-rm">🗑 로고 제거</button>' +
      '<p class="lg-hint">우측 상단에 표시됩니다. 투명 PNG 권장.</p>';
    document.body.appendChild(pop);
    var fin = document.createElement("input");
    fin.type = "file"; fin.accept = "image/*"; fin.hidden = true; document.body.appendChild(fin);
    var prev = pop.querySelector("#lg-prev");
    var chk = pop.querySelector("#lg-show");
    function syncPop() {
      chk.checked = !!(K.logo.shown && K.logo.src);
      chk.disabled = !K.logo.src;
      prev.innerHTML = K.logo.src ? '<img src="' + K.logo.src + '" alt="logo" />' : "로고 없음";
    }
    function openPop() {
      var r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 8) + "px";
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 280)) + "px";
      syncPop(); pop.classList.add("open");
    }
    function closePop() { pop.classList.remove("open"); }
    btn.addEventListener("click", function (e) { e.stopPropagation(); pop.classList.contains("open") ? closePop() : openPop(); });
    document.addEventListener("click", function (e) { if (pop.classList.contains("open") && !pop.contains(e.target) && e.target !== btn) closePop(); });
    pop.querySelector("#lg-up").addEventListener("click", function () { fin.click(); });
    fin.addEventListener("change", function () {
      var f = fin.files && fin.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { K.logo.src = String(fr.result); K.logo.shown = true; persistLogo(); K.applyLogo(); syncPop(); };
      fr.readAsDataURL(f); fin.value = "";
    });
    chk.addEventListener("change", function () { K.logo.shown = chk.checked; persistLogo(); K.applyLogo(); });
    pop.querySelector("#lg-rm").addEventListener("click", function () { K.logo.src = ""; K.logo.shown = false; persistLogo(); K.applyLogo(); syncPop(); });
  })();

  /* ---------- 편집 모드 / 슬라이드 조작 / 내보내기 ---------- */
  document.getElementById("btn-edit").addEventListener("click", function () { if (K.editor) K.editor.setEdit(!K.editor.isEditing()); });
  document.getElementById("btn-html").addEventListener("click", function () { K.exportHTML(); });
  document.getElementById("btn-pptx").addEventListener("click", function () { K.exportPPTX(); });
  document.getElementById("btn-dup-slide").addEventListener("click", function () { if (K.editor) K.editor.dupSlide(); });
  document.getElementById("btn-add-slide").addEventListener("click", function () { if (K.editor) K.editor.addSlide(); });
  document.getElementById("btn-del-slide").addEventListener("click", function () { if (K.editor) K.editor.delSlide(); });
  document.getElementById("btn-prev-step").addEventListener("click", function () { showScreen(cameFromReview ? "review" : "intro"); });

  /* ---------- AI 생성 ---------- */
  var genStatus = document.getElementById("gen-status");
  var genBar = document.getElementById("gen-bar-fill");
  var genStep = document.getElementById("gen-step");
  var genTotal = document.getElementById("gen-total");

  /* ---------- AI 모델 선택 (K.AI.models 기반 · localStorage 기억) ----------
     Gemini 백엔드(엣지 또는 사용자 키)가 있을 때만 행을 노출한다.
     키 저장/삭제 시 initApiKey 가 다시 호출해 노출 상태를 갱신한다. */
  /* ---------- 슬라이드 형식 선택 (프레젠테이션용 / 상세 교재형 · localStorage 기억) ---------- */
  (function initStylePicker() {
    var sel = document.getElementById("gen-style");
    if (!sel || !K.AI) return;
    var saved = null;
    try { saved = localStorage.getItem("kb-slide-style"); } catch (e) {}
    K.AI.slideStyle = saved === "detailed" ? "detailed" : "presentation";
    sel.value = K.AI.slideStyle;
    sel.addEventListener("change", function () {
      K.AI.slideStyle = sel.value;
      try { localStorage.setItem("kb-slide-style", sel.value); } catch (e) {}
    });
  })();

  var modelPickerWired; // 키 입력 초기화가 먼저 호출할 수 있어 초기값을 덮어쓰지 않는다
  function refreshModelPicker() {
    var sel = document.getElementById("gen-model");
    if (!sel) return;
    var row = sel.closest(".gen-model-row");
    var geminiReady = K.AI && (K.AI.endpoint || (typeof K.AI.hasKey === "function" && K.AI.hasKey()));
    if (!geminiReady || !Array.isArray(K.AI.models) || !K.AI.models.length) {
      if (row) row.style.display = "none";
      return;
    }
    if (row) row.style.display = "";
    if (modelPickerWired) return;
    modelPickerWired = true;
    var ids = K.AI.models.map(function (m) { return m.id; });
    var saved = null;
    try { saved = localStorage.getItem("kb-ai-model"); } catch (e) {}
    if (saved && ids.indexOf(saved) !== -1) K.AI.model = saved;
    else if (ids.indexOf(K.AI.model) === -1) K.AI.model = ids[0];
    sel.innerHTML = K.AI.models.map(function (m) {
      return '<option value="' + m.id + '">' + m.label + '</option>';
    }).join("");
    sel.value = K.AI.model;
    sel.addEventListener("change", function () {
      K.AI.model = sel.value;
      try { localStorage.setItem("kb-ai-model", sel.value); } catch (e) {}
    });
  }
  refreshModelPicker();

  function runGenerate() {
    if (!state.sourceText) return;
    if (!aiAvailable()) {
      alert(AI_UNAVAILABLE_MSG);
      return;
    }
    var myToken = ++genToken;
    var stale = document.getElementById("btn-gen-partial");
    if (stale) stale.remove();
    genStatus.textContent = "준비 중…";
    genStatus.classList.remove("error");
    genBar.style.width = "0%";
    genStep.textContent = "0"; genTotal.textContent = "0";
    showScreen("gen");

    var onProg = function (done, total, label) {
      if (myToken !== genToken) return;
      genStep.textContent = Math.round(done); genTotal.textContent = total;
      genBar.style.width = Math.round((done / Math.max(total, 1)) * 100) + "%";
      if (label) genStatus.textContent = label;
    };
    var split = K.parts ? K.parts.splitParts(state.sourceText) : null;
    var job = split
      ? K.parts.generateParts(state.sourceText, onProg)
      : K.generateFromSource(state.sourceText, onProg).then(function (out) { return { parts: [out] }; });
    job.then(function (out) {
      if (myToken !== genToken) return; // 취소됨
      openReviewWith(out.parts);
    }).catch(function (err) {
      if (myToken !== genToken) return;
      console.error(err);
      var done = err && err.partialParts && err.partialParts.length;
      genStatus.textContent = "생성 중 오류가 발생했어요: " + (err && err.message ? err.message : err) + " — 다시 시도해 주세요." +
        (done ? " (완료된 " + done + "개 부는 '완료분 검토'로 볼 수 있어요)" : "");
      genStatus.classList.add("error");
      if (done) offerPartial(err.partialParts);
    });
  }
  /* 생성 결과(1개 또는 여러 부)를 검토 화면에 띄운다 */
  function openReviewWith(list, idx) {
    var one = list.length === 1 ? list[0] : null;
    setParts(one ? null : list, idx);
    if (one) {
      document.getElementById("rdoc").value = one.docMd || "";
      document.getElementById("rdeck").value = one.deckMd || "";
      document.getElementById("rtext").value = one.textMd || "";
      document.getElementById("rtab-text").hidden = !one.textMd;
    } else {
      loadReviewPart();
    }
    selectReviewTab("rdoc");
    showScreen("review");
  }
  /* 부별 생성 도중 실패하면, 끝난 부까지는 검토할 수 있게 버튼을 붙인다 */
  function offerPartial(list) {
    var old = document.getElementById("btn-gen-partial");
    if (old) old.remove();
    var b = document.createElement("button");
    b.className = "btn btn-primary"; b.id = "btn-gen-partial";
    b.textContent = "완료분 검토 (" + list.length + "개 부) →";
    b.addEventListener("click", function () { b.remove(); openReviewWith(list); });
    document.getElementById("btn-gen-cancel").insertAdjacentElement("beforebegin", b);
  }
  btnGenerate.addEventListener("click", runGenerate);
  document.getElementById("btn-gen-cancel").addEventListener("click", function () {
    genToken++; // 진행 중 결과 무시
    showScreen("intro");
  });
  document.getElementById("btn-regen").addEventListener("click", function () {
    if (confirm("현재 편집 내용을 버리고 원고에서 다시 생성할까요?")) runGenerate();
  });

  /* ---------- 검토 화면 ---------- */
  document.querySelectorAll(".rtab").forEach(function (b) {
    b.addEventListener("click", function () {
      var rt = b.dataset.rt;
      document.querySelectorAll(".rtab").forEach(function (x) { x.classList.toggle("active", x === b); });
      document.querySelectorAll(".rt-pane").forEach(function (p) { p.classList.toggle("active", p.id === rt); });
    });
  });

  /* 검토 MD에 이미지 붙여넣기(Ctrl+V) → 커서 위치에 ![](dataURL) 삽입 → 빌드 시 렌더 */
  function wirePasteImage(ta) {
    if (!ta) return;
    ta.addEventListener("paste", function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var file = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && String(items[i].type).indexOf("image/") === 0) { file = items[i].getAsFile(); break; }
      }
      if (!file) return;
      e.preventDefault();
      var insert = function (url) {
        var md = "\n\n![붙여넣은 이미지](" + url + ")\n\n";
        var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        var end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
        ta.value = ta.value.slice(0, start) + md + ta.value.slice(end);
        var pos = start + md.length;
        try { ta.selectionStart = ta.selectionEnd = pos; } catch (e2) {}
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      };
      if (K.refDownscale) K.refDownscale(file).then(insert).catch(function () {});
      else { var fr = new FileReader(); fr.onload = function () { insert(String(fr.result)); }; fr.readAsDataURL(file); }
    });
  }
  wirePasteImage(document.getElementById("rdoc"));
  wirePasteImage(document.getElementById("rdeck"));
  wirePasteImage(document.getElementById("rtext"));
  function activeReviewPane() {
    return document.querySelector(".rt-pane.active");
  }
  function selectReviewTab(rt) {
    document.querySelectorAll(".rtab").forEach(function (x) { x.classList.toggle("active", x.dataset.rt === rt); });
    document.querySelectorAll(".rt-pane").forEach(function (p) { p.classList.toggle("active", p.id === rt); });
  }
  /* 다른 모듈(과정 설계)에서 생성한 MD를 검토 화면으로 넘긴다 */
  K.app = {
    showScreen: showScreen,
    refreshAi: refreshAi,
    /* o = {docMd, deckMd, textMd} 하나, 또는 o.parts = [{label, docMd, deckMd, textMd}] 여러 부 */
    openReview: function (o) {
      openReviewWith(o.parts && o.parts.length ? o.parts : [o], o.index || 0);
      if (o.tab) selectReviewTab(o.tab);
    }
  };
  document.getElementById("btn-dl-active").addEventListener("click", function () {
    var pane = activeReviewPane();
    var names = { rdoc: "교수안", rdeck: "슬라이드 편성안", rtext: "교재(교습안)" };
    var suffix = parts ? " - " + String(parts[partIdx].label || "").replace(/[\\/:*?"<>|]+/g, " ").trim() : "";
    download((names[pane.id] || "문서") + suffix + ".md", pane.value);
  });
  document.getElementById("btn-build").addEventListener("click", function () {
    if (parts) saveReviewPart();
    state.docText = document.getElementById("rdoc").value;
    state.deckText = document.getElementById("rdeck").value;
    markFilled(dzDoc, "교수안.md (생성)");
    markFilled(dzDeck, "슬라이드 편성안.md (생성)");
    refreshConvert();
    cameFromReview = true;
    convert();
  });

  function download(filename, text) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  /* ---------- 네비게이션 ---------- */
  document.getElementById("btn-back").addEventListener("click", function () { showScreen("intro"); });
  document.getElementById("btn-reset").addEventListener("click", function () { showScreen("intro"); });

  /* ---------- 인쇄 / PDF ---------- */
  function injectOrient(mode) {
    var el = document.getElementById("print-orient");
    if (!el) { el = document.createElement("style"); el.id = "print-orient"; document.head.appendChild(el); }
    // 슬라이드: 16:9 페이지로 한 장이 한 페이지를 가득 채움 / 교수안 문서: A4 세로
    el.textContent = (mode === "slide")
      ? "@page { size: 297mm 167mm; margin: 0; }"
      : "@page { size: A4 portrait; margin: 14mm; }";
  }
  document.getElementById("btn-print").addEventListener("click", function () {
    var which = this.dataset.kind || "doc";
    document.querySelectorAll(".pane").forEach(function (p) { p.classList.remove("print-target"); });
    var pane = document.getElementById(which + "-pane");
    if (pane) pane.classList.add("print-target");
    if (which === "deck") { document.body.classList.add("print-deck"); injectOrient("slide"); }
    else { injectOrient("portrait"); }
    window.print();
  });
  window.addEventListener("afterprint", function () { document.body.classList.remove("print-deck"); });

  refreshConvert();
})();
