/* review-paste.js — 검토 화면 MD 칸에 이미지 붙여넣기(Ctrl+V) → 커서 자리에 ![](dataURL) 삽입, 빌드할 때 그림으로 렌더링 */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});

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
})();
