/* print.js — 결과 화면 ⤓ PDF: 보고 있는 탭(교수안·슬라이드·교안 MD)만 인쇄 — 슬라이드는 16:9 한 장 한 페이지, 문서는 A4 세로 */
(function () {
  "use strict";

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
})();
