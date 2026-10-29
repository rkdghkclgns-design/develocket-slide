/* course-qbank.js — 학습모듈 '문제은행' 탭 (K.courseTabs.qbank)
 *   목표×밴드 분포(권장 L1 10 · L2 5 · L3 3) · 밴드 설명 · 문항 생성(AI: 기존 문항 중복 회피 → 자동 검수 1회 수정 → 혼합 모드 교차 검수)
 *   문항 검수 카드(통과 n/N · 지적 문항 · 검사 규칙 목록) · 편집(객관식 보기 · 단답식 허용 표기 · 서술형 모범 답안+채점 요소 ·
 *   코드제출 테스트 케이스 · 파일제출 루브릭 충족/부분/미흡) · 밴드·목표 필터 · CSV
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var U = function () { return K.cui; };
  var C = function () { return K.course; };
  var R = function () { return K.courseRules; };
  var esc = function (s) { return U().esc(s); };
  var opt = function (v, l, cur) { return U().opt(v, l, cur); };
  var COUNTS = [1, 2, 3, 5, 8, 10];
  var ui = { for: null, band: "", obj: "", help: false, rulesOpen: false, editing: null, draft: null,
    gen: { objective: 1, band: "L1", type: "객관식", multi: false, count: 3 } };

  function lintQ(q, m) { return R().lintQuestion(q, m); }
  function statusHtml(I, q) {
    var bad = I.filter(function (x) { return x.sev === "bad"; }).length;
    var ai = q.review ? ' <span class="cs-muted">AI 교차 검수 · ' + esc(q.review.by) + (q.review.ok ? " ✓" : " ✕") + "</span>" : "";
    return (!I.length ? '<span class="cs-qstat ok">검수 통과</span>' : '<span class="cs-qstat ' + (bad ? "bad" : "warn") + '" title="' + esc(I.map(function (x) { return x.msg; }).join("\n")) + '">' +
      (bad ? "필수 위반 " + bad : "권장 위반 " + I.length) + "</span>") + ai;
  }

  function qView(q, m) {
    var I = lintQ(q, m);
    var h = '<div class="cs-q" id="q-' + q.id + '"><div class="cs-q-head"><span class="cs-band b-' + q.band + '">' + q.band + "</span><b>" + esc(q.type) + "</b>" +
      '<span class="cs-muted">' + (q.objective ? "목표 " + q.objective : '<b class="cs-warn">목표 없음</b>') + "</span>" + (q.multi ? '<span class="cs-badge">복수 정답</span>' : "") +
      '<div class="cs-spacer"></div>' + statusHtml(I, q) + "</div>";
    h += '<div class="cs-q-stem">' + esc(q.stem) + "</div>";
    if (q.code) h += '<div class="cs-code"><div>시작 코드</div><pre>' + esc(q.code) + "</pre></div>";
    if (q.type === "객관식") h += '<ol class="cs-choices">' + (q.choices || []).map(function (c) { return "<li" + (c.correct ? ' class="ok"' : "") + ">" + esc(c.text) + (c.correct ? " ✓" : "") + "</li>"; }).join("") + "</ol>";
    if (q.type === "단답식") h += '<p class="cs-ans">정답: <b>' + esc(q.answer) + "</b>" + (q.accepted ? " · 허용 표기: " + esc(q.accepted) : "") + "</p>";
    if (q.type === "서술형" && q.answer) h += '<div class="cs-model"><div class="cs-muted">모범 답안</div>' + esc(q.answer) + "</div>";
    if ((q.rubric || []).length) {
      var tot = q.rubric.reduce(function (a, r) { return a + (Number(r.points) || 0); }, 0);
      if (q.type === "파일제출") {
        h += '<table class="cs-rub"><thead><tr><th>평가 기준</th><th>충족</th><th>부분</th><th>미흡</th><th>점수</th></tr></thead><tbody>' +
          q.rubric.map(function (r) { return "<tr><td>" + esc(r.criterion) + "</td><td>" + esc(r.full) + "</td><td>" + esc(r.partial) + "</td><td>" + esc(r.none) + "</td><td>" + esc(r.points) + "</td></tr>"; }).join("") +
          '</tbody><tfoot><tr><td colspan="4">합계</td><td>' + tot + "</td></tr></tfoot></table>";
      } else {
        h += '<table class="cs-rub"><thead><tr><th>채점 요소</th><th>점수</th></tr></thead><tbody>' +
          q.rubric.map(function (r) { return "<tr><td>" + esc(r.criterion) + "</td><td>" + esc(r.points) + "</td></tr>"; }).join("") +
          "</tbody><tfoot><tr><td>합계</td><td>" + tot + "</td></tr></tfoot></table>";
      }
    }
    if (q.tests) h += '<div class="cs-code"><div>기대 출력 · 테스트 케이스</div><pre>' + esc(q.tests) + "</pre></div>";
    if (q.explanation) h += '<p class="cs-expl">해설: ' + esc(q.explanation) + "</p>";
    if (I.length) h += '<ul class="cs-lint">' + I.map(function (x) { return '<li class="' + x.sev + '">' + esc(x.msg) + "</li>"; }).join("") + "</ul>";
    h += '<div class="cs-q-act"><button class="btn btn-ghost" data-act="q-edit" data-q="' + q.id + '">편집</button><button class="cs-danger" data-act="q-del" data-q="' + q.id + '">삭제</button></div></div>';
    return h;
  }

  function qEdit(m) {
    var q = ui.draft;
    var types = C().BANDS[q.band].types;
    var h = '<div class="cs-q editing"><div class="cs-q-form">' +
      '<label>학습목표 <select data-qf="objective">' + (q.objective ? "" : opt("", "목표 없음 — 다시 연결하세요", "")) + m.objectives.map(function (o, i) { return opt(i + 1, (i + 1) + ". " + o.slice(0, 30), q.objective); }).join("") + "</select></label>" +
      '<label>밴드 <select data-qf="band">' + C().QUESTION_BANDS.map(function (b) { return opt(b, b + " · " + C().BANDS[b].name, q.band); }).join("") + "</select></label>" +
      '<label>유형 <select data-qf="type">' + types.map(function (t) { return opt(t, t, q.type); }).join("") + "</select></label>" +
      (q.type === "객관식" ? '<label class="cs-check"><input type="checkbox" data-qf="multi"' + (q.multi ? " checked" : "") + "> 복수 정답</label>" : "") + "</div>" +
      '<label class="cs-lab">문항</label><textarea rows="3" data-qf="stem">' + esc(q.stem) + "</textarea>";
    if (q.type === "코드제출" || q.code) h += '<label class="cs-lab">시작 코드</label><textarea rows="4" class="mono" data-qf="code">' + esc(q.code) + "</textarea>";
    if (q.type === "객관식") {
      h += '<label class="cs-lab">보기 <span class="cs-muted">(정답에 체크)</span></label>' + q.choices.map(function (c, i) {
        return '<div class="cs-chrow"><span>' + (i + 1) + '.</span><input data-qf="choice" data-i="' + i + '" value="' + esc(c.text) + '">' +
          '<label class="cs-check"><input type="checkbox" data-qf="correct" data-i="' + i + '"' + (c.correct ? " checked" : "") + "> 정답</label>" +
          '<button class="cs-x" data-act="q-choice-del" data-i="' + i + '">✕</button></div>';
      }).join("") + '<button class="cs-link" data-act="q-choice-add">＋ 보기 추가</button>';
    }
    if (q.type === "단답식") {
      h += '<div class="cs-q-form"><label>정답 <input data-qf="answer" value="' + esc(q.answer) + '"></label>' +
        '<label>허용 표기 <input data-qf="accepted" placeholder="대소문자·띄어쓰기 변형을 쉼표로" value="' + esc(q.accepted) + '"></label></div>';
    }
    if (q.type === "서술형") {
      h += '<label class="cs-lab">모범 답안</label><textarea rows="3" data-qf="answer">' + esc(q.answer) + "</textarea>" +
        '<label class="cs-lab">요소별 채점 기준 <span class="cs-muted">(충족할 때마다 점수를 더함)</span></label>' + (q.rubric || []).map(function (r, i) {
          return '<div class="cs-chrow"><input data-qf="rub-c" data-i="' + i + '" value="' + esc(r.criterion) + '" placeholder="채점 요소">' +
            '<input type="number" class="cs-pts" data-qf="rub-p" data-i="' + i + '" value="' + esc(r.points) + '"> 점<button class="cs-x" data-act="q-rub-del" data-i="' + i + '">✕</button></div>';
        }).join("") + '<button class="cs-link" data-act="q-rub-add">＋ 채점 요소</button>';
    }
    if (q.type === "파일제출") {
      h += '<label class="cs-lab">채점 루브릭 <span class="cs-muted">(관찰 가능한 기준 · 충족/부분/미흡 조건 · 점수)</span></label>' + (q.rubric || []).map(function (r, i) {
        return '<div class="cs-rubrow"><input data-qf="rub-c" data-i="' + i + '" value="' + esc(r.criterion) + '" placeholder="평가 기준">' +
          '<input data-qf="rub-full" data-i="' + i + '" value="' + esc(r.full) + '" placeholder="충족 조건">' +
          '<input data-qf="rub-partial" data-i="' + i + '" value="' + esc(r.partial) + '" placeholder="부분 충족 조건">' +
          '<input data-qf="rub-none" data-i="' + i + '" value="' + esc(r.none) + '" placeholder="미흡 조건">' +
          '<input type="number" class="cs-pts" data-qf="rub-p" data-i="' + i + '" value="' + esc(r.points) + '"><button class="cs-x" data-act="q-rub-del" data-i="' + i + '">✕</button></div>';
      }).join("") + '<button class="cs-link" data-act="q-rub-add">＋ 기준 추가</button>';
    }
    if (q.type === "코드제출") h += '<label class="cs-lab">기대 출력 · 테스트 케이스</label><textarea rows="3" class="mono" data-qf="tests">' + esc(q.tests) + "</textarea>";
    h += '<label class="cs-lab">해설</label><textarea rows="2" data-qf="explanation">' + esc(q.explanation) + "</textarea>" +
      '<div class="cs-q-act"><button class="btn btn-primary" data-act="q-save">저장</button><button class="btn btn-ghost" data-act="q-cancel">취소</button></div></div>';
    return h;
  }

  function rulesCard(m) {
    var res = m.questions.map(function (q) { return { q: q, I: lintQ(q, m) }; });
    var pass = res.filter(function (x) { return !x.I.length; }).length;
    var flagged = res.filter(function (x) { return x.I.length; });
    var groups = [];
    R().Q_RULE_LIST.forEach(function (r) { if (groups.indexOf(r.group) === -1) groups.push(r.group); });
    return '<div class="cs-card cs-rules"><div class="cs-card-head"><h3>문항 검수</h3><div class="cs-spacer"></div><span class="mono ' + (pass === res.length ? "cs-ok" : "cs-warn") + '">통과 ' + pass + "/" + res.length + "</span></div>" +
      (flagged.length ? '<div class="cs-flagged">' + flagged.slice(0, 20).map(function (x) {
        var bad = x.I.filter(function (v) { return v.sev === "bad"; }).length;
        return '<button class="cs-flag" data-act="q-jump" data-q="' + x.q.id + '"><span class="cs-band b-' + x.q.band + '">' + x.q.band + "</span> " + esc(String(x.q.stem || "(빈 문항)").slice(0, 34)) +
          ' <span class="cs-badge ' + (bad ? "bad" : "warn") + '">' + esc(x.I[0].msg.slice(0, 18)) + (x.I.length > 1 ? " 외 " + (x.I.length - 1) : "") + "</span></button>";
      }).join("") + "</div>" : '<p class="cs-muted">' + (res.length ? "모든 문항이 자동 검수를 통과했습니다." : "문항이 생기면 여기서 규칙 위반을 모아 보여줍니다.") + "</p>") +
      '<details class="cs-rc" data-q-rules-d' + (ui.rulesOpen ? " open" : "") + '><summary class="cs-rc-h">검사 규칙 목록 <span class="cs-muted">' + R().Q_RULE_LIST.length + "개</span></summary>" +
      groups.map(function (g) {
        return '<div class="cs-rl"><b>' + esc(g) + "</b><ul>" + R().Q_RULE_LIST.filter(function (r) { return r.group === g; }).map(function (r) {
          return '<li><span class="cs-rl-rule"><span class="cs-badge ' + r.sev + '">' + (r.sev === "bad" ? "필수" : "권장") + "</span> " + esc(r.rule) + '</span><span class="cs-rl-desc">' + esc(r.desc) + "</span></li>";
        }).join("") + "</ul></div>";
      }).join("") + "</details></div>";
  }

  function render(c) {
    var m = c.module, B = C().BANDS;
    if (ui.for !== m.id) { ui.for = m.id; ui.obj = ""; ui.editing = null; ui.draft = null; } // 목표 필터·편집 중 문항은 학습모듈마다 따로
    var nObj = Math.max(1, m.objectives.length);
    var dist = C().distribution(m.questions, nObj);
    var unlinked = m.questions.filter(function (q) { return !q.objective; }).length;
    var rows = dist.rows.map(function (r, i) {
      return '<tr><td><span class="cs-muted">' + (i + 1) + "</span> " + esc(m.objectives[i] || "(학습목표 없음)") + "</td>" +
        C().QUESTION_BANDS.map(function (b) { return '<td class="' + (r[b] ? "" : "zero") + '">' + r[b] + "</td>"; }).join("") + "</tr>";
    }).join("");
    var foot = "<tr><td>합계 / 권장</td>" + C().QUESTION_BANDS.map(function (b) { return '<td class="' + (dist.total[b] >= dist.recommend[b] ? "met" : "") + '">' + dist.total[b] + " / " + dist.recommend[b] + "</td>"; }).join("") + "</tr>";
    var bandHead = C().QUESTION_BANDS.map(function (b) { return '<th><span class="cs-band b-' + b + '">' + b + "</span><small>" + esc(B[b].name) + "</small></th>"; }).join("");
    var help = ui.help ? '<p class="cs-sub">밴드는 문항이 학습자에게 얼마나 많은 것을 스스로 하도록 요구하는지를 나타내는 단계입니다. 숫자가 클수록 주어지는 정보가 적습니다. 모든 문항에 학습목표와 밴드를 함께 붙여 두면, 오답률이 높을 때 어느 목표의 어느 수준이 무너졌는지 찾을 수 있습니다.</p>' +
      '<div class="cs-bands">' + ["L1", "L2", "L3", "L4"].map(function (b) {
        return '<div class="cs-bandcard' + (b === "L4" ? " l4" : "") + '"><div><span class="cs-band b-' + b + '">' + b + "</span> <b>" + esc(B[b].name) + "</b></div><p>" + esc(B[b].desc) + "</p><small>" +
          esc(b === "L3" ? "파일제출 (루브릭 채점)" : b === "L4" ? "프로젝트에서 다룸 — 문제은행에 만들지 않음" : B[b].types.join(" · ")) + "</small></div>";
      }).join("") + "</div>" : "";
    var g = ui.gen;
    if (g.objective > nObj) g.objective = 1;
    if (B[g.band].types.indexOf(g.type) === -1) g.type = B[g.band].types[0];
    var langs = R().codeLangs(m);
    var form = '<div class="cs-card cs-qgen"><h3>문항 생성</h3><div class="cs-q-form">' +
      '<label>학습목표 <select data-g="objective">' + (m.objectives.length ? m.objectives : ["(학습목표를 먼저 작성하세요)"]).map(function (o, i) { return opt(i + 1, (i + 1) + ". " + o, g.objective); }).join("") + "</select></label>" +
      '<label>밴드 <select data-g="band">' + C().QUESTION_BANDS.map(function (b) { return opt(b, b + " · " + B[b].name, g.band); }).join("") + "</select></label>" +
      '<label>유형 <select data-g="type">' + B[g.band].types.map(function (t) { return opt(t, t, g.type); }).join("") + "</select>" +
      (g.type === "객관식" ? '<span class="cs-check"><input type="checkbox" data-g="multi"' + (g.multi ? " checked" : "") + "> 복수 정답</span>" : "") + "</label>" +
      '<label>문항 수 <select data-g="count">' + COUNTS.map(function (n) { return opt(n, n + "문항", g.count); }).join("") + "</select></label></div>" +
      '<p class="cs-muted">' + (m.content ? "교재의 대응 학습내용을 근거로 출제합니다." : "교재가 아직 없어 학습목표 기준으로 출제합니다.") +
      (langs.length ? " 코드는 학습내용에 쓰인 " + esc(langs.join(", ")) + " 기준입니다." : " 학습내용에 코드가 없으면 사용 툴을 보고 꼭 필요할 때만 코드를 씁니다.") +
      " 같은 목표의 기존 문항과 겹치지 않게 만들고, 자동 검수에 걸린 문항은 한 번 더 고쳐 받습니다.</p>" +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="q-gen"' + (U().aiReady("qgen") && m.objectives.length ? "" : " disabled") + ">AI로 생성</button><span class=\"cs-muted\">또는</span>" +
      '<button class="btn btn-ghost" data-act="q-add">빈 문항 추가</button>' +
      '<span class="cs-muted">' + (U().aiReady("qgen") ? (K.AI.isMixed() ? "Gemini 생성 → 규칙 검수·수정 → Claude 교차 검수" : esc(U().aiName("qgen")) + " 생성 · 규칙 검수·수정") : "AI 키 없음 — 빈 문항으로 직접 작성") + "</span></div></div>";
    var list = m.questions.filter(function (q) {
      return (!ui.band || q.band === ui.band) && (!ui.obj || (ui.obj === "none" ? !q.objective : String(q.objective) === String(ui.obj)));
    });
    var items = list.map(function (q) { return ui.editing === q.id ? qEdit(m) : qView(q, m); }).join("") || '<p class="cs-muted">문항이 없습니다.</p>';
    if (ui.editing && ui.draft && ui.draft._new) items = qEdit(m) + items;
    var chips = ["", "L1", "L2", "L3"].map(function (b) { return '<button class="cs-fchip' + (ui.band === b ? " on" : "") + '" data-act="q-filter" data-b="' + b + '">' + (b || "전체 밴드") + "</button>"; }).join("");
    return '<div class="cs-grid2"><div class="cs-stack">' +
      '<div class="cs-card"><div class="cs-card-head"><h3>문항 분포</h3><div class="cs-spacer"></div><span class="cs-muted">권장: L1 10 · L2 5 · L3 3 (재응시·회차 로테이션용)</span></div>' +
      '<table class="cs-dist"><thead><tr><th>학습목표</th>' + bandHead + "</tr></thead><tbody>" + rows + "</tbody><tfoot>" + foot + "</tfoot></table>" +
      (unlinked ? '<p class="cs-warn">목표 없음 문항 ' + unlinked + "개 — 학습목표를 삭제하며 연결이 해제된 문항입니다. 편집에서 다시 연결하세요.</p>" : "") +
      '<button class="cs-link" data-act="q-help">밴드란? · ' + (ui.help ? "접기" : "펼치기") + "</button>" + help + "</div>" + form +
      '<div class="cs-card"><div class="cs-card-head"><h3>문항 ' + m.questions.length + "</h3>" + chips +
      '<select data-q-objfilter>' + opt("", "전체 목표", ui.obj) + m.objectives.map(function (o, i) { return opt(i + 1, "목표 " + (i + 1), ui.obj); }).join("") + (unlinked ? opt("none", "목표 없음", ui.obj) : "") + "</select>" +
      '<div class="cs-spacer"></div><button class="btn btn-ghost" data-act="q-csv"' + (m.questions.length ? "" : " disabled") + ">CSV 저장</button></div>" + items + "</div></div>" +
      '<div class="cs-stack">' + rulesCard(m) + "</div></div>";
  }

  function setType(q, t) {
    q.type = t;
    if (t === "객관식" && !(q.choices || []).length) q.choices = [0, 1, 2, 3].map(function (i) { return { text: "", correct: i === 0 }; });
    if ((t === "서술형" || t === "파일제출") && !(q.rubric || []).length) q.rubric = [{ criterion: "", points: t === "파일제출" ? 3 : 5, full: "", partial: "", none: "" }];
    if (t !== "객관식") q.multi = false;
  }
  function find(m, id) { return m.questions.filter(function (x) { return x.id === id; })[0]; }

  var actions = {
    "q-help": function () { ui.help = !ui.help; U().render(); },
    "q-filter": function (el) { ui.band = el.dataset.b; U().render(); },
    "q-jump": function (el) {
      ui.band = ""; ui.obj = "";
      U().render();
      var n = document.getElementById("q-" + el.dataset.q);
      if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); n.classList.add("flash"); setTimeout(function () { n.classList.remove("flash"); }, 1600); }
    },
    "q-gen": function (el, c) {
      var m = c.module, g = ui.gen;
      var spec = { objective: g.objective, band: g.band, type: g.type, multi: g.type === "객관식" && g.multi, count: g.count };
      U().run("문항 생성 중… (" + (K.AI.isMixed() ? "Gemini 생성 → Claude 교차 검수" : U().aiName("qgen")) + ")", function (prog) {
        return K.courseAI.generateQuestions(c.course, c.unit, c.mi, spec).then(function (qs) {
          m.questions = m.questions.concat(qs);
          C().logChange(m, "AI 문항 " + qs.length + "개 생성 (목표 " + spec.objective + " · " + spec.band + " · " + spec.type + ")");
          var bad = qs.filter(function (q) { return lintQ(q, m).length; }).length;
          U().toast(qs.length + "문항을 만들었습니다." + (qs.fixed ? " 검수에 걸린 " + qs.fixed + "문항은 자동으로 고쳤습니다." : "") + (bad ? " 남은 지적 " + bad + "문항은 직접 확인하세요." : ""));
        });
      });
    },
    "q-add": function () {
      var g = ui.gen;
      var q = C().newQuestion({ objective: g.objective, band: g.band, type: g.type, multi: g.type === "객관식" && g.multi });
      setType(q, q.type);
      q._new = true;
      ui.editing = q.id; ui.draft = q; U().render();
    },
    "q-edit": function (el, c) {
      var q = find(c.module, el.dataset.q);
      if (!q) return;
      ui.editing = q.id; ui.draft = JSON.parse(JSON.stringify(q)); U().render();
    },
    "q-del": function (el, c) {
      if (!confirm("이 문항을 삭제할까요?")) return;
      c.module.questions = c.module.questions.filter(function (x) { return x.id !== el.dataset.q; });
      C().logChange(c.module, "문항 삭제");
      U().save(); U().render();
    },
    "q-cancel": function () { ui.editing = null; ui.draft = null; U().render(); },
    "q-save": function (el, c) {
      var m = c.module, q = ui.draft, isNew = q._new;
      delete q._new;
      q.review = null; // 사람이 고친 문항은 AI 검수 결과를 무효화한다
      if (isNew) m.questions.push(q);
      else m.questions = m.questions.map(function (x) { return x.id === q.id ? q : x; });
      C().logChange(m, isNew ? "문항 직접 추가" : "문항 편집");
      ui.editing = null; ui.draft = null; U().save(); U().render();
    },
    "q-choice-add": function () { ui.draft.choices.push({ text: "", correct: false }); U().render(); },
    "q-choice-del": function (el) { ui.draft.choices.splice(Number(el.dataset.i), 1); U().render(); },
    "q-rub-add": function () { ui.draft.rubric.push({ criterion: "", points: 1, full: "", partial: "", none: "" }); U().render(); },
    "q-rub-del": function (el) { ui.draft.rubric.splice(Number(el.dataset.i), 1); U().render(); },
    "q-csv": function (el, c) {
      var m = c.module;
      U().download(U().safeName("문제은행 - " + m.title) + ".csv", C().questionsToCsv(m.questions, { unit: c.unit.title, moduleTitle: m.title, module: m, objectives: m.objectives }), "text/csv");
    }
  };

  function change(el, c) {
    if (el.dataset.g) {
      var g = ui.gen, k = el.dataset.g;
      if (k === "multi") g.multi = el.checked;
      else if (k === "objective" || k === "count") g[k] = Number(el.value);
      else g[k] = el.value;
      if (k === "band") g.type = C().BANDS[g.band].types[0];
      U().render(); return true;
    }
    if (el.hasAttribute("data-q-objfilter")) { ui.obj = el.value; U().render(); return true; }
    if (el.dataset.qf && ui.draft) {
      var q = ui.draft, f = el.dataset.qf;
      if (f === "objective") q.objective = el.value ? Number(el.value) : null;
      else if (f === "band") { q.band = el.value; if (C().BANDS[q.band].types.indexOf(q.type) === -1) setType(q, C().BANDS[q.band].types[0]); }
      else if (f === "type") setType(q, el.value);
      else if (f === "multi") q.multi = el.checked;
      else if (f === "correct") {
        var i = Number(el.dataset.i);
        if (!q.multi) q.choices.forEach(function (ch, j) { ch.correct = j === i ? el.checked : false; });
        else q.choices[i].correct = el.checked;
      } else return true;
      U().render(); return true;
    }
    return false;
  }
  function input(el) {
    if (!el.dataset.qf || !ui.draft) return false;
    var q = ui.draft, f = el.dataset.qf, i = Number(el.dataset.i);
    if (/^(stem|code|answer|accepted|tests|explanation)$/.test(f)) q[f] = el.value;
    else if (f === "choice") q.choices[i].text = el.value;
    else if (f === "rub-c") q.rubric[i].criterion = el.value;
    else if (f === "rub-p") q.rubric[i].points = Number(el.value) || 0;
    else if (f === "rub-full") q.rubric[i].full = el.value;
    else if (f === "rub-partial") q.rubric[i].partial = el.value;
    else if (f === "rub-none") q.rubric[i].none = el.value;
    return true;
  }
  function after() {
    var d = document.querySelector("[data-q-rules-d]");
    if (d) d.addEventListener("toggle", function () { ui.rulesOpen = d.open; });
  }

  K.courseTabs = K.courseTabs || {};
  K.courseTabs.qbank = {
    label: "문제은행", render: render, after: after, actions: actions, input: input, change: change,
    badge: function (m) {
      if (!m.questions.length) return "";
      var bad = m.questions.filter(function (q) { return K.courseRules.lintQuestion(q, m).some(function (x) { return x.sev === "bad"; }); }).length;
      return '<span class="cs-cnt' + (bad ? " bad" : "") + '">' + m.questions.length + "</span>";
    }
  };
})();
