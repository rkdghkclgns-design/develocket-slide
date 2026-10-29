/* course-textbook.js — 학습모듈 '교재' 탭 (K.courseTabs.textbook)
 *   왼쪽: AI 초안 생성(가르칠 내용·목표 수·학습자 수준·분량·참고 자료, 고정 칸 외 새로 쓰기)
 *         AI 수정(칸 고르기 / 드래그한 부분만 · 빠른 지시) · 교재 편집기 01~04(칸마다 고정) / 미리보기 · .md 저장 · 복사
 *   오른쪽: 검수 규칙(자동 검수 → AI 수정안, 수동 검수 4항목, 검사 규칙 목록) · 교수안·슬라이드 만들기
 *   AI 결과는 변경 미리보기(단어 단위 비교)에서 항목별로 골라 반영한다. 편집은 바로 학습모듈에 저장된다.
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var U = function () { return K.cui; };
  var TB = function () { return K.courseTB; };
  var R = function () { return K.courseRules; };
  var C = function () { return K.course; };
  var esc = function (s) { return U().esc(s); };
  var ui = null;

  function sync(m) {
    if (ui && ui.for === m.id) return;
    ui = { for: m.id, locks: [], preview: false, genOpen: null, aeOpen: false, aeMode: "field", aeKeys: {}, aeIns: "", lastSel: null,
      refs: { draft: K.courseRefs.create("draft"), edit: K.courseRefs.create("edit") }, refErr: {}, fix: null, rulesOpen: false, del: null, addHint: "", scan: null };
  }
  function has(tb) { return tb.objectives.length || String(tb.overview || "").trim(); }
  function locked(k) { return ui.locks.indexOf(k) !== -1; }
  function gen(m) { m.gen = m.gen || {}; return m.gen; }
  /* 학습목표 수: 직접 고른 값이 없으면 지금 목표 수(1~3), 목표가 없으면 3 */
  function defaultN(m) { return Number(gen(m).n) || Math.min(3, Math.max(1, m.objectives.length || 3)); }

  /* ---------- 간단한 마크다운(미리보기) ---------- */
  function inl(s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); }
  function md(src) {
    var out = [], lines = String(src || "").replace(/\r\n/g, "\n").split("\n"), i = 0, para = [], list = null;
    function flushP() { if (para.length) { out.push("<p>" + inl(para.join(" ")) + "</p>"); para = []; } }
    function flushL() { if (list) { out.push("<" + list.t + ">" + list.items.map(function (x) { return "<li>" + inl(x) + "</li>"; }).join("") + "</" + list.t + ">"); list = null; } }
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*```/.test(l)) {
        flushP(); flushL();
        var code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre class="cs-codeb"><code>' + esc(code.join("\n")) + "</code></pre>");
        continue;
      }
      var b = l.match(/^\s*[-*•]\s+(.*)$/), o = l.match(/^\s*\d+[.)]\s+(.*)$/);
      if (b || o) {
        flushP();
        var t = b ? "ul" : "ol";
        if (!list || list.t !== t) { flushL(); list = { t: t, items: [] }; }
        list.items.push((b || o)[1]); i++; continue;
      }
      var h = l.match(/^#{1,6}\s+(.*)$/);
      if (h) { flushP(); flushL(); out.push("<h6>" + inl(h[1]) + "</h6>"); i++; continue; }
      if (!l.trim()) { flushP(); flushL(); i++; continue; }
      flushL(); para.push(l.trim()); i++;
    }
    flushP(); flushL();
    return out.join("");
  }

  /* ---------- 검수 표시 ---------- */
  function lintHtml(I) {
    if (!I.length) return '<div class="cs-lint-sum"><span class="cs-badge ok">규칙 위반 없음</span></div>';
    var b = I.filter(function (x) { return x.sev === "bad"; }).length, w = I.length - b;
    return '<div class="cs-lint-sum">' + (b ? '<span class="cs-badge bad">필수 위반 ' + b + "건</span>" : "") + (w ? '<span class="cs-badge warn">권장 위반 ' + w + "건</span>" : "") + "</div>" +
      I.slice(0, 40).map(function (x) {
        return '<div class="cs-li ' + x.sev + '"><b>' + esc(x.where) + "</b> · " + esc(x.msg) + (x.snip ? '<div class="cs-snip">' + esc(x.snip) + "</div>" : "") + "</div>";
      }).join("");
  }
  function rel(at) {
    var s = Math.round((Date.now() - at) / 1000);
    return s < 60 ? "방금" : s < 3600 ? Math.round(s / 60) + "분 전" : s < 86400 ? Math.round(s / 3600) + "시간 전" : Math.round(s / 86400) + "일 전";
  }
  function reviewCard(c, I) {
    var m = c.module, rv = m.review || {};
    var n = R().MANUAL_RULES.filter(function (r) { return rv[r.key]; }).length;
    var grp = function (sev) {
      return R().RULE_LIST.filter(function (r) { return r.sev === sev; }).map(function (r) {
        return '<li><span class="cs-rl-rule">' + esc(r.rule) + ' <span class="cs-muted">' + esc(r.area) + '</span></span><span class="cs-rl-desc">' + esc(r.desc) + "</span></li>";
      }).join("");
    };
    return '<div class="cs-card cs-rules"><div class="cs-card-head"><h3>검수 규칙</h3><div class="cs-spacer"></div><span id="tb-save" class="cs-muted">저장됨</span></div>' +
      '<div class="cs-rc"><div class="cs-rc-h">자동 검수</div><div id="tb-lint">' + lintHtml(I) + "</div>" +
      '<button class="btn btn-ghost" data-act="tb-fix"' + (I.length && U().aiReady("write") ? "" : " disabled") + ">AI 수정안 보기</button></div>" +
      '<div class="cs-rc"><div class="cs-rc-h">수동 검수 <span class="mono ' + (n === R().MANUAL_RULES.length ? "cs-ok" : "cs-muted") + '">' + n + "/" + R().MANUAL_RULES.length + "</span></div>" +
      R().MANUAL_RULES.map(function (r) {
        var v = rv[r.key];
        return '<label class="cs-manual" title="' + esc(r.hint) + '"><input type="checkbox" data-review="' + r.key + '"' + (v ? " checked" : "") + "><span>" + esc(r.text) +
          '<small class="cs-muted">' + (v ? "확인함 · " + rel(v.at) : esc(r.hint)) + "</small></span></label>";
      }).join("") + "</div>" +
      '<details class="cs-rc" data-tb-rules-d' + (ui.rulesOpen ? " open" : "") + '><summary class="cs-rc-h">검사 규칙 목록 <span class="cs-muted">필수 ' + R().RULE_LIST.filter(function (r) { return r.sev === "bad"; }).length +
      " · 권장 " + R().RULE_LIST.filter(function (r) { return r.sev === "warn"; }).length + "</span></summary>" +
      '<div class="cs-rl"><span class="cs-badge bad">필수</span><ul>' + grp("bad") + '</ul></div><div class="cs-rl"><span class="cs-badge warn">권장</span><ul>' + grp("warn") + "</ul></div>" +
      '<p class="cs-muted">어투·표현 규칙은 개요, 학습내용, 체크리스트에 적용합니다. 학습목표는 어미·개수만, 코드 블록은 검사하지 않습니다.</p></details></div>';
  }
  function lessonCard(c) {
    var m = c.module, ct = m.content || {};
    var guideN = (ct.guide || []).filter(function (g) { return String(g || "").trim(); }).length;
    var hasTb = K.courseAI.hasTextbook(m);
    return '<div class="cs-card"><div class="cs-card-head"><h3>교수안·슬라이드</h3></div>' +
      '<p class="cs-muted">' + (hasTb ? "콘텐츠의 원본은 교재입니다. 교재를 바탕으로 강사용 교수안 단계 지침과 슬라이드를 만듭니다(교재는 바뀌지 않습니다)."
        : "아직 교재가 없습니다. 아래 버튼은 교재(학습목표·학습내용·체크리스트)와 교수안 단계 지침·슬라이드를 한 번에 만듭니다. 교재만 먼저 다듬으려면 위 「AI 초안 생성」을 쓰세요.") + "</p>" +
      '<div class="cs-kv"><span>교수안 지침</span><b>' + guideN + "/" + (m.flow || []).length + "단계</b><span>슬라이드</span><b>" + (String(ct.slides || "").trim() ? "있음" : "없음") + "</b></div>" +
      '<div class="cs-actions"><button class="btn ' + (hasTb ? "btn-ghost" : "btn-primary") + '" data-act="tb-lesson"' + (U().aiReady("write") ? "" : " disabled") + ">" + (hasTb ? "교수안·슬라이드 만들기" : "📝 교재·교수안·슬라이드 한 번에 만들기") + "</button>" +
      '<button class="btn btn-ghost" data-act="tb-assemble">단원 산출물에 반영</button></div></div>';
  }

  /* ---------- AI 초안 · AI 수정 패널 ---------- */
  function lockBtn(k) {
    var on = locked(k);
    return '<button type="button" class="cs-lock' + (on ? " on" : "") + '" data-act="tb-lock" data-k="' + k + '" aria-pressed="' + on + '" title="' + (on ? "고정됨 · AI가 바꾸지 않습니다 (눌러서 해제)" : "고정하기 · AI 생성 때 이 칸을 유지합니다") + '">' + (on ? "🔒 고정" : "🔓 고정") + "</button>";
  }
  function budget(kind, tb, m) {
    var base = kind === "edit"
      ? TB().bytes(R().RULES_TB) + Math.min(TB().bytes(JSON.stringify(tb).slice(0, 30000)), 90000) + TB().bytes(ui.aeIns) + 4000
      : TB().bytes(R().RULES_TB) + TB().bytes(gen(m).notes || "") + 3500 + (ui.locks.length ? Math.min(TB().bytes(JSON.stringify(tb)), 240000) : 0);
    return { used: TB().bytes(ui.refs[kind].block(kind)), avail: Math.max(0, TB().PROMPT_LIMIT - base) };
  }
  function genLabel(tb) {
    if (!has(tb)) return "초안 생성";
    return ui.locks.length ? "고정 " + ui.locks.length + "칸 외 새로 쓰기" : "전체 새로 쓰기";
  }
  function genPanel(c, tb) {
    var m = c.module, g = gen(m);
    var open = ui.genOpen != null ? ui.genOpen : !has(tb);
    var n = defaultN(m);
    return '<details class="cs-card cs-gen" data-tb-gen-d' + (open ? " open" : "") + "><summary>AI 초안 생성" + (ui.locks.length ? ' <span class="cs-badge">고정 ' + ui.locks.length + "칸</span>" : "") + "</summary>" +
      '<p class="cs-muted">설계 규칙(구성 순서·1:1 대응·어투)에 맞춰 교재를 씁니다. 편집기에서 <b>고정</b>한 칸은 그대로 두고 나머지만 새로 씁니다. 교재에 내용이 있으면 미리보기에서 확인한 뒤 반영됩니다. 생성 결과가 자동 검수에 걸리면 한 번 더 고쳐 받습니다.</p>' +
      '<label class="cs-lab">가르칠 내용</label><textarea rows="4" data-tbg="notes" placeholder="예: 같은 질문에도 답이 달라지는 이유(샘플링·온도), 시스템 프롬프트로 역할 고정하기, 출력 형식 지정하기">' + esc(g.notes || "") + "</textarea>" +
      '<div class="cs-q-form"><label>학습목표 수 <select data-tbg="n">' + [1, 2, 3].map(function (x) { return U().opt(x, x + "개", n); }).join("") + "</select></label>" +
      '<label>학습자 수준 <select data-tbg="level">' + TB().LEVELS.map(function (x) { return U().opt(x, x, g.level || TB().LEVELS[1]); }).join("") + "</select></label>" +
      '<label>학습내용 분량(덩어리당) <select data-tbg="length">' + TB().LENGTHS.map(function (x) { return U().opt(x, x, g.length || TB().LENGTHS[1]); }).join("") + "</select></label></div>" +
      '<label class="cs-lab">추가 요청 <span class="cs-muted">(선택)</span></label><input data-tbg="extra" value="' + esc(g.extra || "") + '" placeholder="예: 예시는 쇼핑몰 고객센터 상황으로">' +
      ui.refs.draft.html(budget("draft", tb, m)) +
      (ui.locks.length ? '<div class="cs-locksum">고정: ' + ui.locks.slice().sort().map(TB().lockLabel).join(", ") + ' <button class="cs-link" data-act="tb-unlock-all">모두 해제</button></div>' : "") +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="tb-gen"' + (U().aiReady("write") ? "" : " disabled") + ">" + genLabel(tb) + '</button><span class="cs-muted">' + (U().aiReady("write") ? esc(U().aiName("write")) : "AI 키 필요") + "</span></div></details>";
  }
  function selResolve(sel, tb) {
    if (!sel) return null;
    var cur = String(sel.field === "overview" ? tb.overview : ((tb.sections[sel.i] || {}).body || ""));
    if (cur.slice(sel.start, sel.end) === sel.text) return Object.assign({}, sel, { cur: cur });
    var at = cur.indexOf(sel.text);
    return at < 0 ? null : Object.assign({}, sel, { start: at, end: at + sel.text.length, cur: cur });
  }
  function selHtml(tb) {
    var raw = ui.lastSel, sel = selResolve(raw, tb);
    if (!raw) return '<ol class="cs-ae-empty"><li><b>개요</b>나 <b>학습내용 본문</b>에서 고칠 글을 마우스로 드래그합니다.</li><li>드래그한 글이 이 칸에 노란색으로 표시됩니다.</li><li>아래에 고칠 방법을 적고 「수정안 만들기」를 누릅니다. 드래그한 부분만 바뀝니다.</li></ol>';
    var h = '<div class="cs-ae-card"><div class="cs-ae-h"><b>' + esc(raw.label) + '</b><span class="cs-muted"> · ' + raw.text.length.toLocaleString() + '자 선택</span> <button class="cs-link" data-act="tb-ae-clear">선택 해제</button></div>';
    if (!sel) return h + '<div class="cs-warn">선택한 글이 본문에서 바뀌어 찾을 수 없습니다. 다시 드래그해 주세요.</div></div>';
    var b = sel.cur.slice(Math.max(0, sel.start - 80), sel.start), a = sel.cur.slice(sel.end, sel.end + 80);
    return h + '<pre class="cs-ae-ctx"><span class="cs-fade">' + (sel.start > 80 ? "…" : "") + esc(b) + "</span><mark>" + esc(sel.text) + '</mark><span class="cs-fade">' + esc(a) + (sel.end + 80 < sel.cur.length ? "…" : "") + "</span></pre></div>";
  }
  function fieldsHtml(tb) {
    var T = TB().editTargets(tb), groups = [];
    T.forEach(function (t) { if (groups.indexOf(t.group) === -1) groups.push(t.group); });
    return '<div class="cs-ae-targets">' + groups.map(function (g) {
      return '<div class="cs-ae-g"><span class="cs-muted">' + g + "</span>" + T.filter(function (t) { return t.group === g; }).map(function (t) {
        var lk = locked(t.lock);
        return '<label class="cs-check' + (lk ? " cs-dim" : "") + '"' + (lk ? ' title="고정된 칸은 고칠 수 없습니다"' : "") + '><input type="checkbox" data-ae="' + t.key + '"' + (ui.aeKeys[t.key] && !lk ? " checked" : "") + (lk ? " disabled" : "") + "> " +
          esc(t.label.replace(g + " ", "") || t.label) + (lk ? " (고정)" : "") + "</label>";
      }).join("") + "</div>";
    }).join("") + "</div>";
  }
  function editPanel(c, tb) {
    var sel = ui.aeMode === "sel";
    return '<details class="cs-card cs-gen" data-tb-ae-d' + (ui.aeOpen ? " open" : "") + "><summary>AI 수정</summary>" +
      '<p class="cs-muted">이미 쓴 내용을 지시대로 고쳐 씁니다. 결과는 미리보기에서 확인한 뒤 반영됩니다.</p>' +
      '<label class="cs-lab">고칠 범위</label><span class="cs-seg2"><button class="' + (sel ? "" : "on") + '" data-act="tb-ae-mode" data-v="field">칸 고르기</button><button class="' + (sel ? "on" : "") + '" data-act="tb-ae-mode" data-v="sel">드래그한 부분만</button></span>' +
      '<div id="tb-ae-scope">' + (sel ? selHtml(tb) : fieldsHtml(tb)) + "</div>" +
      ui.refs.edit.html(budget("edit", tb, c.module)) +
      '<label class="cs-lab">어떻게 고칠까요</label><div class="cs-chips2">' + TB().EDIT_CHIPS.map(function (x) { return '<button class="cs-fchip" data-act="tb-ae-chip" data-v="' + esc(x) + '">' + esc(x) + "</button>"; }).join("") + "</div>" +
      '<textarea rows="3" data-tbe="ins" placeholder="예: 예시를 고객센터 챗봇 상황으로 바꾸고, 설명은 두 문단 이내로 줄여 주세요.">' + esc(ui.aeIns) + "</textarea>" +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="tb-ae-run"' + (U().aiReady("write") ? "" : " disabled") + ">수정안 만들기</button></div></details>";
  }

  /* ---------- 편집기 · 미리보기 ---------- */
  function editorHtml(tb) {
    return '<div class="cs-sec' + (locked("ov") ? " is-locked" : "") + '"><div class="cs-sec-h"><span class="cs-no">01</span><h4>개요</h4><div class="cs-spacer"></div>' + lockBtn("ov") + "</div>" +
      '<textarea rows="5" data-tb="overview" placeholder="어떤 문제 상황이 있는지 / 무엇을 해결해야 하는지 / 학습 후 무엇이 가능해지는지">' + esc(tb.overview) + "</textarea></div>" +
      '<div class="cs-sec"><div class="cs-sec-h"><span class="cs-no">02</span><h4>학습목표</h4><span class="cs-muted">~할 수 있다 · 3개 이하</span></div>' +
      tb.objectives.map(function (o, i) {
        return '<div class="cs-pair' + (locked("o" + i) ? " is-locked" : "") + '"><span class="cs-idx">' + (i + 1) + '</span><input data-tb="obj" data-i="' + i + '" value="' + esc(o) + '" aria-label="학습목표 ' + (i + 1) + '">' +
          lockBtn("o" + i) + '<button class="cs-link cs-danger-t" data-act="tb-del-obj" data-i="' + i + '">삭제</button></div>';
      }).join("") +
      '<div class="cs-actions"><button class="btn btn-ghost" data-act="tb-add-obj">＋ 학습목표 (빈 칸)</button><button class="btn btn-ghost" data-act="tb-ai-obj"' + (tb.objectives.length && U().aiReady("write") ? "" : " disabled") + ">＋ AI로 학습목표 추가</button></div></div>" +
      '<div class="cs-sec"><div class="cs-sec-h"><span class="cs-no">03</span><h4>학습내용</h4><span class="cs-muted">목표와 1:1 · 목록, ```코드블록, **굵게** 지원</span></div>' +
      (tb.sections.map(function (s, i) {
        return '<div class="cs-chunk' + (locked("c" + i) ? " is-locked" : "") + '"><div class="cs-chunk-h"><span class="cs-badge">목표 ' + (i + 1) + '</span><input data-tb="ctitle" data-i="' + i + '" value="' + esc(s.title) + '" placeholder="덩어리 제목">' + lockBtn("c" + i) + "</div>" +
          '<textarea rows="10" data-tb="cbody" data-i="' + i + '" aria-label="학습내용 ' + (i + 1) + ' 본문">' + esc(s.body) + "</textarea></div>";
      }).join("") || '<p class="cs-muted">학습목표를 추가하면 대응하는 학습내용 칸이 생깁니다.</p>') + "</div>" +
      '<div class="cs-sec"><div class="cs-sec-h"><span class="cs-no">04</span><h4>학습 후 체크리스트</h4><span class="cs-muted">목표와 1:1 · 다시 볼 위치</span></div>' +
      tb.checklist.map(function (k, i) {
        return '<div class="cs-pair' + (locked("k" + i) ? " is-locked" : "") + '"><span class="cs-idx">' + (i + 1) + '</span><div class="cs-stack1"><input data-tb="ck" data-i="' + i + '" value="' + esc(k.text) + '" aria-label="체크리스트 ' + (i + 1) + '">' +
          '<input class="cs-small" data-tb="ckref" data-i="' + i + '" value="' + esc(k.ref) + '" placeholder="다시 볼 곳 (예: 학습내용 ' + (i + 1) + ')"></div>' + lockBtn("k" + i) + "</div>";
      }).join("") + "</div>";
  }
  /* 미리보기 = 내보내는 교안 MD 그대로 (기존 교안 양식, 본문 이미지 포함) */
  function withImages(md) { return K.autoImages ? K.autoImages.expandTags(md) : md; }
  function bookMd(c) { return withImages(C().textbookModuleMd(c.course, c.unit, c.mi)); }
  function bookHtml(c) {
    var src = bookMd(c);
    return '<article class="cs-book md-render">' + (K.renderMarkdown ? K.renderMarkdown(src) : "<pre>" + esc(src) + "</pre>") + "</article>";
  }
  /* 교안 본문 이미지 — 소제목 아래에 들어간 그림 목록 · 빈 소제목 채우기 · 다시 만들기 · 빼기 */
  function photoStrip(c) {
    var m = c.module, L = K.lessonImages, A = K.autoImages;
    if (!L || !A || !K.courseAI.hasTextbook(m)) return "";
    var list = m.photos || [], miss = L.missing(m).length, old = L.stale(m).length, on = L.enabled();
    if (!list.length && !on) {
      return '<p class="cs-muted cs-photo-note">🖼 교안 본문 이미지 — ' + (A.count() ? "Google API 키를 저장하면" : "④ 산출물에서 이미지 자동 생성을 켜면") +
        " 학습내용의 소제목 아래에 그 내용을 보여 주는 그림을 자동으로 넣습니다.</p>";
    }
    var secTitle = function (p) { var s = ((m.content && m.content.sections) || [])[p.sec]; return "학습내용 " + (p.sec + 1) + (p.sub ? " › " + p.sub : s && s.title ? " › " + s.title : ""); };
    return '<div class="cs-photos"><div class="cs-photos-h"><b>🖼 교안 본문 이미지</b><span class="cs-muted">소제목 아래에 들어갑니다 · ' + list.length + "장</span><div class=\"cs-spacer\"></div>" +
      (on && (miss || old) ? '<button class="btn btn-ghost" data-act="tb-photos">' + (old ? "이전 그림 " + old + "장 새로 바꾸기" + (miss ? " · 빈 소제목 " + miss + "곳 채우기" : "") : "빈 소제목에 이미지 만들기 (" + miss + "곳)") + "</button>" : "") + "</div>" +
      (old ? '<p class="cs-muted cs-photo-note">이전 방식으로 만든 그림은 글자가 깨지거나 검은 띠가 있을 수 있어, 글자 없는 그림으로 새로 바꿉니다.</p>' : "") +
      (list.length ? '<div class="cs-photo-row">' + list.map(function (p) {
        var src = A.url(p.id);
        return '<figure class="cs-photo">' + (src ? '<img src="' + esc(src) + '" alt="' + esc(p.title) + '" loading="lazy">' : '<div class="cs-photo-miss">이 브라우저에 그림이 없습니다</div>') +
          '<figcaption title="' + esc(p.prompt || "") + '">' + esc(secTitle(p)) + ((p.v || 1) < L.PHOTO_V ? ' <span class="cs-muted">· 이전 그림</span>' : "") + "</figcaption>" +
          '<div class="cs-photo-act">' + (on ? '<button class="cs-link" data-act="tb-photo-redo" data-id="' + esc(p.id) + '">다시 만들기</button>' : "") +
          '<button class="cs-link cs-danger-t" data-act="tb-photo-del" data-id="' + esc(p.id) + '">빼기</button></div></figure>';
      }).join("") + "</div>" : '<p class="cs-muted">아직 넣은 그림이 없습니다.</p>') + "</div>";
  }
  function bookCard(c, tb) {
    return '<div class="cs-card"><div class="cs-card-head"><h3>교재</h3><span class="cs-seg2"><button class="' + (ui.preview ? "" : "on") + '" data-act="tb-pv" data-v="0">편집</button><button class="' + (ui.preview ? "on" : "") + '" data-act="tb-pv" data-v="1">미리보기</button></span>' +
      '<div class="cs-spacer"></div><button class="btn btn-ghost" data-act="tb-md">.md 저장</button><button class="btn btn-ghost" data-act="tb-copy">복사</button></div>' +
      '<div id="tb-area">' + (ui.preview ? bookHtml(c) : editorHtml(tb)) + "</div>" + photoStrip(c) + "</div>";
  }

  function render(c) {
    var m = c.module;
    sync(m);
    var tb = TB().tbOf(m), I = TB().lint(tb);
    return '<div class="cs-grid2"><div class="cs-stack">' + genPanel(c, tb) + (has(tb) ? editPanel(c, tb) : "") + bookCard(c, tb) + "</div>" +
      '<div class="cs-stack">' + reviewCard(c, I) + lessonCard(c) + "</div></div>";
  }

  /* 다시 그린 뒤: 접힘 상태 기억, 드래그 선택 수집, 파일 끌어 놓기 */
  function after(c) {
    var root = document.getElementById("course-root");
    [["[data-tb-gen-d]", "genOpen"], ["[data-tb-ae-d]", "aeOpen"], ["[data-tb-rules-d]", "rulesOpen"]].forEach(function (p) {
      var d = root.querySelector(p[0]);
      if (d) d.addEventListener("toggle", function () { ui[p[1]] = d.open; });
    });
    root.querySelectorAll('[data-tb="overview"],[data-tb="cbody"]').forEach(function (el) {
      ["mouseup", "keyup", "select"].forEach(function (ev) { el.addEventListener(ev, function () { capture(el); }); });
    });
    if (ui.lastSel && ui.aeMode === "sel") markTarget();
    root.querySelectorAll("[data-ref-drop]").forEach(function (z) {
      z.addEventListener("dragover", function (e) { e.preventDefault(); z.classList.add("over"); });
      z.addEventListener("dragleave", function () { z.classList.remove("over"); });
      z.addEventListener("drop", function (e) { e.preventDefault(); z.classList.remove("over"); addFiles(z.dataset.refDrop, e.dataTransfer.files); });
    });
    Object.keys(ui.refErr).forEach(function (s) { var el = root.querySelector('[data-ref-err="' + s + '"]'); if (el) el.textContent = ui.refErr[s] || ""; });
  }
  function capture(el) {
    if (ui.aeMode !== "sel") return;
    var a = el.selectionStart, b = el.selectionEnd;
    if (a == null || b == null || b - a < 2) return;
    var v = el.value, ov = el.dataset.tb === "overview", i = Number(el.dataset.i);
    ui.lastSel = { field: ov ? "overview" : "body", i: ov ? 0 : i, start: a, end: b, text: v.slice(a, b), before: v.slice(Math.max(0, a - 200), a), after: v.slice(b, b + 200), label: ov ? "개요" : "학습내용 " + (i + 1) + " 본문" };
    var box = document.getElementById("tb-ae-scope");
    if (box) box.innerHTML = selHtml(TB().tbOf(U().ctx().module));
    markTarget();
  }
  function markTarget() {
    document.querySelectorAll(".cs-ae-target").forEach(function (x) { x.classList.remove("cs-ae-target"); });
    var s = ui.lastSel;
    if (!s) return;
    var el = document.querySelector(s.field === "overview" ? '[data-tb="overview"]' : '[data-tb="cbody"][data-i="' + s.i + '"]');
    if (el) el.classList.add("cs-ae-target");
  }

  /* ---------- 편집 → 학습모듈에 바로 반영 ---------- */
  var saveT = null;
  function ensureContent(m) {
    if (!m.content) m.content = { overview: "", sections: [], checklist: [], by: "직접 작성" };
    var c = m.content, n = m.objectives.length;
    c.sections = c.sections || []; c.checklist = c.checklist || [];
    while (c.sections.length < n) c.sections.push({ title: "", body: "" });
    while (c.checklist.length < n) c.checklist.push({ text: "", ref: "학습내용 " + (c.checklist.length + 1) });
    return c;
  }
  function changed(m) {
    var s = document.getElementById("tb-save");
    if (s) s.textContent = "저장 대기";
    var box = document.getElementById("tb-lint");
    if (box) box.innerHTML = lintHtml(TB().lint(TB().tbOf(m)));
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      if (m.content) m.content.lint = C().lintModule(m);
      U().save();
      var s2 = document.getElementById("tb-save");
      if (s2) s2.textContent = "저장됨";
    }, 700);
  }
  function input(el, c) {
    var m = c.module;
    if (!m) return false;
    var f = el.dataset.tb, i = Number(el.dataset.i);
    if (f) {
      sync(m);
      if (f === "obj") { m.objectives[i] = el.value; ensureContent(m); }
      else {
        var ct = ensureContent(m);
        if (f === "overview") ct.overview = el.value;
        else if (f === "ctitle") ct.sections[i].title = el.value;
        else if (f === "cbody") ct.sections[i].body = el.value;
        else if (f === "ck") ct.checklist[i].text = el.value;
        else if (f === "ckref") ct.checklist[i].ref = el.value;
      }
      changed(m);
      return true;
    }
    if (el.dataset.tbg) { gen(m)[el.dataset.tbg] = el.value; U().save(); return true; }
    if (el.dataset.tbe === "ins") { ui.aeIns = el.value; return true; }
    if (el.hasAttribute("data-tb-ao")) { ui.addHint = el.value; return true; }
    return false;
  }
  function refScope(el) { var b = el.closest("[data-ref-scope]"); return b ? b.dataset.refScope : null; }
  function change(el, c) {
    var m = c.module;
    if (!m) return false;
    if (el.dataset.tbg) { gen(m)[el.dataset.tbg] = el.tagName === "SELECT" && el.dataset.tbg === "n" ? Number(el.value) : el.value; U().save(); return true; }
    if (el.dataset.ae) { ui.aeKeys[el.dataset.ae] = el.checked; return true; }
    if (el.dataset.review) {
      m.review = m.review || {};
      if (el.checked) m.review[el.dataset.review] = { at: Date.now() }; else delete m.review[el.dataset.review];
      C().logChange(m, "수동 검수 " + (el.checked ? "확인" : "해제") + ": " + (R().MANUAL_RULES.filter(function (r) { return r.key === el.dataset.review; })[0] || {}).text);
      U().save(); U().render();
      return true;
    }
    if (el.dataset.fix != null) { fixCount(); return true; }
    if (el.hasAttribute("data-tb-qmode")) { if (ui.del) ui.del.qMode = el.value; return true; }
    var scope = refScope(el);
    if (scope && ui) {
      var B = ui.refs[scope];
      if (el.dataset.refFile) { addFiles(scope, el.files); return true; }
      var id = el.dataset.refOn || el.dataset.refFrom || el.dataset.refTo;
      var s = B.sel[id];
      if (!s) return true;
      if (el.dataset.refOn) s.on = el.checked;
      if (el.dataset.refFrom) s.from = Number(el.value) || s.from;
      if (el.dataset.refTo) s.to = Number(el.value) || s.to;
      if (s.from > s.to) { var t = s.from; s.from = s.to; s.to = t; }
      U().render();
      return true;
    }
    return false;
  }

  /* ---------- 참고 자료 ---------- */
  function addFiles(scope, files) {
    if (!files || !files.length) return;
    var B = ui.refs[scope];
    ui.refErr[scope] = "";
    U().run("참고 자료 읽는 중…", function (prog) {
      return B.add(files, {
        status: function (t) { if (t) prog(t); },
        error: function (t) { ui.refErr[scope] = t; },
        toast: U().toast,
        askScan: function (file, doc, n) { ui.scan = { scope: scope, file: file, doc: doc, n: n }; setTimeout(scanDialog, 0); },
        render: function () {}
      });
    });
  }
  function scanDialog() {
    var s = ui.scan, n = s.n, max = Math.min(n, 20), can = TB().canSee("fast");
    U().openDialog('<div class="cs-dlg-h"><h3>글자가 없는 PDF</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      "<p>「" + esc(s.file.name) + "」에서 글자를 거의 찾지 못했습니다. 스캔본이거나 글자가 그림으로 들어간 PDF로 보입니다.</p>" +
      (can ? '<p class="cs-muted">페이지를 이미지로 바꿔 AI가 글자를 옮겨 적게 할 수 있습니다. 쪽마다 AI 사용량이 들고, 한 번에 최대 20쪽까지 읽습니다.</p>' +
        '<div class="cs-q-form"><label>읽을 범위 <input id="tb-scan-from" type="number" min="1" max="' + n + '" value="1"> ~ <input id="tb-scan-to" type="number" min="1" max="' + n + '" value="' + max + '"> / 전체 ' + n + "쪽</label></div>"
        : '<p class="cs-muted">이미지를 읽으려면 Google 또는 Claude API 키가 필요합니다. 글자가 들어 있는 PDF로 다시 저장하거나 PPTX 원본을 올려 주세요.</p>') +
      '</div><div class="cs-dlg-f"><button class="btn btn-ghost" data-act="dlg-close">취소</button>' + (can ? '<button class="btn btn-primary" data-act="tb-scan-go">이미지로 읽기</button>' : "") + "</div>");
  }

  /* ---------- 변경 미리보기 (생성·수정 공용) ---------- */
  function fieldUnits(n) {
    var u = [{ key: "overview", lock: "ov", label: "개요", where: "개요", get: function (t) { return t.overview; }, set: function (t, v) { t.overview = v; } }];
    var i;
    for (i = 0; i < n; i++) (function (i) { u.push({ key: "obj" + i, lock: "o" + i, label: "학습목표 " + (i + 1), where: "학습목표 " + (i + 1), get: function (t) { return t.objectives[i]; }, set: function (t, v) { t.objectives[i] = v; } }); })(i);
    for (i = 0; i < n; i++) (function (i) {
      u.push({ key: "ct" + i, lock: "c" + i, label: "학습내용 " + (i + 1) + " · 제목", where: "학습내용 " + (i + 1), get: function (t) { return (t.sections[i] || {}).title; }, set: function (t, v) { t.sections[i].title = v; } });
      u.push({ key: "cb" + i, lock: "c" + i, label: "학습내용 " + (i + 1) + " · 본문", where: "학습내용 " + (i + 1), get: function (t) { return (t.sections[i] || {}).body; }, set: function (t, v) { t.sections[i].body = v; } });
    })(i);
    for (i = 0; i < n; i++) (function (i) {
      u.push({ key: "ck" + i, lock: "k" + i, label: "체크리스트 " + (i + 1), where: "체크리스트 " + (i + 1), get: function (t) { return (t.checklist[i] || {}).text; }, set: function (t, v) { t.checklist[i].text = v; } });
      u.push({ key: "cr" + i, lock: "k" + i, label: "체크리스트 " + (i + 1) + " · 다시 볼 곳", where: "체크리스트 " + (i + 1), get: function (t) { return (t.checklist[i] || {}).ref; }, set: function (t, v) { t.checklist[i].ref = v; } });
    })(i);
    return u;
  }
  function setText(t, i) {
    return "학습목표: " + (t.objectives[i] || "") + "\n\n학습내용 제목: " + ((t.sections[i] || {}).title || "") + "\n" + ((t.sections[i] || {}).body || "") +
      "\n\n체크리스트: " + ((t.checklist[i] || {}).text || "") + " (다시 볼 곳: " + ((t.checklist[i] || {}).ref || "") + ")";
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function previewApply(cur, next, mode, picks) {
    if (mode !== "units") return clone(next);
    var t = clone(cur);
    picks.filter(function (p) { return p.u.add == null; }).forEach(function (p) { p.u.set(t, p.b); });
    picks.filter(function (p) { return p.u.add != null; }).sort(function (a, b) { return a.u.add - b.u.add; }).forEach(function (p) {
      var i = p.u.add;
      t.objectives.push(next.objectives[i]); t.sections.push(clone(next.sections[i]));
      var ck = clone(next.checklist[i]), pos = t.checklist.length + 1;
      ck.ref = String(ck.ref || "").replace(/^학습내용\s*\d+/, "학습내용 " + pos) || "학습내용 " + pos;
      t.checklist.push(ck);
    });
    return t;
  }
  function openReview(m, base, next, opts) {
    var bn = base.objectives.length, nn = next.objectives.length;
    var mode = nn < bn ? "replace" : "units";
    var skip = opts.skipKeys || [], off = opts.offKeys || [], issues = opts.issues || [];
    var changes = [];
    if (mode === "units") {
      changes = fieldUnits(bn).filter(function (u) { return skip.indexOf(u.lock) === -1; })
        .map(function (u) { return { u: u, a: u.get(base) || "", b: u.get(next) || "" }; }).filter(function (x) { return x.a !== x.b; });
      for (var i = bn; i < nn; i++) changes.push({ u: { key: "set" + i, label: "학습목표 " + (i + 1) + " 세트 (새로 추가)", where: null, add: i }, a: "", b: setText(next, i) });
      if (!changes.length) { U().toast("바뀐 부분이 없습니다."); return; }
    }
    var after = TB().lint(previewApply(base, next, mode, changes.filter(function (x) { return off.indexOf(x.u.key) === -1; }))).length;
    ui.fix = { id: m.id, base: base, next: next, mode: mode, changes: changes, opts: opts, n: bn };
    var W = R().wordDiff;
    var list = mode === "units" ? '<div class="cs-row-s"><button class="cs-link" data-act="fix-all" data-v="1">모두 선택</button> · <button class="cs-link" data-act="fix-all" data-v="0">모두 해제</button></div>' +
      changes.map(function (x, k) {
        var iss = x.u.where && !/^cr/.test(x.u.key) ? issues.filter(function (v) { return v.where === x.u.where; }) : [];
        return '<div class="cs-fix' + (x.u.add != null ? " add" : "") + '"><label class="cs-fix-h"><input type="checkbox" data-fix="' + k + '"' + (off.indexOf(x.u.key) === -1 ? " checked" : "") + "><b>" + esc(x.u.label) + "</b>" +
          (off.indexOf(x.u.key) !== -1 ? '<span class="cs-badge">선택 사항</span>' : "") +
          iss.slice(0, 3).map(function (v) { return '<span class="cs-badge ' + v.sev + '" title="' + esc(v.msg) + '">' + esc(v.msg.length > 22 ? v.msg.slice(0, 22) + "…" : v.msg) + "</span>"; }).join("") +
          '</label><div class="cs-diff">' + (x.u.add != null ? "<ins>" + esc(x.b) + "</ins>" : W(x.a, x.b)) + "</div></div>";
      }).join("")
      : '<div class="cs-fix"><b>학습목표</b><div class="cs-diff">' + W(base.objectives.map(function (o, i) { return (i + 1) + ". " + o; }).join("\n"), next.objectives.map(function (o, i) { return (i + 1) + ". " + o; }).join("\n")) + "</div></div>" +
        '<div class="cs-fix"><b>개요</b><div class="cs-diff">' + W(base.overview, next.overview) + "</div></div>" +
        next.sections.map(function (s, i) { return '<div class="cs-fix"><b>학습내용 ' + (i + 1) + '</b><div class="cs-diff">' + W(((base.sections[i] || {}).title || "") + "\n" + ((base.sections[i] || {}).body || ""), s.title + "\n" + s.body) + "</div></div>"; }).join("") +
        '<div class="cs-fix"><b>체크리스트</b><div class="cs-diff">' + W(base.checklist.map(function (k) { return "- " + k.text + " (" + k.ref + ")"; }).join("\n"), next.checklist.map(function (k) { return "- " + k.text + " (" + k.ref + ")"; }).join("\n")) + "</div></div>";
    U().openDialog('<div class="cs-dlg-h"><h3>' + esc(opts.title || "변경 미리보기") + '</h3><button class="btn btn-ghost" data-act="fix-cancel">닫기</button></div><div class="cs-dlg-b">' +
      '<div class="cs-fix-sum"><span class="cs-badge ' + (issues.length ? "bad" : "ok") + '">지적 ' + issues.length + '건</span> → <span class="cs-badge ' + (after ? "warn" : "ok") + '">적용 시 ' + after + "건</span> " +
      '<span class="cs-muted">' + (mode === "units" ? "바뀌는 곳 " + changes.length + "군데 · 적용할 항목만 체크하세요." : "학습목표 개수가 줄어 교재 전체를 한 번에 교체합니다.") + "</span></div>" +
      (skip.length ? '<p class="cs-muted">' + (mode === "units" ? "고정한 칸 " + skip.length + "개(" + skip.map(TB().lockLabel).join(", ") + ")는 바꾸지 않았습니다."
        : "고정한 칸 중 남는 번호의 칸은 유지했습니다. 없어지는 학습목표 번호에 연결된 문항·삽화 배치·NCS 대응은 적용할 때 연결이 해제됩니다.") + "</p>"
        : mode === "units" ? "" : '<p class="cs-muted">없어지는 학습목표 번호에 연결된 문항·삽화 배치·NCS 대응은 적용할 때 연결이 해제됩니다.</p>') +
      '<p class="cs-muted"><del>지워지는 부분</del> <ins>추가되는 부분</ins></p>' + list + "</div>" +
      '<div class="cs-dlg-f"><button class="btn btn-ghost" data-act="fix-cancel">취소</button><button class="btn btn-primary" id="tb-fix-apply" data-act="fix-apply">' + (mode === "units" ? "" : "전체 교체") + "</button></div>", true);
    fixCount();
  }
  function fixCount() {
    var b = document.getElementById("tb-fix-apply");
    if (!b || !ui.fix) return;
    if (ui.fix.mode !== "units") { b.textContent = "전체 교체"; b.disabled = false; return; }
    var n = U().dialogEl().querySelectorAll("[data-fix]:checked").length;
    b.textContent = n ? "선택한 " + n + "군데 적용" : "적용할 항목을 선택하세요";
    b.disabled = !n;
  }
  function applyFix() {
    var f = ui.fix;
    if (!f) return;
    var hit = U().locate(f.id);
    if (!hit) { U().closeDialog(); ui.fix = null; return; }
    var m = hit.module, cur = TB().tbOf(m), tb, cnt = null;
    if (f.mode === "units" && cur.objectives.length !== f.n) { U().toast("미리보기를 만드는 동안 학습목표 개수가 바뀌어 적용할 수 없습니다. 다시 생성하세요."); U().closeDialog(); ui.fix = null; return; }
    if (f.mode === "units") {
      var picks = Array.prototype.map.call(U().dialogEl().querySelectorAll("[data-fix]:checked"), function (x) { return f.changes[Number(x.dataset.fix)]; });
      tb = previewApply(cur, f.next, f.mode, picks); cnt = picks.length;
    } else tb = clone(f.next);
    var dropped = cur.objectives.length - tb.objectives.length;
    TB().applyTB(m, tb);
    if (dropped > 0) C().trimObjectiveRefs(m, tb.objectives.length);
    if (f.opts.byAi) m.content.by = U().aiName("write");
    if (f.opts.ideas && f.opts.ideas.length) m.ideas = f.opts.ideas;
    if (f.opts.quest) m.content.quest = f.opts.quest;
    C().logChange(m, (f.opts.log || "AI 변경") + " (" + (cnt == null ? "전체 교체" : cnt + "군데 적용") + ")");
    ui.fix = null;
    U().closeDialog(); U().save(); U().render();
    var left = TB().lint(tb).length;
    U().toast(left ? "적용했습니다. 남은 지적 " + left + "건은 직접 확인하세요." : "적용했습니다. 규칙 위반이 없습니다.");
  }

  /* ---------- 학습목표 추가·삭제 ---------- */
  function delDialog(c, i) {
    var m = c.module, tb = TB().tbOf(m), no = i + 1;
    var qs = (m.questions || []).filter(function (q) { return q.objective === no; }).length;
    var ills = (m.ills || []).filter(function (x) { return x.placement === i; }).length;
    ui.del = { i: i, qMode: "keep" };
    U().openDialog('<div class="cs-dlg-h"><h3>학습목표 ' + no + ' 삭제</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      "<p>학습목표·학습내용·체크리스트는 1:1로 대응하므로 세트로 함께 삭제됩니다.</p><ul class=\"cs-impact\">" +
      "<li><b>학습목표 " + no + "</b> " + esc(tb.objectives[i] || "(비어 있음)") + "</li>" +
      "<li><b>학습내용 " + no + "</b> " + esc((tb.sections[i] || {}).title || "(제목 없음)") + " · " + ((tb.sections[i] || {}).body || "").length.toLocaleString() + "자</li>" +
      "<li><b>체크리스트 " + no + "</b> " + esc((tb.checklist[i] || {}).text || "(비어 있음)") + "</li>" +
      (ills ? "<li>여기 배치한 삽화 " + ills + "개는 배치만 해제됩니다(삽화는 남습니다).</li>" : "") +
      (no < tb.objectives.length ? "<li>뒤쪽 학습목표 번호가 하나씩 당겨지고, 문항·체크리스트·NCS 대응 번호도 함께 고칩니다.</li>" : "") + "</ul>" +
      (qs ? '<p><b>이 학습목표에 연결된 문항 ' + qs + "개</b></p>" +
        '<label class="cs-check"><input type="radio" name="tb-qm" data-tb-qmode value="keep" checked> 문항은 남기고 연결만 해제 (문제은행에서 「목표 없음」으로 표시)</label>' +
        '<label class="cs-check"><input type="radio" name="tb-qm" data-tb-qmode value="delete"> 문항도 함께 삭제</label>' : "") +
      '</div><div class="cs-dlg-f"><button class="btn btn-ghost" data-act="dlg-close">취소</button><button class="cs-danger" data-act="tb-del-go">삭제</button></div>');
  }
  function addObjDialog(c) {
    var n = c.module.objectives.length;
    U().openDialog('<div class="cs-dlg-h"><h3>AI로 학습목표 추가</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<p class="cs-muted">기존 학습목표 ' + n + "개와 그 학습내용·체크리스트는 그대로 두고, 학습목표 " + (n + 1) + "과 대응하는 학습내용·체크리스트를 새로 만듭니다. 개요를 새 목표에 맞게 고친 안도 함께 제안하며, 미리보기에서 반영 여부를 고를 수 있습니다.</p>" +
      (n >= 3 ? '<div class="cs-warnbox">학습목표가 이미 ' + n + "개입니다. 설계 규칙상 4개 이상이면 학습모듈 분할을 검토합니다.</div>" : "") +
      '<label class="cs-lab">새 학습목표에서 다룰 내용 <span class="cs-muted">(선택 — 비워 두면 기존 목표와 가르칠 내용을 보고 빠진 부분을 골라 씁니다)</span></label>' +
      '<textarea rows="3" data-tb-ao placeholder="예: 출력 형식을 표로 고정하는 방법">' + esc(ui.addHint) + "</textarea></div>" +
      '<div class="cs-dlg-f"><button class="btn btn-ghost" data-act="dlg-close">취소</button><button class="btn btn-primary" data-act="tb-ai-obj-go">' + (n >= 3 ? "그래도 추가" : "생성") + "</button></div>");
  }

  /* ---------- 동작 ---------- */
  function draft(c, o) {
    var m = c.module, g = gen(m), base = TB().tbOf(m);
    var locks = o.locks || ui.locks.slice();
    U().closeDialog();
    U().run(o.label || "교재 " + (has(base) ? "새로 쓰는 중…" : "초안 생성 중…") + " (" + U().aiName("write") + ")", function (prog) {
      return K.courseAI.draftTextbook(c.course, c.unit, m, {
        base: base, notes: g.notes, n: o.count || defaultN(m), level: g.level, length: g.length, extra: o.extra != null ? o.extra : g.extra,
        locks: locks, refs: o.noRefs ? "" : ui.refs.draft.block("draft")
      }).then(function (r) {
        if (r.raised) U().toast("고정한 칸이 학습목표 " + r.n + "번까지 있어 학습목표 " + r.n + "개로 생성했습니다.");
        var editedMeanwhile = JSON.stringify(TB().tbOf(m)) !== JSON.stringify(base);
        if (TB().isEmpty(base) && !o.count && !editedMeanwhile) {
          TB().applyTB(m, r.tb);
          m.content.by = U().aiName("write");
          if (r.ideas.length) m.ideas = r.ideas;
          if (r.quest) m.content.quest = r.quest;
          C().logChange(m, "AI 초안 생성");
          if (!K.courseAuto) { U().toast("초안을 만들었습니다. 오른쪽 검수 결과를 확인하세요."); return; }
          // 새 초안: 학습내용마다 삽화를 그려 넣고, 능력단위요소를 자동 배정한다(NCS 탭에서 확정)
          return K.courseAuto.afterTextbook(c.course, c.unit, m, function (l) { prog(l); }).then(function (a) {
            U().toast("초안을 만들었습니다." + (a.ills ? " 삽화 " + a.ills + "개를 학습내용에 넣었습니다." : "") + (a.photos ? " 본문 이미지 " + a.photos + "장을 소제목 아래에 넣었습니다." : "") +
              (a.ncs ? " NCS 능력단위요소를 자동 배정했습니다 — NCS 탭에서 확정하세요." : "") + " 오른쪽 검수 결과를 확인하세요.");
          });
        }
        if (editedMeanwhile) U().toast("생성하는 동안 교재가 바뀌어 미리보기에서 골라 적용합니다.");
        openReview(m, TB().tbOf(m), r.tb, {
          title: o.title || (locks.length ? "생성 결과 미리보기" : "전체 새로 쓰기 미리보기"), issues: TB().lint(base), offKeys: o.offKeys || [], skipKeys: locks,
          log: o.log || (locks.length ? "AI 고정 외 새로 쓰기 (고정 " + locks.length + "칸)" : "AI 전체 새로 쓰기"), ideas: locks.length ? null : r.ideas, quest: locks.length ? null : r.quest, byAi: true
        });
      });
    });
  }

  var actions = {
    "tb-lock": function (el) {
      var k = el.dataset.k, i = ui.locks.indexOf(k);
      if (i === -1) ui.locks.push(k); else ui.locks.splice(i, 1);
      if (i === -1) Object.keys(ui.aeKeys).forEach(function (key) { if (TB().editTargets(TB().tbOf(U().ctx().module)).some(function (t) { return t.key === key && t.lock === k; })) ui.aeKeys[key] = false; });
      U().render();
    },
    "tb-unlock-all": function () { ui.locks = []; U().render(); },
    "tb-pv": function (el) { ui.preview = el.dataset.v === "1"; U().render(); },
    "tb-md": function (el, c) { U().download(U().safeName("교재 - " + c.module.title) + ".md", bookMd(c)); },
    "tb-copy": function (el, c) {
      var text = bookMd(c);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { U().toast("교재 마크다운을 복사했습니다."); }, function () { U().toast("복사하지 못했습니다. .md 저장을 이용하세요."); });
      else U().toast("이 브라우저에서는 복사할 수 없습니다. .md 저장을 이용하세요.");
    },
    "tb-gen": function (el, c) { draft(c, {}); },
    "tb-fix": function (el, c) {
      var m = c.module, tb = TB().tbOf(m), locks = ui.locks.slice();
      U().run("규칙 위반 수정안 만드는 중… (" + U().aiName("write") + ")", function () {
        return K.courseAI.fixTextbook(c.course, c.unit, m, tb, locks).then(function (r) {
          openReview(m, tb, r.tb, { title: "수정 미리보기", issues: r.issues, log: "규칙 위반 AI 수정", skipKeys: locks });
        });
      });
    },
    "tb-ae-mode": function (el) { ui.aeMode = el.dataset.v; U().render(); },
    "tb-ae-clear": function () { ui.lastSel = null; markTarget(); var box = document.getElementById("tb-ae-scope"); if (box) box.innerHTML = selHtml(TB().tbOf(U().ctx().module)); },
    "tb-ae-chip": function (el) {
      var v = el.dataset.v;
      ui.aeIns = ui.aeIns.trim() ? ui.aeIns.replace(/\s*$/, "") + (/[.。]$/.test(ui.aeIns.trim()) ? " " : ", ") + v : v;
      var t = document.querySelector('[data-tbe="ins"]');
      if (t) { t.value = ui.aeIns; t.focus(); }
    },
    "tb-ae-run": function (el, c) {
      var m = c.module, tb = TB().tbOf(m), ins = ui.aeIns.trim();
      var sel = ui.aeMode === "sel" ? selResolve(ui.lastSel, tb) : null;
      var keys = ui.aeMode === "sel" ? [] : Object.keys(ui.aeKeys).filter(function (k) { return ui.aeKeys[k]; });
      if (ui.aeMode === "sel" && !sel) { U().toast(ui.lastSel ? "선택한 글이 본문에서 바뀌었습니다. 다시 드래그해 주세요." : "개요나 학습내용 본문에서 고칠 부분을 먼저 드래그해 주세요."); return; }
      if (!ins) { U().toast("어떻게 고칠지 적거나 빠른 지시 버튼을 골라 주세요."); return; }
      if (sel && locked(sel.field === "overview" ? "ov" : "c" + sel.i)) { U().toast("선택한 부분이 고정된 칸에 있습니다. 고정을 풀고 다시 시도하세요."); return; }
      if (!sel && !keys.length) { U().toast("고칠 칸을 하나 이상 고르세요."); return; }
      var T = TB().editTargets(tb), mine = ui, locks = ui.locks.slice();
      U().run("AI 수정안 만드는 중… (" + U().aiName("write") + ")", function () {
        return K.courseAI.editTextbook(c.course, c.unit, m, tb, { keys: keys, sel: sel, ins: ins, refs: ui.refs.edit.block("edit") }).then(function (next) {
          mine.lastSel = null; mine.aeIns = "";
          openReview(m, tb, next, { title: "AI 수정 미리보기", issues: TB().lint(tb), skipKeys: locks,
            log: "AI 부분 수정" + (sel ? " (" + sel.label + " 일부)" : " (" + keys.map(function (k) { return (T.filter(function (t) { return t.key === k; })[0] || {}).label; }).join(", ") + ")") + ": " + ins.slice(0, 40) });
        });
      });
    },
    "fix-all": function (el) { U().dialogEl().querySelectorAll("[data-fix]").forEach(function (x) { x.checked = el.dataset.v === "1"; }); fixCount(); },
    "fix-apply": function () { applyFix(); },
    "fix-cancel": function () { ui.fix = null; U().closeDialog(); },
    "tb-add-obj": function (el, c) {
      var m = c.module;
      if (m.objectives.length >= 3 && !confirm("학습목표가 이미 " + m.objectives.length + "개입니다. 4개 이상이면 학습모듈 분할을 검토합니다. 그래도 추가할까요?")) return;
      ensureContent(m);
      m.objectives.push("");
      ensureContent(m);
      C().logChange(m, "학습목표 " + m.objectives.length + " 추가 (빈 칸)");
      U().save(); U().render();
    },
    "tb-del-obj": function (el, c) { delDialog(c, Number(el.dataset.i)); },
    "tb-del-go": function (el, c) {
      var d = ui.del;
      if (!d) return;
      C().deleteObjective(c.module, d.i, d.qMode);
      ui.locks = TB().shiftLocks(ui.locks, d.i);
      ui.aeKeys = {}; ui.lastSel = null;
      if (c.module.content) c.module.content.lint = C().lintModule(c.module);
      ui.del = null;
      U().closeDialog(); U().save(); U().render();
      U().toast("학습목표 " + (d.i + 1) + " 세트를 삭제했습니다.");
    },
    "tb-ai-obj": function (el, c) { addObjDialog(c); },
    "tb-ai-obj-go": function (el, c) {
      var n = c.module.objectives.length, hint = ui.addHint.trim(), locks = [];
      for (var i = 0; i < n; i++) locks.push("o" + i, "c" + i, "k" + i);
      ui.addHint = "";
      draft(c, { locks: locks, count: n + 1, noRefs: false, label: "학습목표 " + (n + 1) + " 만드는 중… (" + U().aiName("write") + ")",
        extra: "새로 추가하는 학습목표 " + (n + 1) + (hint ? "에서 다룰 내용: " + hint : "은 기존 목표에서 다루지 않은 부분으로 정합니다.") + " 개요는 새 목표까지 아우르도록 고쳐 씁니다.",
        offKeys: ["overview"], title: "학습목표 " + (n + 1) + " 추가 미리보기", log: "AI로 학습목표 " + (n + 1) + " 추가" });
    },
    "ref-view": function (el) {
      var id = el.dataset.id, B = ui.refs.draft.find(id) ? ui.refs.draft : ui.refs.edit;
      U().openDialog(B.viewHtml(id), true);
    },
    "ref-del": function (el) {
      var id = el.dataset.id;
      (ui.refs.draft.find(id) ? ui.refs.draft : ui.refs.edit).remove(id);
      U().render();
    },
    "tb-scan-go": function () {
      var s = ui.scan;
      if (!s) return;
      var a = Math.max(1, Number((document.getElementById("tb-scan-from") || {}).value) || 1);
      var b = Math.min(s.n, Number((document.getElementById("tb-scan-to") || {}).value) || 20);
      if (b < a) { var t = a; a = b; b = t; }
      if (b - a + 1 > 20) b = a + 19;
      U().closeDialog();
      U().run("스캔 PDF 읽는 중…", function (prog) {
        return ui.refs[s.scope].scan(s.file, s.doc, a, b, function (msg) { prog(msg); }).then(function () {
          U().toast("「" + s.file.name + "」 " + (b - a + 1) + "쪽을 참고 자료에 추가했습니다.");
          ui.scan = null;
        });
      });
    },
    "tb-photos": function (el, c) {
      U().run("교안 본문 이미지 만드는 중…", function (prog) {
        return K.lessonImages.generate(c.course, c.unit, c.module, function (l) { prog(l); }).then(function (r) {
          var done = (r.made || 0) + (r.replaced || 0);
          if (done && c.unit.outputs) K.courseAI.buildOutputs(c.course, c.unit);
          U().toast(done ? "본문 이미지 " + (r.made ? r.made + "장을 소제목 아래에 넣고" : "") + (r.replaced ? (r.made ? " " : "") + r.replaced + "장을 새로 바꾸고" : "") + " 마쳤습니다." + (r.failed ? " (실패 " + r.failed + "장)" : "")
            : "이미지를 만들지 못했습니다" + (r.failed ? " (실패 " + r.failed + "장) — Google API 키·할당량을 확인하세요." : "."));
        });
      });
    },
    "tb-photo-redo": function (el, c) {
      var id = el.dataset.id;
      U().run("본문 이미지 다시 만드는 중…", function () {
        return K.lessonImages.redo(c.course, c.unit, c.module, id).then(function (done) { U().toast(done ? "새 그림으로 바꿨습니다." : "다시 만들 수 없습니다."); });
      });
    },
    "tb-photo-del": function (el, c) {
      if (!K.lessonImages.remove(c.course, c.module, el.dataset.id)) return;
      U().save(); U().render();
      U().toast("그림을 뺐습니다. 「빈 소제목에 이미지 만들기」로 다시 넣을 수 있습니다.");
    },
    "tb-lesson": function (el, c) {
      var fresh = !K.courseAI.hasTextbook(c.module);
      U().run((fresh ? "교재·교수안·슬라이드" : "교수안·슬라이드") + " 만드는 중… (" + U().aiName("write") + ")", function (prog) {
        return K.courseAI.generateModule(c.course, c.unit, c.mi, function (l) { prog(l); }).then(function () {
          if (c.unit.outputs) K.courseAI.buildOutputs(c.course, c.unit);
          U().toast((fresh ? "교재와 교수안 지침·슬라이드를" : "교수안 지침과 슬라이드를") + " 만들었습니다. ④ 산출물에서 확인하세요.");
        });
      });
    },
    "tb-assemble": function (el, c) { K.courseAI.buildOutputs(c.course, c.unit); U().save(); U().toast("단원 산출물을 현재 내용으로 다시 조립했습니다."); }
  };

  K.courseTabs = K.courseTabs || {};
  K.courseTabs.textbook = {
    label: "교재", render: render, after: after, actions: actions, input: input, change: change,
    badge: function (m) {
      if (!m.content) return "";
      var bad = K.courseRules.lintTextbook(m).filter(function (v) { return v.sev === "bad"; }).length;
      return bad ? '<span class="cs-cnt bad">' + bad + "</span>" : '<span class="cs-cnt ok">✓</span>';
    },
    md: md
  };
})();
