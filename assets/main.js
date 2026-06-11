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
  function refreshGenerate() { btnGenerate.disabled = !(state.sourceText && state.sourceText.trim()); }
  wireZone(dzSource, document.getElementById("file-source"), function (name, text) {
    state.sourceText = text;
    if (srcText) srcText.value = text;   // 올린 파일 내용을 붙여넣기 칸에 채워 편집 가능하게
    markFilled(dzSource, name); refreshGenerate();
  });
  if (srcText) srcText.addEventListener("input", function () { state.sourceText = srcText.value; refreshGenerate(); });

  /* ---------- 모드 전환 ---------- */
  document.querySelectorAll(".mode-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".mode-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
      var mode = b.dataset.mode;
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

  /* ---------- 변환 (완성 MD → 결과) ---------- */
  btnConvert.addEventListener("click", function () { cameFromReview = false; convert(); });
  function convert() {
    var hasDoc = !!state.docText, hasDeck = !!state.deckText;
    var tabbar = document.getElementById("tabbar-tabs");
    tabbar.innerHTML = "";
    if (hasDoc) {
      K.buildDoc(K.parseDoc(state.docText), document.getElementById("doc-mount"));
      tabbar.appendChild(makeTab("doc", "📖 교수안", null));
    }
    if (hasDeck) {
      var parsedDeck = K.parseDeck(state.deckText);
      if (deckCtrl && deckCtrl.destroy) deckCtrl.destroy();
      deckCtrl = K.buildDeck(parsedDeck, document.getElementById("deck-mount"));
      if (K.editor) K.editor.init(deckCtrl);
      applyTheme(localStorage.getItem("kb-theme") || "maple");
      tabbar.appendChild(makeTab("deck", "🎬 슬라이드", parsedDeck.slides.length));
    }
    document.getElementById("tab-tools").style.display = "flex";
    document.getElementById("btn-prev-step").style.display = cameFromReview ? "inline-flex" : "none";
    showScreen("result");
    var first = tabbar.querySelector(".tab");
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

  /* ---------- AI 모델 선택 (K.AI.models 기반 · localStorage 기억) ---------- */
  (function initModelPicker() {
    var sel = document.getElementById("gen-model");
    if (!sel || !K.AI || !Array.isArray(K.AI.models) || !K.AI.models.length) return;
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
  })();

  function runGenerate() {
    if (!state.sourceText) return;
    var aiReady = (K.AI && K.AI.endpoint) || (window.claude && window.claude.complete);
    if (!aiReady) {
      alert("AI 생성 기능을 사용할 수 없는 환경입니다. 완성된 MD 업로드 모드를 이용해 주세요.");
      return;
    }
    var myToken = ++genToken;
    genStatus.textContent = "준비 중…";
    genStatus.classList.remove("error");
    genBar.style.width = "0%";
    genStep.textContent = "0"; genTotal.textContent = "0";
    showScreen("gen");

    K.generateFromSource(state.sourceText, function (done, total, label) {
      if (myToken !== genToken) return;
      genStep.textContent = done; genTotal.textContent = total;
      genBar.style.width = Math.round((done / Math.max(total, 1)) * 100) + "%";
      if (label) genStatus.textContent = label;
    }).then(function (out) {
      if (myToken !== genToken) return; // 취소됨
      document.getElementById("rdoc").value = out.docMd;
      document.getElementById("rdeck").value = out.deckMd;
      showScreen("review");
    }).catch(function (err) {
      if (myToken !== genToken) return;
      console.error(err);
      genStatus.textContent = "생성 중 오류가 발생했어요: " + (err && err.message ? err.message : err) + " — 다시 시도해 주세요.";
      genStatus.classList.add("error");
    });
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
  function activeReviewPane() {
    return document.querySelector(".rt-pane.active");
  }
  document.getElementById("btn-dl-active").addEventListener("click", function () {
    var pane = activeReviewPane();
    var isDoc = pane.id === "rdoc";
    download((isDoc ? "교수안" : "슬라이드 편성안") + ".md", pane.value);
  });
  document.getElementById("btn-build").addEventListener("click", function () {
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
