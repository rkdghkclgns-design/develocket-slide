/* ref-images.js — 참고 이미지(복수) 저장소 + 인트로 트레이 + 슬롯 삽입 피커
   업로드/AI로 모은 참고 이미지를 교수안 문서·슬라이드·내보내기에 함께 인용한다.
   - window.KBuilder.refImages            : 현재 참고 이미지 배열 (읽기용)
   - window.KBuilder.refImagesAdd(files)  : 파일(복수) 추가
   - window.KBuilder.refImagesAddUrl(url) : dataURL 직접 추가
   - window.KBuilder.refImagesRemove(id)  : 제거
   - window.KBuilder.refImagesSet(list)   : 일괄 교체(불러오기 복원)
   - window.KBuilder.getRefImages()       : [{name,url}] (내보내기 내장용)
   - window.KBuilder.onRefImagesChange(fn): 변경 구독
   - window.KBuilder.pickRefImage()       : Promise<url|null> (슬롯 삽입 모달)
   - window.KBuilder.refDownscale(file)   : Promise<dataURL> (붙여넣기 등 재사용) */
(function () {
  "use strict";
  var K = window.KBuilder = window.KBuilder || {};
  var esc = function (s) { return K.escapeHtml ? K.escapeHtml(s == null ? "" : s) : String(s == null ? "" : s); };

  var refs = [];          // [{id, name, url}]
  var subs = [];
  var seq = 0;
  var MAX = 24;           // 과도한 메모리·내보내기 용량 방지
  var MAX_DIM = 1400;

  K.refImages = refs;     // 라이브 배열 — refImagesSet도 같은 참조를 유지한다
  function notify() { subs.forEach(function (fn) { try { fn(refs.slice()); } catch (e) {} }); }
  K.onRefImagesChange = function (fn) { if (typeof fn === "function") { subs.push(fn); try { fn(refs.slice()); } catch (e) {} } };

  /* 다운스케일 → webp dataURL (실패 시 원본 dataURL 폴백) */
  function downscale(file) {
    return new Promise(function (resolve, reject) {
      if (!file || String(file.type).indexOf("image/") !== 0) { reject(new Error("이미지 파일이 아닙니다.")); return; }
      var rawRead = function () {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result)); };
        fr.onerror = function () { reject(new Error("이미지를 읽지 못했습니다.")); };
        fr.readAsDataURL(file);
      };
      // GIF는 재인코딩 시 애니메이션이 사라지므로 원본 유지
      if (typeof createImageBitmap !== "function" || file.type === "image/gif") { rawRead(); return; }
      createImageBitmap(file).then(function (bm) {
        try {
          var scale = Math.min(1, MAX_DIM / Math.max(bm.width, bm.height));
          var w = Math.max(1, Math.round(bm.width * scale));
          var h = Math.max(1, Math.round(bm.height * scale));
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(bm, 0, 0, w, h);
          if (bm.close) bm.close();
          resolve(cv.toDataURL("image/webp", 0.85));
        } catch (e) { rawRead(); }
      }, rawRead);
    });
  }
  K.refDownscale = downscale;

  function addFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []).filter(function (f) { return f && String(f.type).indexOf("image/") === 0; });
    if (!arr.length) return Promise.resolve();
    return arr.reduce(function (chain, f) {
      return chain.then(function () {
        if (refs.length >= MAX) return;
        return downscale(f).then(function (url) {
          refs.push({ id: "ref" + (++seq), name: f.name || ("이미지 " + (refs.length + 1)), url: url });
        }).catch(function () { /* 개별 파일 실패는 건너뛴다 */ });
      });
    }, Promise.resolve()).then(notify);
  }
  K.refImagesAdd = addFiles;

  K.refImagesAddUrl = function (url, name) {
    if (!url || refs.length >= MAX) return;
    refs.push({ id: "ref" + (++seq), name: name || ("이미지 " + (refs.length + 1)), url: url });
    notify();
  };
  K.refImagesRemove = function (id) {
    for (var i = 0; i < refs.length; i++) { if (refs[i].id === id) { refs.splice(i, 1); break; } }
    notify();
  };
  K.refImagesSet = function (list) {
    refs.length = 0; // 같은 배열 참조 유지
    (list || []).forEach(function (r) {
      if (r && r.url && /^(data:image\/|https?:)/i.test(r.url)) {
        refs.push({ id: "ref" + (++seq), name: r.name || "이미지", url: r.url });
      }
    });
    notify();
  };
  K.getRefImages = function () { return refs.map(function (r) { return { name: r.name, url: r.url }; }); };

  /* ---------- 인트로 트레이 (양 모드 공통 노출) ---------- */
  function renderTray(mount) {
    if (!mount) return;
    var thumbs = refs.map(function (r) {
      return '<div class="ref-thumb" title="' + esc(r.name) + '">' +
        '<img src="' + esc(r.url) + '" alt="' + esc(r.name) + '" />' +
        '<button class="ref-rm" data-id="' + esc(r.id) + '" type="button" title="제거">×</button></div>';
    }).join("");
    mount.innerHTML =
      '<div class="ref-tray-head">📎 참고 이미지' +
      '<span class="ref-tray-sub">교수안 문서·슬라이드·내보내기에 함께 담깁니다 (여러 장 추가 가능)</span></div>' +
      '<div class="ref-tray-grid">' + thumbs +
      '<button class="ref-add" type="button">＋ 이미지 추가</button></div>';
  }

  function initTray() {
    var mount = document.getElementById("ref-tray");
    if (!mount) return;
    var input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.multiple = true; input.hidden = true;
    document.body.appendChild(input); // 트레이 innerHTML 갱신에도 살아남도록 body에 보관
    input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
    // 위임 — 트레이 내용은 매 변경마다 다시 그려지므로 mount에 한 번만 바인딩
    mount.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest(".ref-add")) { input.click(); return; }
      var rm = t && t.closest && t.closest(".ref-rm");
      if (rm) K.refImagesRemove(rm.getAttribute("data-id"));
    });
    K.onRefImagesChange(function () { renderTray(mount); });
  }

  /* ---------- 슬롯 삽입 피커 모달 ---------- */
  K.pickRefImage = function () {
    return new Promise(function (resolve) {
      if (!refs.length) { alert("먼저 시작 화면에서 ‘참고 이미지’를 추가해 주세요."); resolve(null); return; }
      var ov = document.createElement("div");
      ov.className = "ref-pick-ov";
      var box = document.createElement("div");
      box.className = "ref-pick-box";
      box.innerHTML = '<div class="ref-pick-head"><span>참고 이미지 선택</span>' +
        '<button class="ref-pick-x" type="button" title="닫기">×</button></div>';
      var grid = document.createElement("div");
      grid.className = "ref-pick-grid";
      var done = false;
      function cleanup() { if (done) return; done = true; document.removeEventListener("keydown", onKey, true); if (ov.parentNode) ov.parentNode.removeChild(ov); }
      function onKey(e) { if (e.key === "Escape") { cleanup(); resolve(null); } }
      refs.forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ref-pick-item"; b.title = r.name;
        var im = document.createElement("img"); im.src = r.url; im.alt = r.name;
        b.appendChild(im);
        b.addEventListener("click", function () { cleanup(); resolve(r.url); });
        grid.appendChild(b);
      });
      box.appendChild(grid);
      ov.appendChild(box);
      ov.addEventListener("click", function (e) { if (e.target === ov) { cleanup(); resolve(null); } });
      box.querySelector(".ref-pick-x").addEventListener("click", function () { cleanup(); resolve(null); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(ov);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initTray);
  else initTray();
})();
