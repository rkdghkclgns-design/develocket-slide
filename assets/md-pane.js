/* md-pane.js — 결과 화면 '📄 교안 MD' 탭
 *   생성한 교수안·슬라이드 편성안(과정 설계는 교재까지)을 마크다운 파일 그대로 — 렌더링 / 원문, 이 MD · 모든 부 MD 내려받기
 *   지금 결과는 K.app.currentMd() (main.js) 에서 읽는다. K.mdPane.render() 는 결과를 다시 만들 때 main.js 가 부른다. */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  /* [키, 탭 이름, 파일 이름, 부(part)의 필드] */
  /* 학습자용 교안(기존 교안 양식)이 있으면 맨 앞 — 과정 설계에서 빌드한 경우 */
  var FILES = [["text", "📘 교안(교재).md", "교안(교재)", "textMd"], ["doc", "📖 교수안.md", "교수안", "docMd"], ["deck", "🎬 슬라이드 편성안.md", "슬라이드 편성안", "deckMd"]];
  var st = { file: "text", view: "render" };

  function current() { return K.app && K.app.currentMd ? K.app.currentMd() : { doc: "", deck: "", text: "", parts: null, part: null }; }
  /* 자동 이미지 표시([이미지:id])를 그림으로 — 렌더링·내려받기용 (원문 보기는 표시 그대로) */
  function withImages(md) { return K.autoImages ? K.autoImages.expandTags(md) : md; }
  function info(key) { return FILES.filter(function (f) { return f[0] === key; })[0] || FILES[0]; }
  function el(id) { return document.getElementById(id); }

  function render() {
    var src = current();
    var have = FILES.filter(function (f) { return String(src[f[0]] || "").trim(); });
    if (!have.some(function (f) { return f[0] === st.file; })) st.file = have.length ? have[0][0] : "doc";
    el("md-files").innerHTML = have.map(function (f) {
      return '<button type="button" class="md-file' + (f[0] === st.file ? " on" : "") + '" data-mdfile="' + f[0] + '">' + f[1] + "</button>";
    }).join("");
    var text = src[st.file] || "";
    el("md-mount").hidden = st.view !== "render";
    el("md-raw").hidden = st.view !== "raw";
    if (st.view === "render") el("md-mount").innerHTML = K.renderMarkdown ? K.renderMarkdown(withImages(text)) : "";
    else el("md-raw").textContent = text;
    document.querySelectorAll("#md-pane [data-mdview]").forEach(function (b) { b.classList.toggle("on", b.dataset.mdview === st.view); });
    el("btn-md-dl-all").hidden = !src.parts;
  }

  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function suffix(part) { return part ? " - " + String(part.label || "").replace(/[\\/:*?"<>|]+/g, " ").trim() : ""; }

  function wire() {
    var pane = el("md-pane");
    if (!pane) return;
    pane.addEventListener("click", function (e) {
      var f = e.target.closest("[data-mdfile]"), v = e.target.closest("[data-mdview]");
      if (f) { st.file = f.dataset.mdfile; render(); }
      else if (v) { st.view = v.dataset.mdview; render(); }
    });
    el("btn-md-dl").addEventListener("click", function () {
      var src = current(), text = src[st.file];
      if (text) download(info(st.file)[2] + suffix(src.part) + ".md", withImages(text));
    });
    /* 모든 부(차시)의 같은 종류 MD 를 한 파일로 — 부마다 프론트매터는 떼고 구분선으로 잇는다 */
    el("btn-md-dl-all").addEventListener("click", function () {
      var src = current(), f = info(st.file);
      if (!src.parts) return;
      var body = src.parts.map(function (p) {
        return String(p[f[3]] || "").replace(/^﻿?---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
      }).filter(Boolean).join("\n\n---\n\n");
      if (body) download(f[2] + " - 전체.md", withImages(body) + "\n");
    });
  }

  K.mdPane = { render: render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
