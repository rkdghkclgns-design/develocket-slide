/* md-editor.js — 마크다운 입력칸 (소스 원고·메모 textarea.source-text)
 *   서식 도구(제목·굵게·기울임·목록·번호·체크·인용·코드·표·링크) + 렌더링 미리 보기(작성 / 나란히 / 미리 보기)
 *   textarea 가 원본이다 — 파일 올리기·AI 작성처럼 값을 코드로 바꿔도 미리 보기가 따라간다.
 *   목록 줄에서 Enter 를 누르면 다음 항목 기호를 이어 붙인다(빈 항목에서 Enter 는 목록 끝내기). */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var VIEW_KEY = "kb-md-view";
  var VIEWS = [["write", "✎ 작성"], ["split", "◫ 나란히"], ["preview", "👁 미리 보기"]];
  var LIST_LINE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

  function savedView() {
    var v = null;
    try { v = localStorage.getItem(VIEW_KEY); } catch (e) {}
    if (VIEWS.some(function (x) { return x[0] === v; })) return v;
    return window.innerWidth >= 900 ? "split" : "write";
  }

  /* ---------- 편집: 실행 취소가 되도록 insertText 를 우선 쓰고, 안 되면 setRangeText ---------- */
  function replaceRange(ta, start, end, text, selStart, selEnd) {
    ta.focus();
    ta.setSelectionRange(start, end);
    var ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
    if (!ok) {
      ta.setRangeText(text, start, end, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    ta.setSelectionRange(selStart != null ? selStart : start + text.length, selEnd != null ? selEnd : start + text.length);
  }

  function wrap(ta, before, after, placeholder) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var sel = v.slice(s, e);
    if (sel && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replaceRange(ta, s - before.length, e + after.length, sel, s - before.length, e - before.length);
      return;
    }
    var body = sel || placeholder;
    replaceRange(ta, s, e, before + body + after, s + before.length, s + before.length + body.length);
  }

  /* 선택한 줄마다 앞머리를 붙이거나(모두 같은 앞머리면) 뗀다 — 들여쓰기는 그대로, 다른 목록 기호는 바꿔 단다 */
  var ANY_LIST = /^([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/;
  function prefixLines(ta, make, strip, clear) {
    var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    if (b > a && v[b - 1] === "\n") b--;
    var s = a ? v.lastIndexOf("\n", a - 1) + 1 : 0;
    var eIdx = v.indexOf("\n", b);
    var e = eIdx === -1 ? v.length : eIdx;
    var lines = v.slice(s, e).split("\n");
    var filled = lines.filter(function (l) { return l.trim(); });
    var all = filled.length > 0 && filled.every(function (l) { return strip.test(l.replace(/^\s*/, "")); });
    var n = 0;
    var out = lines.map(function (l) {
      if (!l.trim() && lines.length > 1) return l;
      var ind = l.match(/^\s*/)[0], rest = l.slice(ind.length);
      return all ? ind + rest.replace(strip, "") : ind + make(++n) + rest.replace(clear || strip, "");
    }).join("\n");
    replaceRange(ta, s, e, out, s, s + out.length);
  }

  var TOOLS = [
    { label: "제목", title: "제목 (## )", run: function (ta) { prefixLines(ta, function () { return "## "; }, /^#{1,6}\s+/); } },
    { label: "<b>B</b>", title: "굵게 (Ctrl+B)", run: function (ta) { wrap(ta, "**", "**", "굵은 글씨"); } },
    { label: "<i>I</i>", title: "기울임 (Ctrl+I)", run: function (ta) { wrap(ta, "*", "*", "기울인 글씨"); } },
    { label: "• 목록", title: "글머리표 목록", run: function (ta) { prefixLines(ta, function () { return "- "; }, /^[-*+]\s+(?!\[[ xX]\])/, ANY_LIST); } },
    { label: "1. 번호", title: "번호 목록", run: function (ta) { prefixLines(ta, function (n) { return n + ". "; }, /^\d+[.)]\s+/, ANY_LIST); } },
    { label: "☐ 체크", title: "체크 목록", run: function (ta) { prefixLines(ta, function () { return "- [ ] "; }, /^[-*+]\s+\[[ xX]\]\s+/, ANY_LIST); } },
    { label: "❝ 인용", title: "인용", run: function (ta) { prefixLines(ta, function () { return "> "; }, /^>\s?/); } },
    { label: "&lt;/&gt; 코드", title: "코드 (여러 줄이면 코드 블록)", run: function (ta) {
      var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && sel.indexOf("\n") === -1) { wrap(ta, "`", "`", "코드"); return; }
      var s = ta.selectionStart, pre = s && ta.value[s - 1] !== "\n" ? "\n" : "";
      var body = sel || "코드";
      replaceRange(ta, s, ta.selectionEnd, pre + "```\n" + body + "\n```\n", s + pre.length + 4, s + pre.length + 4 + body.length);
    } },
    { label: "▦ 표", title: "표 넣기", run: function (ta) {
      var s = ta.selectionStart, pre = s && ta.value[s - 1] !== "\n" ? "\n\n" : "";
      var t = "| 항목 | 내용 |\n|---|---|\n| 항목 | 내용 |\n";
      replaceRange(ta, s, ta.selectionEnd, pre + t, s + pre.length + 2, s + pre.length + 4);
    } },
    { label: "🔗 링크", title: "링크 (Ctrl+K)", run: function (ta) { wrap(ta, "[", "](https://)", "링크 글자"); } }
  ];

  /* 목록 줄에서 Enter → 다음 항목 기호 이어 붙이기, 빈 항목이면 기호를 지우고 목록 끝내기 */
  function onEnter(ta, e) {
    if (e.isComposing || e.keyCode === 229 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    var v = ta.value, pos = ta.selectionStart;
    var ls = pos ? v.lastIndexOf("\n", pos - 1) + 1 : 0;
    var m = v.slice(ls, pos).match(LIST_LINE);
    if (!m) return;
    e.preventDefault();
    if (!m[5].trim()) { replaceRange(ta, ls, pos, m[1]); return; }
    var mark = /\d/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].replace(/\d+/, "") : m[2];
    var ins = "\n" + m[1] + mark + m[3] + (m[4] ? "[ ] " : "");
    replaceRange(ta, pos, pos, ins);
  }

  function enhance(ta) {
    if (!ta || ta.dataset.mdx) return;
    ta.dataset.mdx = "1";
    var box = document.createElement("div");
    box.className = "mdx";
    box.innerHTML = '<div class="mdx-bar"><div class="mdx-tools" role="toolbar" aria-label="마크다운 서식">' +
      TOOLS.map(function (t, i) { return '<button type="button" class="mdx-tool" data-tool="' + i + '" title="' + t.title + '">' + t.label + "</button>"; }).join("") +
      '</div><div class="mdx-views" role="tablist" aria-label="보기">' +
      VIEWS.map(function (v) { return '<button type="button" class="mdx-view" data-view="' + v[0] + '">' + v[1] + "</button>"; }).join("") +
      '</div></div><div class="mdx-body"><div class="mdx-pv"><div class="mdx-pv-in md-render" aria-live="off"></div></div></div>';
    ta.parentNode.insertBefore(box, ta);
    var body = box.querySelector(".mdx-body"), pv = box.querySelector(".mdx-pv-in");
    body.insertBefore(ta, body.firstChild);

    var timer = null;
    function paint() {
      timer = null;
      var v = ta.value;
      var empty = !v.trim();
      pv.classList.toggle("is-empty", empty);
      pv.innerHTML = K.renderMarkdown ? K.renderMarkdown(empty ? ta.placeholder || "" : v) : "";
    }
    function schedule() { if (!timer) timer = setTimeout(paint, 120); }

    function setView(view, remember) {
      if (view === "preview") pv.style.minHeight = Math.max(140, ta.offsetHeight || 0) + "px";
      box.dataset.view = view;
      box.querySelectorAll(".mdx-view").forEach(function (b) {
        var on = b.dataset.view === view;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      if (view !== "write") paint();
      if (remember) { try { localStorage.setItem(VIEW_KEY, view); } catch (e) {} }
    }

    box.querySelector(".mdx-bar").addEventListener("mousedown", function (e) { if (e.target.closest(".mdx-tool")) e.preventDefault(); }); // 선택 영역 유지
    box.querySelector(".mdx-bar").addEventListener("click", function (e) {
      var tool = e.target.closest(".mdx-tool"), view = e.target.closest(".mdx-view");
      if (tool) {
        if (box.dataset.view === "preview") setView("split", false);
        TOOLS[Number(tool.dataset.tool)].run(ta);
      } else if (view) setView(view.dataset.view, true);
    });
    pv.addEventListener("dblclick", function () { if (box.dataset.view === "preview") { setView("write", true); ta.focus(); } });
    ta.addEventListener("input", schedule);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { onEnter(ta, e); return; }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      var k = String(e.key).toLowerCase();
      var idx = k === "b" ? 1 : k === "i" ? 2 : k === "k" ? 9 : -1;
      if (idx !== -1) { e.preventDefault(); TOOLS[idx].run(ta); }
    });
    // 나란히 보기: 원고를 스크롤하면 미리 보기도 같은 비율로
    ta.addEventListener("scroll", function () {
      if (box.dataset.view !== "split") return;
      var r = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
      pv.scrollTop = r * (pv.scrollHeight - pv.clientHeight);
    });
    // 파일 올리기·AI 작성 등 코드로 값을 바꿔도 미리 보기를 갱신한다
    var desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (desc && desc.set) {
      Object.defineProperty(ta, "value", {
        configurable: true,
        get: function () { return desc.get.call(this); },
        set: function (v) { desc.set.call(this, v); schedule(); }
      });
    }
    setView(savedView(), false);
  }

  function init() { document.querySelectorAll("textarea.source-text").forEach(enhance); }
  K.mdEditor = { enhance: enhance };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
