/* course-art.js — 학습모듈 '삽화' 탭 (K.courseTabs.art)
 *   삽화 생성(교재 삽화 아이디어 · 종류 · 비율 · 학습내용 배치) → AI가 SVG 로 그림 → 정리(스크립트·외부 링크 제거)
 *   아트 스타일 가이드(과정 공용): 팔레트(역할·hex) · 선 굵기 · 모서리 · 채색 · 글자 · 그림 규칙 · 기준 삽화
 *   자동 검사: 팔레트 밖 색 · 선 굵기 불일치 → 「팔레트로 맞추기」, 수정 요청, SVG/PNG 저장, 레퍼런스 이미지로 가이드 추출
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var U = function () { return K.cui; };
  var C = function () { return K.course; };
  var esc = function (s) { return U().esc(s); };
  var DEFAULT_ART = {
    name: "기본 교재 스타일",
    palette: [{ role: "윤곽선", hex: "#1E2A3A" }, { role: "주색", hex: "#3D5FC4" }, { role: "보조색", hex: "#9DB8EA" }, { role: "강조색", hex: "#F2A93B" },
      { role: "바탕", hex: "#F6F4EE" }, { role: "그림자", hex: "#D9D4C7" }, { role: "흰색", hex: "#FFFFFF" }],
    stroke: 2.5, corner: "둥근 모서리(rx 8~12)", shading: "평면 채색, 그라디언트·필터 없음, 그림자는 그림자 색 도형 하나로만",
    text: "이미지 안에 글자를 넣지 않는다(설명은 캡션이 담당)",
    rules: "굵기가 같은 윤곽선, 단순화한 기하 도형 위주, 사람은 얼굴 이목구비 없이 둥근 머리와 몸통으로만, 화면 요소는 박스와 막대로 추상화",
    anchorId: null, anchorSvg: null
  };
  var KINDS = ["개념도", "장면 삽화", "화면 예시(추상화)", "아이콘"];
  var RATIOS = [["640 360", "16:9"], ["640 480", "4:3"], ["480 480", "1:1"]];
  var ui = { for: null, desc: "", kind: KINDS[0], ratio: RATIOS[0][0], place: "", draft: null, revise: null, extractFile: null };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function art(course) { return course.art || DEFAULT_ART; }
  function svgURL(s) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s); }

  /* ---------- SVG 정리 · 검사 ---------- */
  function sanitizeSvg(raw) {
    var mm = String(raw || "").match(/<svg[\s\S]*<\/svg>/i);
    if (!mm) throw new Error("SVG 코드를 찾지 못했습니다. 다시 생성해 보세요.");
    var doc = new DOMParser().parseFromString(mm[0], "image/svg+xml");
    if (doc.querySelector("parsererror")) throw new Error("SVG 형식이 올바르지 않습니다. 다시 생성해 보세요.");
    var root = doc.documentElement;
    root.querySelectorAll("script,style,foreignObject,image,iframe,a,use[href^='http'],animate,set").forEach(function (n) { n.parentNode.removeChild(n); });
    var EXT = /url\(\s*(?!['"]?\s*#)|@import|javascript:/i; // 외부 자원·스크립트를 부를 수 있는 값
    (function walk(el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n.indexOf("on") === 0) el.removeAttribute(a.name);
        else if ((n === "href" || n === "xlink:href") && a.value.charAt(0) !== "#") el.removeAttribute(a.name);
        else if (EXT.test(a.value)) el.removeAttribute(a.name);
      });
      Array.prototype.slice.call(el.children).forEach(walk);
    })(root);
    if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    var vb = root.getAttribute("viewBox");
    if (!vb) {
      var w0 = parseFloat(root.getAttribute("width")) || 640, h0 = parseFloat(root.getAttribute("height")) || 360;
      vb = "0 0 " + w0 + " " + h0; root.setAttribute("viewBox", vb);
    }
    var p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length !== 4 || p.some(isNaN) || !(p[2] > 0) || !(p[3] > 0)) { p = [0, 0, 640, 360]; root.setAttribute("viewBox", "0 0 640 360"); }
    root.setAttribute("width", p[2]); root.setAttribute("height", p[3]);
    var out = new XMLSerializer().serializeToString(root);
    if (out.length > 300000) throw new Error("SVG가 너무 큽니다(" + Math.round(out.length / 1024) + "KB). 더 단순하게 다시 생성해 보세요.");
    return out;
  }
  var cv = null;
  function toHex(c) {
    c = String(c).trim();
    if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + c.slice(1).split("").map(function (x) { return x + x; }).join("");
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7).toLowerCase();
    cv = cv || document.createElement("canvas").getContext("2d");
    cv.fillStyle = "#010203"; cv.fillStyle = c;
    var v = cv.fillStyle;
    return v === "#010203" ? null : (/^#/.test(v) ? v.toLowerCase() : null);
  }
  var COLOR_RE = /(fill|stroke|stop-color|color)\s*([:=])\s*(["']?)\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|[a-zA-Z]+)/g;
  var SKIP = /^(none|transparent|currentColor|inherit|url)$/i;
  function paletteCheck(svg, pal) {
    var allowed = {}, bad = {}, total = 0;
    pal.forEach(function (p) { allowed[p.hex.toLowerCase()] = 1; });
    String(svg).replace(COLOR_RE, function (all, prop, op, q, val) {
      if (SKIP.test(val)) return all;
      total++;
      var hx = toHex(val);
      if (!hx || !allowed[hx]) bad[val] = (bad[val] || 0) + 1;
      return all;
    });
    var sw = {}, re = /stroke-width\s*[:=]\s*["']?\s*([\d.]+)/g, m;
    while ((m = re.exec(svg))) sw[Number(m[1])] = 1;
    return { total: total, bad: Object.keys(bad), strokes: Object.keys(sw).map(Number) };
  }
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function nearest(hex, pal) {
    var a = rgb(hex), best = pal[0].hex, bd = 1e9;
    pal.forEach(function (p) {
      var b = rgb(p.hex.toLowerCase());
      var d = Math.pow(a[0] - b[0], 2) * 0.3 + Math.pow(a[1] - b[1], 2) * 0.59 + Math.pow(a[2] - b[2], 2) * 0.11;
      if (d < bd) { bd = d; best = p.hex; }
    });
    return best;
  }
  function snapPalette(svg, pal) {
    var allowed = {};
    pal.forEach(function (p) { allowed[p.hex.toLowerCase()] = 1; });
    return String(svg).replace(COLOR_RE, function (all, prop, op, q, val) {
      if (SKIP.test(val)) return all;
      var hx = toHex(val);
      if (!hx || allowed[hx]) return all;
      return prop + op + q + nearest(hx, pal);
    });
  }
  function svgToPng(svg, width) {
    width = width || 1600;
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        var r = img.naturalHeight / img.naturalWidth || 0.5625;
        var c = document.createElement("canvas");
        c.width = width; c.height = Math.round(width * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { b ? res(b) : rej(new Error("PNG로 바꾸지 못했습니다.")); }, "image/png");
      };
      img.onerror = function () { rej(new Error("PNG로 바꾸지 못했습니다.")); };
      img.src = svgURL(svg);
    });
  }

  /* ---------- 화면 ---------- */
  function checkBadge(svg, A) {
    var c = paletteCheck(svg, A.palette);
    var okStroke = c.strokes.every(function (s) { return Math.abs(s - A.stroke) <= 0.6 || s === 0; });
    return (c.bad.length ? '<span class="cs-badge bad" title="' + esc(c.bad.join(", ")) + '">팔레트 밖 ' + c.bad.length + "색</span>" : '<span class="cs-badge ok">팔레트 준수</span>') +
      (okStroke ? "" : '<span class="cs-badge warn" title="' + esc(c.strokes.join(", ")) + '">선 굵기 불일치</span>');
  }
  function figHtml(x, A, tb) {
    var c = paletteCheck(x.svg, A.palette), isAnchor = A.anchorId === x.id;
    return '<div class="cs-fig' + (isAnchor ? " anchor" : "") + '"><div class="cs-fig-img"><img alt="' + esc(x.title) + '" src="' + svgURL(x.svg) + '" loading="lazy"></div><div class="cs-fig-b">' +
      '<div class="cs-fig-t">' + esc(x.title) + (isAnchor ? ' <span class="cs-badge ref">기준</span>' : "") + '</div><div class="cs-muted">' + esc(x.kind) + "</div>" +
      '<input data-ill-cap="' + x.id + '" value="' + esc(x.caption || "") + '" placeholder="캡션 (교재에 함께 실림)">' +
      '<select data-ill-place="' + x.id + '"><option value="">배치 안 함</option>' + tb.sections.map(function (s, i) { return U().opt(i, "학습내용 " + (i + 1) + ". " + (s.title || "").slice(0, 24), x.placement == null ? "" : x.placement); }).join("") + "</select>" +
      '<div class="cs-row-s">' + checkBadge(x.svg, A) + "</div>" +
      '<div class="cs-fig-act">' + (c.bad.length ? '<button class="btn btn-ghost" data-act="art-snap" data-id="' + x.id + '">팔레트로 맞추기</button>' : "") +
      (isAnchor ? "" : '<button class="btn btn-ghost" data-act="art-anchor" data-id="' + x.id + '">기준으로</button>') +
      '<button class="btn btn-ghost" data-act="art-revise" data-id="' + x.id + '"' + (U().aiReady("write") ? "" : " disabled") + ">수정 요청</button>" +
      '<button class="btn btn-ghost" data-act="art-svg" data-id="' + x.id + '">SVG</button><button class="btn btn-ghost" data-act="art-png" data-id="' + x.id + '">PNG</button>' +
      '<button class="cs-danger" data-act="art-del" data-id="' + x.id + '">삭제</button></div></div></div>';
  }
  function render(c) {
    var m = c.module, A = art(c.course), tb = K.courseTB.tbOf(m), ideas = m.ideas || [];
    if (ui.for !== m.id) { ui.for = m.id; ui.place = ""; ui.revise = null; } // 배치 번호는 학습모듈마다 다르다
    var ills = (m.ills || []).slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    return '<div class="cs-grid2"><div class="cs-stack"><div class="cs-card cs-gen"><div class="cs-card-head"><h3>삽화 생성</h3><span class="cs-muted">스타일: ' + esc(A.name) + "</span></div>" +
      (ideas.length ? '<div class="cs-chips2"><span class="cs-muted">교재 삽화 아이디어</span>' + ideas.map(function (x, i) { return '<button class="cs-fchip" data-act="art-idea" data-i="' + i + '" title="' + esc(x.description) + '">학습내용 ' + (x.section + 1) + " 후보</button>"; }).join("") + "</div>" : "") +
      '<label class="cs-lab">무엇을 그릴까요</label><textarea rows="3" data-art="desc" placeholder="예: 질문 상자에서 나온 화살표가 토큰 블록 여러 개로 나뉘고, 각 블록 위에 확률 막대가 서 있는 모습. 가장 높은 막대의 블록이 다음 칸으로 이동.">' + esc(ui.desc) + "</textarea>" +
      '<div class="cs-q-form"><label>종류 <select data-art="kind">' + KINDS.map(function (k) { return U().opt(k, k, ui.kind); }).join("") + "</select></label>" +
      '<label>비율 <select data-art="ratio">' + RATIOS.map(function (r) { return U().opt(r[0], r[1], ui.ratio); }).join("") + "</select></label>" +
      '<label>배치 <select data-art="place"><option value="">배치 안 함</option>' + tb.sections.map(function (s, i) { return U().opt(i, "학습내용 " + (i + 1) + ". " + (s.title || "").slice(0, 24), ui.place); }).join("") + "</select></label></div>" +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="art-gen"' + (U().aiReady("write") ? "" : " disabled") + '>삽화 생성</button><span class="cs-muted">' + (U().aiReady("write") ? esc(U().aiName("write")) + "가 SVG로 그립니다" : "AI 키 필요") + "</span></div></div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>이 학습모듈의 삽화</h3><span class="cs-muted">기준 삽화는 과정의 모든 새 삽화가 따라가는 스타일 견본입니다.</span></div>' +
      (ills.length ? '<div class="cs-gallery">' + ills.map(function (x) { return figHtml(x, A, tb); }).join("") + "</div>" : '<div class="cs-empty">아직 삽화가 없습니다.</div>') + "</div></div>" +
      '<div class="cs-stack"><div class="cs-card"><div class="cs-card-head"><h3>아트 스타일 가이드</h3><div class="cs-spacer"></div><button class="btn btn-ghost" data-act="art-guide">편집</button></div>' +
      '<div class="cs-swatches">' + A.palette.map(function (p) { return '<span class="cs-sw"><i style="background:' + esc(p.hex) + '"></i>' + esc(p.role) + ' <span class="mono cs-muted">' + esc(p.hex) + "</span></span>"; }).join("") + "</div>" +
      '<dl class="cs-kvl"><dt>선 굵기</dt><dd class="mono">' + A.stroke + "px</dd><dt>모서리</dt><dd>" + esc(A.corner) + "</dd><dt>채색</dt><dd>" + esc(A.shading) + "</dd><dt>글자</dt><dd>" + esc(A.text) +
      "</dd><dt>기준 삽화</dt><dd>" + (A.anchorSvg ? '<img class="cs-anchor-mini" alt="기준 삽화" src="' + svgURL(A.anchorSvg) + '">' : '<span class="cs-muted">없음 — 첫 삽화를 기준으로 지정하세요</span>') + "</dd></dl></div>" +
      '<div class="cs-card cs-muted">생성한 삽화는 팔레트 밖 색상과 선 굵기를 자동 검사합니다. 벗어난 색은 <b>팔레트로 맞추기</b>로 가장 가까운 팔레트 색에 맞춥니다. 학습내용에 배치한 삽화는 교재 미리보기·교재.md에 함께 실립니다.</div></div></div>';
  }

  /* ---------- 스타일 가이드 대화상자 ---------- */
  function guideDialog() {
    var A = ui.draft, can = K.courseTB.canSee("write");
    U().openDialog('<div class="cs-dlg-h"><h3>아트 스타일 가이드</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<p class="cs-muted">과정의 모든 학습모듈 삽화가 공유하는 기준입니다. 바꾸면 이후 생성하는 삽화부터 적용됩니다.</p>' +
      '<label class="cs-lab">가이드 이름</label><input data-ar="name" value="' + esc(A.name) + '">' +
      '<label class="cs-lab">팔레트 (역할 · hex)</label>' + A.palette.map(function (p, i) {
        return '<div class="cs-chrow"><input type="color" data-ar="pc" data-i="' + i + '" value="' + esc(toHex(p.hex) || "#000000") + '" aria-label="색"><input data-ar="pr" data-i="' + i + '" value="' + esc(p.role) + '" aria-label="역할">' +
          '<input class="mono cs-ver" data-ar="ph" data-i="' + i + '" value="' + esc(p.hex) + '" aria-label="hex"><button class="cs-x" data-act="art-pal-del" data-i="' + i + '">✕</button></div>';
      }).join("") + '<button class="cs-link" data-act="art-pal-add">＋ 색 추가</button>' +
      '<div class="cs-q-form"><label>선 굵기(px) <input type="number" step="0.5" min="0.5" data-ar="stroke" value="' + esc(A.stroke) + '"></label><label>모서리 <input data-ar="corner" value="' + esc(A.corner) + '"></label></div>' +
      '<label class="cs-lab">채색</label><input data-ar="shading" value="' + esc(A.shading) + '">' +
      '<label class="cs-lab">이미지 안 글자</label><input data-ar="text" value="' + esc(A.text) + '">' +
      '<label class="cs-lab">그림 규칙</label><textarea rows="3" data-ar="rules">' + esc(A.rules) + "</textarea>" +
      '<div class="cs-card cs-gen"><b>레퍼런스 이미지로 가이드 만들기</b><p class="cs-muted">기존 교재 삽화나 원하는 화풍의 이미지를 올리면 팔레트·선·채색 규칙을 추출해 위 칸을 채웁니다. 저장 전에 확인할 수 있습니다.</p>' +
      (can ? '<input type="file" data-ar-file accept="image/png,image/jpeg,image/webp" aria-label="레퍼런스 이미지"><div class="cs-actions"><button class="btn btn-ghost" data-act="art-extract">스타일 추출</button></div>'
        : '<p class="cs-muted">이미지를 읽으려면 Google 또는 Claude API 키가 필요합니다.</p>') + "</div>" +
      '<button class="cs-link" data-act="art-reset">기본 스타일로 되돌리기</button></div>' +
      '<div class="cs-dlg-f"><button class="btn btn-ghost" data-act="dlg-close">취소</button><button class="btn btn-primary" data-act="art-guide-save">저장</button></div>');
  }
  function reviseDialog(x) {
    U().openDialog('<div class="cs-dlg-h"><h3>삽화 수정 요청</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<div class="cs-fig-big"><img alt="" src="' + svgURL(x.svg) + '"></div><label class="cs-lab">무엇을 바꿀까요</label>' +
      '<textarea rows="3" data-art="revise" placeholder="예: 오른쪽 화살표를 곡선으로, 토큰 블록 개수를 5개로 줄이기">' + esc(ui.revise.text || "") + "</textarea></div>" +
      '<div class="cs-dlg-f"><button class="btn btn-ghost" data-act="dlg-close">취소</button><button class="btn btn-primary" data-act="art-revise-go">수정</button></div>');
  }

  function find(m, id) { return (m.ills || []).filter(function (x) { return x.id === id; })[0]; }
  function readImage(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); res({ mime: file.type || "image/png", data: s.slice(s.indexOf(",") + 1) }); };
      r.onerror = function () { rej(new Error("이미지를 읽지 못했습니다.")); };
      r.readAsDataURL(file);
    });
  }

  var actions = {
    "art-idea": function (el, c) {
      var x = (c.module.ideas || [])[Number(el.dataset.i)];
      if (!x) return;
      ui.desc = x.description; ui.place = String(x.section); U().render();
    },
    "art-gen": function (el, c) {
      var m = c.module, A = art(c.course), desc = ui.desc.trim();
      if (!desc) { U().toast("그릴 내용을 적어 주세요."); return; }
      var tb = K.courseTB.tbOf(m), place = ui.place;
      var sec = place !== "" ? tb.sections[Number(place)] : null;
      var context = sec ? sec.title + ": " + K.courseRules.plain(sec.body).replace(/\s+/g, " ").slice(0, 800) : "";
      var kind = ui.kind;
      U().run("삽화 그리는 중… (" + U().aiName("write") + ")", function () {
        return K.courseAI.drawSvg(A, A.anchorSvg, { kind: kind, desc: desc, context: context }, ui.ratio).then(function (raw) {
          var svg = sanitizeSvg(raw);
          m.ills = (m.ills || []).concat([{ id: C().uid("ill"), title: desc.split(/[.\n]/)[0].slice(0, 40), kind: kind, prompt: desc, svg: svg, caption: "", placement: place === "" ? null : Number(place), at: Date.now() }]);
          C().logChange(m, "삽화 생성: " + desc.slice(0, 30));
          ui.desc = "";
          U().toast("삽화를 만들었습니다. 스타일 검사 결과를 확인하세요.");
        });
      });
    },
    "art-snap": function (el, c) {
      var x = find(c.module, el.dataset.id), A = art(c.course);
      if (!x) return;
      x.svg = snapPalette(x.svg, A.palette);
      if (A.anchorId === x.id) A.anchorSvg = x.svg;
      U().save(); U().render(); U().toast("팔레트 색으로 맞췄습니다.");
    },
    "art-anchor": function (el, c) {
      var x = find(c.module, el.dataset.id);
      if (!x) return;
      var A = clone(art(c.course));
      A.anchorId = x.id; A.anchorSvg = x.svg;
      c.course.art = A;
      U().save(); U().render(); U().toast("기준 삽화로 지정했습니다. 이후 삽화가 이 그림의 화풍을 따릅니다.");
    },
    "art-revise": function (el, c) { var x = find(c.module, el.dataset.id); if (!x) return; ui.revise = { id: x.id, text: "" }; reviseDialog(x); },
    "art-revise-go": function (el, c) {
      if (!ui.revise) return;
      var x = find(c.module, ui.revise.id), t = String(ui.revise.text || "").trim();
      if (!x || !t) { U().toast("무엇을 바꿀지 적어 주세요."); return; }
      var A = art(c.course);
      U().closeDialog();
      U().run("삽화 고치는 중… (" + U().aiName("write") + ")", function () {
        return K.courseAI.reviseSvg(A, x.svg, t).then(function (raw) {
          x.svg = sanitizeSvg(raw); x.revisedAt = Date.now();
          if (A.anchorId === x.id) A.anchorSvg = x.svg;
          C().logChange(c.module, "삽화 수정: " + t.slice(0, 30));
          U().toast("수정했습니다.");
        });
      });
    },
    "art-svg": function (el, c) { var x = find(c.module, el.dataset.id); if (x) U().download(U().safeName(x.title || "삽화") + ".svg", x.svg, "image/svg+xml"); },
    "art-png": function (el, c) {
      var x = find(c.module, el.dataset.id);
      if (!x) return;
      svgToPng(x.svg).then(function (blob) { U().download(U().safeName(x.title || "삽화") + ".png", blob); }, function (e) { U().toast(e.message); });
    },
    "art-del": function (el, c) {
      var x = find(c.module, el.dataset.id);
      if (!x || !confirm("이 삽화를 삭제할까요?")) return;
      c.module.ills = c.module.ills.filter(function (y) { return y.id !== x.id; });
      C().logChange(c.module, "삽화 삭제: " + x.title);
      U().save(); U().render();
    },
    "art-guide": function (el, c) { ui.draft = clone(art(c.course)); guideDialog(); },
    "art-pal-add": function () { ui.draft.palette.push({ role: "색", hex: "#888888" }); guideDialog(); },
    "art-pal-del": function (el) { ui.draft.palette.splice(Number(el.dataset.i), 1); guideDialog(); },
    "art-reset": function () { var keep = ui.draft; ui.draft = clone(DEFAULT_ART); ui.draft.anchorId = keep.anchorId; ui.draft.anchorSvg = keep.anchorSvg; guideDialog(); },
    "art-extract": function () {
      var f = ui.extractFile;
      if (!f) { U().toast("이미지 파일을 고르세요."); return; }
      var keep = ui.draft;
      U().run("화풍 분석 중… (" + U().aiName("write") + ")", function () {
        return readImage(f).then(K.courseAI.extractArtStyle).then(function (r) {
          ui.draft = Object.assign({}, keep, {
            name: String(r.name || keep.name),
            palette: (r.palette || []).map(function (p) { return { role: String(p.role || "색"), hex: (toHex(p.hex) || "#000000").toUpperCase() }; }).slice(0, 10),
            stroke: Number(r.stroke) || keep.stroke, corner: String(r.corner || keep.corner), shading: String(r.shading || keep.shading),
            text: String(r.text || keep.text), rules: String(r.rules || keep.rules)
          });
          if (!ui.draft.palette.length) ui.draft.palette = keep.palette;
          guideDialog();
          U().toast("추출했습니다. 확인 후 저장하세요.");
        });
      }, { quiet: true });
    },
    "art-guide-save": function (el, c) {
      var A = ui.draft;
      A.palette = A.palette.map(function (p) { return { role: p.role.trim() || "색", hex: (toHex(p.hex) || "").toUpperCase() }; }).filter(function (p) { return p.hex; });
      if (!A.palette.length) { U().toast("팔레트에 색이 하나 이상 있어야 합니다."); return; }
      A.stroke = Number(A.stroke) || 2.5;
      c.course.art = A;
      ui.draft = null;
      U().closeDialog(); U().save(); U().render(); U().toast("스타일 가이드를 저장했습니다.");
    }
  };

  function input(el, c) {
    if (el.dataset.art) {
      var k = el.dataset.art;
      if (k === "revise") { if (ui.revise) ui.revise.text = el.value; } else ui[k] = el.value;
      return true;
    }
    if (el.dataset.ar && ui.draft) {
      var A = ui.draft, i = Number(el.dataset.i), f = el.dataset.ar;
      if (f === "pc") { A.palette[i].hex = el.value.toUpperCase(); var h = U().dialogEl().querySelector('[data-ar="ph"][data-i="' + i + '"]'); if (h) h.value = A.palette[i].hex; }
      else if (f === "ph") { A.palette[i].hex = el.value; var hx = toHex(el.value); var p = U().dialogEl().querySelector('[data-ar="pc"][data-i="' + i + '"]'); if (hx && p) p.value = hx; }
      else if (f === "pr") A.palette[i].role = el.value;
      else A[f] = el.value;
      return true;
    }
    if (el.dataset.illCap && c.module) {
      var x = find(c.module, el.dataset.illCap);
      if (x) { x.caption = el.value; U().save(); }
      return true;
    }
    return false;
  }
  function change(el, c) {
    if (el.hasAttribute("data-ar-file")) { ui.extractFile = el.files && el.files[0]; return true; }
    if (el.dataset.illPlace && c.module) {
      var x = find(c.module, el.dataset.illPlace);
      if (x) { x.placement = el.value === "" ? null : Number(el.value); C().logChange(c.module, "삽화 배치: " + x.title + (x.placement == null ? " → 배치 안 함" : " → 학습내용 " + (x.placement + 1))); U().save(); }
      return true;
    }
    if (el.dataset.art) {
      if (el.dataset.art === "revise") { if (ui.revise) ui.revise.text = el.value; } // 수정 요청 상태 객체를 문자열로 덮지 않는다
      else ui[el.dataset.art] = el.value;
      return true;
    }
    return false;
  }

  K.courseTabs = K.courseTabs || {};
  K.courseTabs.art = {
    label: "삽화", render: render, actions: actions, input: input, change: change,
    badge: function (m) { return (m.ills || []).length ? '<span class="cs-cnt">' + m.ills.length + "</span>" : ""; }
  };
  K.courseArt = { DEFAULT_ART: DEFAULT_ART, sanitizeSvg: sanitizeSvg, paletteCheck: paletteCheck, snapPalette: snapPalette, toHex: toHex };
})();
