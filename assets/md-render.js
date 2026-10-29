/* md-render.js — 마크다운 → HTML (입력칸 미리 보기용)
 *   모든 글자를 먼저 이스케이프한 뒤 문법만 태그로 바꾼다 — 입력에 든 HTML·스크립트는 글자로만 보인다.
 *   지원: 프론트매터 · 제목 · 굵게/기울임/취소선/인라인 코드 · 코드 블록 · 인용 · 구분선 · 표 ·
 *         목록(들여쓰기 중첩·번호·체크) · 링크(https·mailto·#) · 이미지(data:image·https)
 *   window.KBuilder.renderMarkdown(src) → html */
(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var SAFE_LINK = /^(https?:|mailto:|#)/i;
  var SAFE_IMG = /^(data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]|https?:)/i;
  var LIST = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;

  /* 인라인 — 코드 조각을 먼저 떼어 두고(안의 문법은 그대로 글자로) 나머지에 서식을 입힌다 */
  function inline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`]+)`/g, function (m, c) { codes.push("<code>" + c + "</code>"); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      return SAFE_IMG.test(url) ? '<img src="' + url + '" alt="' + alt + '" loading="lazy">' : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      return SAFE_LINK.test(url) ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>" : label;
    });
    s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, function (m, a, b) { return "<strong>" + (a || b) + "</strong>"; });
    s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return codes[Number(i)]; });
  }
  function lines2html(text) { return String(text).split("\n").map(inline).join("<br>"); }

  function indentOf(s) {
    var n = 0;
    for (var k = 0; k < s.length; k++) { if (s[k] === " ") n++; else if (s[k] === "\t") n += 4; else break; }
    return n;
  }

  /* 목록 — 들여쓰기 깊이로 중첩, 번호·글머리표가 섞여도 같은 깊이에서 바꿔 연다 */
  function listItemHtml(text) {
    var t = text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
    if (t) return '<li class="md-task"><input type="checkbox" disabled' + (t[1] === " " ? "" : " checked") + "> " + lines2html(t[2]);
    return "<li>" + lines2html(text);
  }
  function buildList(items) {
    var html = "", stack = [];
    items.forEach(function (it) {
      var tag = it.ord ? "ol" : "ul";
      while (stack.length && it.ind < stack[stack.length - 1].ind) html += "</li></" + stack.pop().tag + ">";
      var top = stack[stack.length - 1];
      if (!top || it.ind > top.ind) {
        html += "<" + tag + (it.ord && it.start > 1 ? ' start="' + it.start + '"' : "") + ">";
        stack.push({ ind: it.ind, tag: tag });
      } else {
        html += "</li>";
        if (top.tag !== tag) { html += "</" + top.tag + "><" + tag + ">"; top.tag = tag; }
      }
      html += listItemHtml(it.text);
    });
    while (stack.length) html += "</li></" + stack.pop().tag + ">";
    return html;
  }
  function readList(lines, i) {
    var items = [];
    while (i < lines.length) {
      var raw = lines[i];
      if (!raw.trim()) {
        var j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && LIST.test(lines[j])) { i = j; continue; }
        break;
      }
      var m = raw.match(LIST);
      if (m) { items.push({ ind: indentOf(m[1]), ord: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, text: m[3] }); i++; continue; }
      if (indentOf(raw) > 0 && items.length) { items[items.length - 1].text += "\n" + raw.trim(); i++; continue; }
      break;
    }
    return { html: buildList(items), next: i };
  }

  function cells(line) { return line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); }); }
  function isTableSep(s) { s = String(s || "").trim(); return /^\|?[\s:|-]+$/.test(s) && /-/.test(s) && /\|/.test(s); }

  function blocks(lines) {
    var out = [], para = [], i = 0;
    function flush() { if (para.length) { out.push("<p>" + lines2html(para.join("\n")) + "</p>"); para = []; } }
    while (i < lines.length) {
      var raw = lines[i], line = raw.trim();
      if (!line) { flush(); i++; continue; }
      var fence = line.match(/^(```|~~~)\s*([\w+#.-]*)/);
      if (fence) {
        flush();
        var code = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence[1]) !== 0) code.push(lines[i++]);
        i++;
        out.push("<pre><code" + (fence[2] ? ' data-lang="' + esc(fence[2]) + '"' : "") + ">" + esc(code.join("\n")) + "</code></pre>");
        continue;
      }
      var h = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) { flush(); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
      if (/^([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
      if (/^\|/.test(line) && isTableSep(lines[i + 1])) {
        flush();
        var head = cells(line), rows = [];
        i += 2;
        while (i < lines.length && /^\|/.test(lines[i].trim())) rows.push(cells(lines[i++].trim()));
        out.push('<div class="md-table"><table><thead><tr>' + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>");
        continue;
      }
      if (/^>/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push("<blockquote>" + blocks(q) + "</blockquote>");
        continue;
      }
      if (LIST.test(raw)) { flush(); var r = readList(lines, i); out.push(r.html); i = r.next; continue; }
      para.push(line);
      i++;
    }
    flush();
    return out.join("");
  }

  function renderMarkdown(src) {
    var lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    var head = "";
    if (/^﻿?---\s*$/.test(lines[0] || "")) {
      for (var k = 1; k < lines.length; k++) {
        if (!/^---\s*$/.test(lines[k])) continue;
        head = '<div class="md-front">' + lines.slice(1, k).map(function (l) {
          var kv = l.match(/^\s*([^:]+):\s*(.*)$/);
          return kv ? "<span><b>" + esc(kv[1].trim()) + "</b> " + esc(kv[2]) + "</span>" : "";
        }).join("") + "</div>";
        lines = lines.slice(k + 1);
        break;
      }
    }
    return head + blocks(lines);
  }

  var K = (window.KBuilder = window.KBuilder || {});
  K.renderMarkdown = renderMarkdown;
})();
