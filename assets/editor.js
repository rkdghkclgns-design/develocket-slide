/* editor.js — 슬라이드 편집기
   서식 툴바, 요소 선택(단일/다중·고무줄·Shift), 드래그 이동(Shift 축고정),
   크기조절(Shift 비율유지), 복사·붙여넣기·잘라내기·삭제, 슬라이드 복제/추가/삭제, 썸네일 레일. */
(function () {
  "use strict";
  var ctrl = null, viewport = null, stage = null, rail = null, toolbar = null;
  var selected = [];         // 선택된 요소들
  var clip = [];             // 요소 클립보드 (클론 배열)
  var copyN = 0;
  var savedRange = null;
  var editMode = false;
  var textEl = null;
  var undoStack = [];        // 구조 변경(교체/추가/삭제/복제/요소삭제·붙여넣기) 스냅샷

  // 내부 객체(.step, .chip, .toc-card, .ct-card 등)도 개별 선택·이동·크기조절 가능.
  // closest()가 가장 안쪽 selectable을 잡으므로 step/chip을 먼저 두면 그룹이 아닌 개별 칩이 선택된다.
  var SELECTABLE = ".step,.chip,.cmp-col,.step-row,.toc-card,.ct-card,.duo-col,.eyebrow,.slidetitle,.cover-title,.cover-sub,.cover-course,.closing-title,.closing-lead,.lead,.items,.flow,.chips,.cmp-grid,.steps-list,.keybar,.toc-grid,.col-side,.col-main,.mushcard,.cover-left,.cover-right,.closing-left,.closing-right,.blob,image-slot,.pasted-img,.panel,.st-big,.st-lead,.st-kicker,.duo-title,.cmp-head,.cmp-foot,.tbl";
  var TEXTBLOCK = ".step,.chip,.cmp-col,.cmp-head,.cmp-foot,.step-row,.toc-card,.ct-card,.eyebrow,.slidetitle,.cover-title,.cover-sub,.cover-course,.closing-title,.closing-lead,.lead,.items,.flow,.chips,.keybar,.col-main,.st-big,.st-lead,.st-kicker,.duo-title,.tbl,.panel";

  function scale() {
    var s = stage.querySelector(".slide");
    return s ? (s.getBoundingClientRect().width / 1920) || 1 : 1;
  }
  function slotSrc(id) {
    var sl = document.getElementById(id);
    if (sl && sl._img && sl._img.src && sl._img.src.indexOf("data:") === 0) return sl._img.src;
    return (sl && sl.getAttribute("src")) || "";
  }

  /* ---------------- 초기화 ---------------- */
  function init(c) {
    ctrl = c; viewport = c.viewport; stage = c.stageInner;
    rail = document.getElementById("deck-rail");
    buildToolbar();
    buildRail();
    ctrl.setOnShow(function (i) { markRail(i); deselect(); });
    stage.addEventListener("mousedown", onStageDown, true);
    stage.addEventListener("dblclick", onStageDblClick, true);
    document.addEventListener("selectionchange", function () {
      var s = window.getSelection();
      if (s && s.rangeCount) {
        var n = s.anchorNode; n = n && (n.nodeType === 1 ? n : n.parentElement);
        if (n && stage.contains(n)) savedRange = s.getRangeAt(0).cloneRange();
      }
    });
    markRail(ctrl.index);
  }

  function setEdit(on) {
    editMode = on;
    viewport.classList.toggle("editing", on);
    toolbar.style.display = on ? "flex" : "none";
    if (!on) { deselect(); stopTextEdit(); }
    else { try { viewport.focus({ preventScroll: true }); } catch (e) {} }
    var btn = document.getElementById("btn-edit");
    if (btn) { btn.classList.toggle("active", on); btn.textContent = on ? "✓ 편집 끝" : "✏️ 편집"; }
  }

  /* ---------------- 선택 모델 (다중) ---------------- */
  function addOne(el) {
    if (selected.indexOf(el) >= 0) return;
    el.classList.add("sel-elem"); selected.push(el);
  }
  function setSel(list) { clearSel(); list.forEach(addOne); finishSel(); }
  function toggleOne(el) {
    var i = selected.indexOf(el);
    if (i >= 0) { el.classList.remove("sel-elem"); removeHandles(el); selected.splice(i, 1); }
    else addOne(el);
    finishSel();
  }
  function clearSel() {
    stopTextEdit(); // 선택 해제 시 텍스트 편집도 종료 (Delete 키 오인 방지)
    selected.forEach(function (el) { el.classList.remove("sel-elem"); removeHandles(el); });
    selected = [];
  }
  function deselect() { clearSel(); }
  function finishSel() {
    selected.forEach(function (el) { removeHandles(el); });
    if (selected.length === 1) addHandles(selected[0]);  // 핸들은 단일 선택일 때만
  }

  /* 실제 이동/크기조절 시점에만 absolute 전환.
     투명 플레이스홀더를 남겨 다른 요소가 재배치되지 않도록 한다. */
  function absolutize(el) {
    if (el.dataset.abs) return;
    var L = el.offsetLeft, T = el.offsetTop, W = el.offsetWidth, H = el.offsetHeight;
    var cs = getComputedStyle(el);
    var ph = document.createElement("div");
    ph.className = "ph-spacer";
    ph.style.width = W + "px"; ph.style.height = H + "px";
    ph.style.margin = cs.margin; ph.style.flexShrink = "0";
    el.parentNode.insertBefore(ph, el);
    el._ph = ph;
    el.style.position = "absolute";
    el.style.left = L + "px"; el.style.top = T + "px"; el.style.width = W + "px";
    el.style.margin = "0"; el.style.zIndex = "4";
    el.dataset.abs = "1";
  }

  /* ---------------- 마우스 다운: 선택 / 이동 / 고무줄 ---------------- */
  function onStageDown(e) {
    if (!editMode) return;
    // 포커스를 뷰포트로 가져와 Delete/Ctrl+V 키 입력이 앱 문서에 도달하게 한다
    try { viewport.focus({ preventScroll: true }); } catch (err) {}
    if (e.target.closest(".rs-handle")) return;
    if (e.target.isContentEditable) return;
    var block = e.target.closest(SELECTABLE);
    if (block && stage.contains(block)) {
      if (e.shiftKey) { toggleOne(block); e.preventDefault(); return; }  // Shift+클릭: 다중선택
      if (selected.indexOf(block) < 0) setSel([block]);
      startMove(e);
    } else {
      if (!e.shiftKey) deselect();
      startMarquee(e);
    }
  }
  function onStageDblClick(e) {
    if (!editMode) return;
    var tb = e.target.closest(TEXTBLOCK);
    if (!tb || !stage.contains(tb)) return;
    startTextEdit(tb);
  }

  /* ---------------- 텍스트 편집 ---------------- */
  function startTextEdit(el) {
    setSel([el]);
    removeHandles(el);
    textEl = el;
    el.setAttribute("contenteditable", "true");
    el.focus();
    var r = document.createRange(); r.selectNodeContents(el);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function stopTextEdit() {
    if (textEl) {
      try { textEl.blur(); } catch (e) {}
      textEl.removeAttribute("contenteditable");
      textEl = null;
    }
    var ae = document.activeElement;
    if (ae && ae.isContentEditable) { try { ae.blur(); } catch (e) {} }
  }

  /* ---------------- 이동 (다중 · Shift 축고정 · 임계값 후 absolute 전환) ---------------- */
  function startMove(e) {
    var sc = scale(), sx = e.clientX, sy = e.clientY, started = false;
    var bases = selected.map(function (el) {
      var abs = !!el.dataset.abs;
      return { el: el, l: abs ? (parseFloat(el.style.left) || 0) : el.offsetLeft, t: abs ? (parseFloat(el.style.top) || 0) : el.offsetTop };
    });
    function mv(ev) {
      var dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
      if (!started) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;   // 클릭만으로는 위치 변경 없음
        started = true;
        bases.forEach(function (b) { absolutize(b.el); });
      }
      if (ev.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }  // Shift: 직선 이동
      bases.forEach(function (b) { b.el.style.left = (b.l + dx) + "px"; b.el.style.top = (b.t + dy) + "px"; });
    }
    function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    e.preventDefault();
  }

  /* ---------------- 고무줄(드래그) 다중 선택 ---------------- */
  function startMarquee(e) {
    var slide = stage.querySelector(".slide[data-deck-active]"); if (!slide) return;
    var rect = slide.getBoundingClientRect(), sc = rect.width / 1920;
    var x0 = (e.clientX - rect.left) / sc, y0 = (e.clientY - rect.top) / sc;
    var mq = document.createElement("div"); mq.className = "marquee"; slide.appendChild(mq);
    var box = null;
    function mv(ev) {
      var x1 = (ev.clientX - rect.left) / sc, y1 = (ev.clientY - rect.top) / sc;
      var l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      mq.style.left = l + "px"; mq.style.top = t + "px"; mq.style.width = w + "px"; mq.style.height = h + "px";
      box = { l: l, t: t, r: l + w, b: t + h };
    }
    function up() {
      document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up);
      mq.remove();
      if (!box || (box.r - box.l < 8) || (box.b - box.t < 8)) return;
      var frame = slide.querySelector(".frame") || slide;
      var blocks = Array.prototype.slice.call(frame.querySelectorAll(SELECTABLE));
      var hit = blocks.filter(function (el) {
        if (el.closest(".rs-handle")) return false;
        var bl = el.offsetLeft, bt = el.offsetTop, bw = el.offsetWidth, bh = el.offsetHeight;
        return !(bl > box.r || bl + bw < box.l || bt > box.b || bt + bh < box.t);
      });
      hit = hit.filter(function (el) { return !hit.some(function (o) { return o !== el && o.contains(el); }); });
      if (e.shiftKey) { hit.forEach(addOne); finishSel(); }
      else setSel(hit);
    }
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    e.preventDefault();
  }

  /* ---------------- 크기조절 핸들 (단일 · Shift 비율유지) ---------------- */
  function addHandles(el) {
    ["nw", "ne", "sw", "se", "n", "s", "e", "w"].forEach(function (c) {
      var h = document.createElement("div");
      h.className = "rs-handle rs-" + c; h.dataset.c = c; h.setAttribute("contenteditable", "false");
      h.addEventListener("mousedown", function (ev) { startResize(ev, el, c); });
      el.appendChild(h);
    });
  }
  function removeHandles(el) {
    Array.prototype.slice.call(el.querySelectorAll(".rs-handle")).forEach(function (h) { h.remove(); });
  }
  function startResize(e, el, c) {
    e.preventDefault(); e.stopPropagation();
    absolutize(el);   // 크기조절 시작 시점에 전환(플레이스홀더 유지)
    var sc = scale(), sx = e.clientX, sy = e.clientY;
    var W = el.offsetWidth, H = el.offsetHeight, L = parseFloat(el.style.left) || 0, T = parseFloat(el.style.top) || 0;
    var ratio = W / (H || 1);
    if (!el.style.height) el.style.height = H + "px";
    function mv(ev) {
      var dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
      var w = W, h = H, l = L, t = T;
      if (c.indexOf("e") >= 0) w = Math.max(40, W + dx);
      if (c.indexOf("w") >= 0) { w = Math.max(40, W - dx); l = L + (W - w); }
      if (c.indexOf("s") >= 0) h = Math.max(30, H + dy);
      if (c.indexOf("n") >= 0) { h = Math.max(30, H - dy); t = T + (H - h); }
      if (ev.shiftKey && c.length === 2) {            // Shift: 비율 유지
        h = w / ratio;
        if (c.indexOf("n") >= 0) t = T + (H - h);
        if (c.indexOf("w") >= 0) l = L + (W - w);
      }
      el.style.width = w + "px"; el.style.height = h + "px"; el.style.left = l + "px"; el.style.top = t + "px";
    }
    function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  }

  /* ---------------- 키보드: 복사/잘라내기/붙여넣기/삭제 (다중) ---------------- */
  document.addEventListener("keydown", function (e) {
    if (!editMode) return;
    var ae = document.activeElement;
    var typing = (e.target && e.target.isContentEditable) || (ae && ae.isContentEditable);
    var k = e.key.toLowerCase();
    if (typing) { if (e.key === "Escape") stopTextEdit(); return; }   // 텍스트 편집 중엔 브라우저 기본 실행취소
    if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { if (undo()) e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "c" && selected.length) { copySel(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && k === "x" && selected.length) { copySel(); removeSel(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && k === "v") {
      // OS 클립보드 이미지 붙여넣기가 먼저 기회를 갖도록 paste 이벤트를 기다린다
      pendingPaste = true;
      setTimeout(function () { if (pendingPaste && clip.length) pasteClip(); pendingPaste = false; }, 90);
    }
    else if ((e.ctrlKey || e.metaKey) && k === "a" && editMode) {     // 전체 선택
      var slide = stage.querySelector(".slide[data-deck-active]"); var frame = slide && (slide.querySelector(".frame") || slide);
      if (frame) { var bl = Array.prototype.slice.call(frame.querySelectorAll(SELECTABLE)).filter(function (el) { return !el.closest(".rs-handle"); }); bl = bl.filter(function (el) { return !bl.some(function (o) { return o !== el && o.contains(el); }); }); setSel(bl); }
      e.preventDefault();
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) { removeSel(); e.preventDefault(); }
    else if (e.key === "Escape") deselect();
  });
  var pendingPaste = false;
  /* OS 클립보드의 이미지 붙여넣기 (Ctrl+V) */
  document.addEventListener("paste", function (e) {
    if (!editMode) return;
    if (e.target && e.target.isContentEditable) return; // 텍스트 편집 중엔 기본 동작
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") === 0) {
        var f = items[i].getAsFile();
        if (!f) continue;
        pendingPaste = false;
        e.preventDefault();
        var fr = new FileReader();
        fr.onload = function () { insertImage(fr.result); };
        fr.readAsDataURL(f);
        return;
      }
    }
  });
  function insertImage(src) {
    var slide = stage.querySelector(".slide[data-deck-active]");
    var frame = slide && (slide.querySelector(".frame") || slide); if (!frame) return;
    snapshot();
    var wrap = document.createElement("div");
    wrap.className = "pasted-img";
    wrap.dataset.abs = "1";
    wrap.style.cssText = "position:absolute;left:560px;top:240px;width:800px;z-index:4";
    var im = document.createElement("img");
    im.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;border-radius:24px";
    // 래퍼를 이미지 비율에 맞춰 → 잘림 없이 여백도 없이 영역을 채운다.
    im.onload = function () { if (im.naturalWidth && im.naturalHeight) wrap.style.aspectRatio = im.naturalWidth + " / " + im.naturalHeight; };
    im.src = src;
    wrap.appendChild(im);
    frame.appendChild(wrap);
    setSel([wrap]);
    if (document.activeElement && document.activeElement.blur) { try { document.activeElement.blur(); } catch (e) {} }
    try { viewport.focus({ preventScroll: true }); } catch (e) {}
  }

  function copySel() {
    clip = selected.map(function (el) { var c = el.cloneNode(true); c.classList.remove("sel-elem"); removeHandles(c); return c; });
  }
  function removeSel() {
    if (!selected.length) return;
    snapshot();
    selected.slice().forEach(function (el) { if (el._ph) el._ph.remove(); el.remove(); });
    selected = [];
  }
  function pasteClip() {
    var slide = stage.querySelector(".slide[data-deck-active]");
    var frame = slide && (slide.querySelector(".frame") || slide); if (!frame) return;
    snapshot();
    var added = [];
    clip.forEach(function (node) {
      var n = node.cloneNode(true);
      reassignSlots(n);
      var L = (parseFloat(n.style.left) || 80) + 40, T = (parseFloat(n.style.top) || 80) + 40;
      n.style.position = "absolute"; n.style.left = L + "px"; n.style.top = T + "px"; n.dataset.abs = "1";
      frame.appendChild(n); added.push(n);
    });
    setSel(added);
  }
  function reassignSlots(node) {
    var slots = node.tagName === "IMAGE-SLOT" ? [node] : Array.prototype.slice.call(node.querySelectorAll("image-slot"));
    slots.forEach(function (s) {
      var src = slotSrc(s.id) || s.getAttribute("src") || "";
      s.id = (s.id || "slot") + "-c" + (++copyN);
      if (src) s.setAttribute("src", src);
    });
  }

  /* ---------------- 서식 툴바 ---------------- */
  function buildToolbar() {
    toolbar = document.getElementById("deck-toolbar");
    if (!toolbar) return;
    // 이미지 추가 버튼 (파일 선택 → 현재 슬라이드에 삽입)
    var imgBtn = toolbar.querySelector("#btn-insert-img");
    if (imgBtn && !imgBtn._wired) {
      imgBtn._wired = true;
      var fin = document.createElement("input");
      fin.type = "file"; fin.accept = "image/*"; fin.hidden = true;
      document.body.appendChild(fin);
      imgBtn.addEventListener("click", function () { fin.click(); });
      fin.addEventListener("change", function () {
        var f = fin.files && fin.files[0]; if (!f) return;
        var fr = new FileReader();
        fr.onload = function () { insertImage(fr.result); };
        fr.readAsDataURL(f);
        fin.value = "";
      });
    }
    // 선택 삭제 버튼 (키보드 입력이 막힌 환경 대비)
    var delBtn = toolbar.querySelector("#btn-del-elem");
    if (delBtn && !delBtn._wired) {
      delBtn._wired = true;
      delBtn.addEventListener("click", function () { if (selected.length) removeSel(); });
    }
    toolbar.addEventListener("mousedown", function (e) {
      if (e.target.tagName !== "SELECT" && e.target.tagName !== "INPUT") e.preventDefault();
    });
    toolbar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cmd]"); if (!b) return;
      restore(); doCmd(b.dataset.cmd, b.dataset.val);
    });
    var fontSel = toolbar.querySelector("#tb-font");
    var sizeSel = toolbar.querySelector("#tb-size");
    if (fontSel) fontSel.addEventListener("change", function () { restore(); applyStyle({ fontFamily: fontSel.value }); });
    if (sizeSel) sizeSel.addEventListener("change", function () { restore(); applyStyle({ fontSize: sizeSel.value + "px" }); });
    var fg = toolbar.querySelector("#tb-color");
    if (fg) fg.addEventListener("input", function () { restore(); document.execCommand("styleWithCSS", false, true); document.execCommand("foreColor", false, fg.value); });
  }
  function restore() { if (savedRange) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); } }
  function focusedEditable() {
    var n = savedRange && savedRange.startContainer; n = n && (n.nodeType === 1 ? n : n.parentElement);
    return n && n.closest("[contenteditable=true]");
  }
  function doCmd(cmd, val) {
    document.execCommand("styleWithCSS", false, true);
    if (cmd === "hilite") { document.execCommand("hiliteColor", false, val); return; }
    if (cmd === "color") { document.execCommand("foreColor", false, val); return; }
    document.execCommand(cmd, false, val || null);
  }
  function applyStyle(styleObj) {
    var s = window.getSelection();
    if (!s || !s.rangeCount) { var fe = focusedEditable(); if (fe) Object.assign(fe.style, styleObj); return; }
    var range = s.getRangeAt(0);
    if (range.collapsed) { var fe2 = focusedEditable(); if (fe2) Object.assign(fe2.style, styleObj); return; }
    var span = document.createElement("span");
    Object.keys(styleObj).forEach(function (k) { span.style[k] = styleObj[k]; });
    try { range.surroundContents(span); }
    catch (e) { var frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
    s.removeAllRanges();
  }

  /* ---------------- 실행취소 (구조 변경 스냅샷) ---------------- */
  // 구조 변경 직전에 스테이지 전체를 저장. Ctrl+Z 로 직전 상태 복원.
  function snapshot() {
    if (!stage || !ctrl) return;
    var clone = stage.cloneNode(true);
    // 슬롯에 올린 이미지(src) 보존, 편집 잔여물 제거
    Array.prototype.slice.call(clone.querySelectorAll("image-slot")).forEach(function (s) {
      var src = slotSrc(s.id); if (src) s.setAttribute("src", src);
    });
    Array.prototype.slice.call(clone.querySelectorAll(".rs-handle,.marquee")).forEach(function (x) { x.remove(); });
    Array.prototype.slice.call(clone.querySelectorAll(".sel-elem")).forEach(function (x) { x.classList.remove("sel-elem"); });
    undoStack.push({ html: clone.innerHTML, index: ctrl.index });
    if (undoStack.length > 30) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return false;
    var snap = undoStack.pop();
    deselect();
    stage.innerHTML = snap.html;
    buildRail();
    var n = ctrl.slidesNow().length;
    ctrl.sync(Math.max(0, Math.min(snap.index, n - 1)));
    return true;
  }

  /* ---------------- 슬라이드 복제/삭제/추가 ---------------- */
  function dupSlide(i) {
    var slides = ctrl.slidesNow(); var s = slides[i]; if (!s) return;
    snapshot();
    var clone = s.cloneNode(true);
    clone.querySelectorAll(".sel-elem").forEach(function (x) { x.classList.remove("sel-elem"); });
    clone.querySelectorAll(".rs-handle").forEach(function (x) { x.remove(); });
    reassignSlots(clone);
    s.parentNode.insertBefore(clone, s.nextSibling);
    buildRail(); ctrl.goTo(i + 1);
  }
  function delSlide(i) {
    var slides = ctrl.slidesNow(); if (slides.length <= 1) { alert("마지막 슬라이드는 삭제할 수 없어요."); return; }
    snapshot();
    slides[i].remove();
    buildRail(); ctrl.sync(Math.min(i, ctrl.slidesNow().length - 1));
  }
  function addSlide() {
    var i = ctrl.index; var slides = ctrl.slidesNow();
    snapshot();
    var sec = document.createElement("section");
    sec.className = "slide kind-content"; sec.setAttribute("data-screen-label", "새 슬라이드");
    sec.setAttribute("style", "--accent:var(--sky)");
    sec.innerHTML = ((window.KBuilder && window.KBuilder.logoHTML) ? window.KBuilder.logoHTML() : '') +
      '<div class="frame"><span class="eyebrow"><span class="dot"></span>새 슬라이드</span>' +
      '<h2 class="slidetitle">제목을 입력하세요</h2>' +
      '<div class="cols solo"><div class="col-main"><ul class="items"><li><span class="chk">✓</span><span>내용을 입력하세요</span></li></ul></div></div></div>';
    slides[i].parentNode.insertBefore(sec, slides[i].nextSibling);
    buildRail(); ctrl.goTo(i + 1);
  }

  /* ---------------- 썸네일 레일 ---------------- */
  function buildRail() {
    if (!rail) return;
    rail.innerHTML = "";
    ctrl.slidesNow().forEach(function (sl, i) {
      var thumb = document.createElement("div"); thumb.className = "rail-thumb"; thumb.dataset.i = i;
      var box = document.createElement("div"); box.className = "rail-box";
      var clone = sl.cloneNode(true);
      clone.style.display = "block"; clone.removeAttribute("data-deck-active");
      clone.querySelectorAll(".rs-handle").forEach(function (x) { x.remove(); });
      clone.querySelectorAll(".sel-elem").forEach(function (x) { x.classList.remove("sel-elem"); });
      clone.querySelectorAll(".marquee").forEach(function (x) { x.remove(); });
      Array.prototype.slice.call(clone.querySelectorAll("image-slot")).forEach(function (s) {
        var src = slotSrc(s.id) || s.getAttribute("src") || "";
        var d = document.createElement("div"); d.setAttribute("style", "width:100%;height:100%;overflow:hidden;background:#f3eee0"); d.className = s.className;
        if (src) { var im = document.createElement("img"); im.src = src; im.setAttribute("style", "width:100%;height:100%;object-fit:" + (s.getAttribute("fit") || "contain")); d.appendChild(im); }
        s.parentNode.replaceChild(d, s);
      });
      box.appendChild(clone);
      var no = document.createElement("div"); no.className = "rail-no"; no.textContent = i + 1;
      var acts = document.createElement("div"); acts.className = "rail-acts";
      acts.innerHTML = '<button data-a="dup" title="복제">⧉</button><button data-a="add" title="새 슬라이드">＋</button><button data-a="del" title="삭제">🗑</button>';
      thumb.appendChild(no); thumb.appendChild(box); thumb.appendChild(acts);
      thumb.addEventListener("click", function (e) {
        var ab = e.target.closest("[data-a]");
        if (ab) { e.stopPropagation(); if (ab.dataset.a === "dup") dupSlide(i); else if (ab.dataset.a === "del") delSlide(i); else if (ab.dataset.a === "add") { ctrl.goTo(i); addSlide(); } return; }
        ctrl.goTo(i);
      });
      rail.appendChild(thumb);
    });
    markRail(ctrl.index);
    if (window.KBuilder.applyLogo) window.KBuilder.applyLogo(); // 로고 상태를 본문/레일에 반영
  }
  function markRail(i) {
    if (!rail) return;
    Array.prototype.slice.call(rail.querySelectorAll(".rail-thumb")).forEach(function (t) {
      var on = +t.dataset.i === i; t.classList.toggle("active", on);
      if (on) rail.scrollTop = Math.max(0, t.offsetTop - rail.clientHeight / 2 + t.clientHeight / 2);
    });
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.editor = {
    init: init, setEdit: setEdit, buildRail: buildRail,
    dupSlide: function () { dupSlide(ctrl.index); },
    delSlide: function () { delSlide(ctrl.index); },
    addSlide: addSlide,
    snapshot: snapshot, undo: undo,   // 레이아웃 교체 등 외부 구조변경 전 호출 / Ctrl+Z
    isEditing: function () { return editMode; }
  };
})();
