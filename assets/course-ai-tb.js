/* course-ai-tb.js — 학습모듈 교재·NCS 요소·삽화의 AI 단계 (「콘텐츠 업무 설계」 5장)
 *   K.courseTB : 교재 객체(tb) ↔ 학습모듈 변환, 고정(잠금) 칸 처리, 자동 검수
 *       tb = { overview, objectives:[문장], sections:[{title, body}], checklist:[{text, ref}] }
 *       잠금 키: "ov" 개요 · "o0" 학습목표 1 · "c0" 학습내용 1 · "k0" 체크리스트 1
 *   K.courseAI 에 더하는 것
 *       draftTextbook  : 초안 / 고정 외 새로 쓰기 / AI로 학습목표 추가 → 검수 지적 1회 자동 수정   [write]
 *       fixTextbook    : 검수 지적을 고친 수정안                                                [write]
 *       editTextbook   : 고른 칸 또는 드래그한 부분만 지시대로 고치기                             [write]
 *       recommendElements : 교재를 분석해 NCS 능력단위요소 추천 (참조 목록 우선)                  [plan]
 *       drawSvg / reviseSvg / extractArtStyle / transcribeImages : 삽화·이미지 읽기
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  function R() { return K.courseRules; }
  function ai() { return K.ai; }
  function A() { return K.courseAI; }
  function call(prompt, o) { return A().aicall(prompt, o); }
  function clone(o) { return JSON.parse(JSON.stringify(o == null ? null : o)); }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

  /* AI 에 한 번에 보낼 프롬프트 상한(바이트) — 참고 자료 분량 표시에도 쓴다 */
  var PROMPT_LIMIT = 300000;
  function bytes(s) {
    s = String(s || "");
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3;
    }
    return n;
  }
  function tooBig(prompt) {
    var b = bytes(prompt);
    if (b <= PROMPT_LIMIT) return null;
    return new Error("보낼 내용이 한도를 넘었습니다(" + Math.round(b / PROMPT_LIMIT * 100) + "%). 참고 자료의 쪽 범위를 줄이거나 선택을 해제해 주세요.");
  }

  /* ================= 교재 객체 ================= */
  function tbOf(m) {
    var c = m.content || {};
    var n = (m.objectives || []).length;
    var secs = c.sections || [], ck = c.checklist || [];
    var len = Math.max(n, secs.length, ck.length);
    return {
      overview: String(c.overview || ""),
      objectives: (m.objectives || []).slice(),
      sections: range(Math.max(n, secs.length)).map(function (i) { var s = secs[i] || {}; return { title: String(s.title || ""), body: String(s.body || "") }; }),
      checklist: range(len > n ? ck.length : n).map(function (i) {
        var k = ck[i];
        var t = typeof k === "string" ? k : (k && (k.text || k.item)) || "";
        return { text: String(t), ref: String((k && k.ref) || (t ? "학습내용 " + (i + 1) : "")) };
      })
    };
  }
  /* 교재를 학습모듈에 반영 (교수안 지침·슬라이드·작성자 표시는 유지) */
  function applyTB(m, tb) {
    m.objectives = tb.objectives.map(function (o) { return String(o || "").trim(); });
    var c = m.content || {};
    m.content = Object.assign({}, c, { overview: tb.overview, sections: clone(tb.sections), checklist: clone(tb.checklist) });
    m.content.lint = K.course.lintModule(m);
    return m;
  }
  function lint(tb) {
    return R().lintTextbook({ objectives: tb.objectives, content: { overview: tb.overview, sections: tb.sections, checklist: tb.checklist } });
  }
  function isEmpty(tb) {
    return !String(tb.overview || "").trim() && !tb.sections.some(function (s) { return String(s.body || "").trim(); });
  }
  function lockLabel(k) {
    if (k === "ov") return "개요";
    return ({ o: "학습목표", c: "학습내용", k: "체크리스트" })[k[0]] + " " + (Number(k.slice(1)) + 1);
  }
  function enforceLocks(next, base, locks) {
    var t = clone(next), L = toSet(locks);
    if (L.ov) t.overview = base.overview;
    t.objectives.forEach(function (_, i) {
      if (L["o" + i] && base.objectives[i] != null) t.objectives[i] = base.objectives[i];
      if (L["c" + i] && base.sections[i]) t.sections[i] = clone(base.sections[i]);
      if (L["k" + i] && base.checklist[i]) t.checklist[i] = clone(base.checklist[i]);
    });
    return t;
  }
  function toSet(locks) {
    var s = {};
    (Array.isArray(locks) ? locks : Object.keys(locks || {})).forEach(function (k) { s[k] = 1; });
    return s;
  }
  /* 학습목표 i 를 지우면 뒤쪽 잠금 번호를 당긴다 */
  function shiftLocks(locks, i) {
    var out = [];
    locks.forEach(function (k) {
      if (k === "ov") { out.push(k); return; }
      var n = Number(k.slice(1));
      if (n < i) out.push(k); else if (n > i) out.push(k[0] + (n - 1));
    });
    return out;
  }
  function toolsText(course, m) {
    var t = (m.tools || []).filter(function (x) { return x && x.name; }).map(function (x) { return x.name + (x.version ? " " + x.version : ""); }).join(", ");
    return t || course.tool || "";
  }
  function prereqText(m) { return (m.prereqs || []).map(function (p) { return typeof p === "string" ? p : p && p.name; }).filter(Boolean).join(", "); }

  /* ================= 교재 생성 ================= */
  var LEVELS = ["비전공 입문", "기초 문법 이수", "실무 경험자"];
  var LENGTHS = ["짧게 (약 400자)", "보통 (약 800자)", "길게 (약 1,500자)"];

  function tbPrompt(course, unit, m, extra, gen) {
    gen = gen || {};
    return [
      "직업훈련기관의 교재 집필자로서 아래 규칙을 모두 지켜 학습모듈 교재를 작성합니다.", "",
      R().RULES_TB, "",
      "[학습모듈 정보]",
      "- 학습모듈 이름: " + m.title,
      "- 단원(교과목) — 맥락 참고용, 본문에서 언급 금지: " + unit.title + " / 과정: " + course.title,
      "- 카테고리: " + (m.category || "-"),
      "- 사용 툴과 버전(메타데이터, 본문에 버전 번호를 쓰지 말 것): " + (toolsText(course, m) || "-"),
      "- 예상 소요 시간: " + K.course.fmtMin(m.minutes),
      "- 학습 대상: " + (course.target || "직업훈련 수강생"),
      "- 학습자 수준: " + (gen.level || (m.gen || {}).level || LEVELS[1]),
      "- 학습내용 덩어리당 분량: " + (gen.length || (m.gen || {}).length || LENGTHS[1]),
      extra, "",
      "[출력 형식] 아래 JSON 하나만 출력합니다. 다른 설명은 쓰지 않습니다.",
      "{\"overview\":\"개요 (2~3문단, 문단은 \\n\\n으로 구분)\",\"objectives\":[\"~할 수 있다.\"],\"sections\":[{\"title\":\"덩어리 제목\",\"body\":\"본문. 문단 구분 \\n\\n, 목록은 '- ', 코드는 ```언어 ... ``` 블록\"}],\"checklist\":[{\"text\":\"'~할 수 있습니다.'처럼 스스로 점검하는 문장\",\"ref\":\"학습내용 1\"}],\"illustrationIdeas\":[{\"section\":0,\"description\":\"교재 이해를 돕는 삽화 한 장의 구체적 장면·개념 설명\"}]}",
      "- objectives, sections, checklist의 개수는 같아야 하고 순서도 대응해야 합니다.",
      "- illustrationIdeas는 1~3개입니다."
    ].join("\n");
  }

  function normTB(res, cap) {
    var objs = Array.isArray(res && res.objectives) ? res.objectives : [];
    var n = Math.min(cap || 3, objs.length);
    if (!n) throw new Error("교재 응답을 해석하지 못했어요. 다시 시도해 주세요.");
    var secs = res.sections || res.contents || [], ck = res.checklist || [];
    return {
      tb: {
        overview: String(res.overview || "").trim(),
        objectives: objs.slice(0, n).map(function (o) { return String(o).trim(); }),
        sections: range(n).map(function (i) { var s = secs[i] || {}; return { title: String(s.title || "").trim(), body: String(s.body || "").trim() }; }),
        checklist: range(n).map(function (i) {
          var k = ck[i];
          var t = typeof k === "string" ? k : (k && (k.text || k.item)) || "";
          return { text: String(t).trim(), ref: String((k && k.ref) || "학습내용 " + (i + 1)).trim() };
        })
      },
      ideas: (res.illustrationIdeas || res.ideas || []).slice(0, 3).map(function (x) {
        var s = Number(x.section != null ? x.section : x.contentIndex) || 0;
        return { section: Math.max(0, Math.min(n - 1, s)), description: String(x.description || "").trim() };
      }).filter(function (x) { return x.description; })
    };
  }

  function issuesText(I) {
    return I.map(function (x) { return "- " + x.where + ": " + x.msg + (x.snip ? " (" + x.snip + ")" : ""); }).join("\n");
  }
  function badCount(I) { return I.filter(function (v) { return v.sev === "bad"; }).length; }

  /* 생성 결과가 자동 검수에 걸리면 한 번 더 고쳐 받는다 (고정 칸 유지, 나아졌을 때만 교체) */
  function repairOnce(course, unit, m, tb, locks, cap, gen) {
    var I = lint(tb);
    if (!I.length) return Promise.resolve(tb);
    var extra = "\n[작업] 아래 교재가 자동 검수에서 지적을 받았습니다. 지적을 모두 해결하도록 고치고, 지적과 관계없는 내용과 표현은 유지합니다. 학습목표·학습내용·체크리스트 개수는 바꾸지 않습니다." +
      (locks.length ? "\n고정된 칸(" + locks.map(lockLabel).join(", ") + ")은 한 글자도 바꾸지 않습니다." : "") +
      "\n\n[지적된 문제]\n" + issuesText(I) + "\n\n[현재 교재 JSON]\n" + JSON.stringify(tb).slice(0, 60000);
    return call(tbPrompt(course, unit, m, extra, gen), { role: "write" }).then(ai().parseJson).then(function (res) {
      var nt = normTB(res, cap).tb;
      if (nt.objectives.length !== tb.objectives.length) return tb;
      nt = enforceLocks(nt, tb, locks);
      var J = lint(nt);
      return (badCount(J) < badCount(I) || (badCount(J) === badCount(I) && J.length < I.length)) ? nt : tb;
    }).catch(function (e) { if (e && e.code === "cancelled") throw e; return tb; });
  }

  function lockedContext(base, locks, N) {
    var L = [], S = toSet(locks);
    function tag(k, label, val) { L.push((S[k] ? "[고정]" : "[다시 작성]") + " " + label + ": " + (String(val || "").trim() || "(비어 있음)")); }
    tag("ov", "개요", base.overview);
    for (var i = 0; i < N; i++) {
      tag("o" + i, "학습목표 " + (i + 1), base.objectives[i]);
      tag("c" + i, "학습내용 " + (i + 1), base.sections[i] ? "제목: " + base.sections[i].title + "\n본문:\n" + base.sections[i].body : "");
      tag("k" + i, "체크리스트 " + (i + 1), base.checklist[i] ? base.checklist[i].text + " (다시 볼 곳: " + base.checklist[i].ref + ")" : "");
    }
    return L.join("\n\n").slice(0, 80000);
  }

  /* o = {base(tb), notes, n(1~3), level, length, extra, locks:[키], refs:"참고 자료 블록"}
     결과: {tb, ideas, n(실제 목표 수), raised(고정 칸 때문에 늘린 경우 true)} */
  function draftTextbook(course, unit, m, o) {
    o = o || {};
    var base = o.base || tbOf(m);
    var locks = (o.locks || []).slice();
    var N = Number(o.n) || 3, raised = false;
    var lockedIdx = locks.filter(function (k) { return k !== "ov"; }).map(function (k) { return Number(k.slice(1)); });
    var need = lockedIdx.length ? Math.max.apply(null, lockedIdx) + 1 : 0;
    if (N < need) { N = need; raised = true; }
    var notes = String(o.notes || "").trim(), extraReq = String(o.extra || "").trim(), refs = o.refs || "";
    var gen = { level: o.level, length: o.length };
    var planned = base.objectives.filter(function (x) { return String(x).trim(); });
    var extra;
    if (!locks.length) {
      extra = "- 선행 학습모듈(메타데이터 전용, 본문에서 언급 금지): " + (prereqText(m) || "-") + "\n- 학습목표 수: 정확히 " + N + "개\n" +
        (planned.length && isEmpty(base) ? "\n[블록 설계에서 정한 학습목표 — 의도를 유지하며 규칙에 맞게 다듬는다]\n" + planned.map(function (x, i) { return (i + 1) + ". " + x; }).join("\n") + "\n" : "") +
        "\n[가르칠 내용]\n" + (notes || (refs ? "(참고 자료에서 학습모듈 이름에 맞는 범위를 고른다)" : "(학습모듈 이름과 학습목표를 바탕으로 쓴다)")) +
        (extraReq ? "\n\n[추가 요청]\n" + extraReq : "") +
        (!isEmpty(base) && extraReq ? "\n\n[현재 교재 — 참고용, 전부 새로 써도 됨]\n" + JSON.stringify(base).slice(0, 40000) : "") + refs;
    } else {
      extra = "- 선행 학습모듈(메타데이터 전용, 본문에서 언급 금지): " + (prereqText(m) || "-") + "\n- 학습목표 수: 정확히 " + N + "개\n\n" +
        "[작업] 일부 칸을 고정한 상태에서 나머지만 새로 씁니다.\n" +
        "- [고정] 표시된 칸은 한 글자도 바꾸지 않고 그대로 출력합니다.\n" +
        "- [다시 작성] 표시된 칸은 고정된 칸과 일관되게 새로 씁니다. 내용이 있더라도 새로 씁니다.\n" +
        "- 학습목표 i가 고정이면 학습내용 i와 체크리스트 i는 그 목표에 정확히 대응하도록 씁니다.\n" +
        "- 학습내용 i가 고정이고 학습목표 i가 다시 작성이면, 학습내용을 읽고 그에 맞는 학습목표를 씁니다.\n" +
        "- 새로 쓰는 학습목표는 고정된 다른 목표와 내용이 겹치지 않게 합니다.\n" +
        "- 개요가 다시 작성이면 모든 학습목표를 아우르도록 씁니다.\n\n" +
        "[가르칠 내용]\n" + (notes || "(고정된 칸과 추가 요청을 참고)") + "\n" +
        (extraReq ? "\n[추가 요청]\n" + extraReq + "\n" : "") +
        "\n[현재 교재 상태]\n" + lockedContext(base, locks, N) + refs;
    }
    var prompt = tbPrompt(course, unit, m, extra, gen);
    var big = tooBig(prompt);
    if (big) return Promise.reject(big);
    var cap = Math.max(3, N);
    var ideas = [];
    return call(prompt, { role: "write" }).then(ai().parseJson).then(function (res) {
      var r = normTB(res, cap);
      ideas = r.ideas;
      return repairOnce(course, unit, m, enforceLocks(r.tb, base, locks), locks, cap, gen);
    }).then(function (tb) { return { tb: tb, ideas: ideas, n: N, raised: raised }; });
  }

  /* 자동 검수 지적을 고친 수정안 — 목표가 4개 이상이면 핵심 3개로 줄인다 */
  function fixTextbook(course, unit, m, tb, locks) {
    locks = locks || [];
    var I = lint(tb);
    var extra = "\n[작업] 아래 교재 초안을 규칙에 맞게 고칩니다. 지적된 문제를 모두 해결하고, 문제가 없는 부분의 내용과 표현은 최대한 유지합니다. 학습목표 개수가 4개 이상이면 핵심 3개로 줄입니다." +
      (locks.length ? "\n고정된 칸(" + locks.map(lockLabel).join(", ") + ")은 바꾸지 않습니다." : "") +
      "\n\n[지적된 문제]\n" + issuesText(I) + "\n\n[현재 초안 JSON]\n" + JSON.stringify(tb).slice(0, 80000);
    return call(tbPrompt(course, unit, m, extra), { role: "write" }).then(ai().parseJson).then(function (res) {
      // 목표 수가 줄어도 남는 번호의 고정 칸은 그대로 둔다
      return { tb: enforceLocks(normTB(res, 3).tb, tb, locks), issues: I };
    });
  }

  /* 고른 칸 / 드래그한 부분만 고치기
     o = {keys:["overview","obj0","c1","ck2"], sel:{field:"overview"|"body", i, start, end, text, before, after, label}, ins, refs} */
  var EDIT_CHIPS = ["더 짧게", "더 자세하게", "예시 추가", "쉬운 말로 풀어서", "현업 상황 예시로 바꾸기", "코드 예제 보강", "규칙 위반 고치기", "문장 다듬기"];
  function editTargets(tb) {
    var T = [{ key: "overview", lock: "ov", label: "개요", group: "개요" }];
    tb.objectives.forEach(function (_, i) { T.push({ key: "obj" + i, lock: "o" + i, label: "학습목표 " + (i + 1), group: "학습목표" }); });
    tb.sections.forEach(function (_, i) { T.push({ key: "c" + i, lock: "c" + i, label: "학습내용 " + (i + 1), group: "학습내용" }); });
    tb.checklist.forEach(function (_, i) { T.push({ key: "ck" + i, lock: "k" + i, label: "체크리스트 " + (i + 1), group: "체크리스트" }); });
    return T;
  }
  function fieldValue(tb, key) {
    if (key === "overview") return tb.overview;
    var i = Number(key.replace(/\D/g, ""));
    if (/^obj/.test(key)) return tb.objectives[i];
    if (/^ck/.test(key)) return tb.checklist[i];
    return tb.sections[i];
  }
  function editTextbook(course, unit, m, tb, o) {
    var ctx = R().RULES_TB + "\n\n[학습모듈 정보]\n- 학습모듈 이름: " + m.title + "\n- 카테고리: " + (m.category || "-") +
      "\n- 사용 툴과 버전(메타데이터, 본문에 버전 번호를 쓰지 말 것): " + (toolsText(course, m) || "-") +
      "\n- 학습자 수준: " + ((m.gen || {}).level || LEVELS[1]) + "\n\n[현재 교재 전체 — 맥락 참고용]\n" + JSON.stringify(tb).slice(0, 30000) + (o.refs || "");
    var prompt, sel = o.sel, keys = o.keys || [];
    if (sel) {
      prompt = ["직업훈련기관의 교재 편집자로서 교재의 한 부분만 지시대로 고쳐 씁니다. 설계 규칙을 지킵니다.", "", ctx, "",
        "[고칠 부분 — " + sel.label + " 안의 선택 영역]", sel.text, "",
        "[선택 영역 앞뒤 문맥]", "…" + (sel.before || "") + "【여기를 고침】" + (sel.after || "") + "…", "",
        "[지시]", o.ins, "",
        "[출력] JSON 하나만: {\"replacement\":\"선택 영역을 대신할 글\"}",
        "- 선택 영역만 바꿉니다. 앞뒤 문맥과 자연스럽게 이어지게 씁니다."].join("\n");
    } else {
      var want = {}, T = editTargets(tb);
      keys.forEach(function (k) {
        if (k === "overview") want[k] = "개요 (문단 구분 \\n\\n)";
        else if (/^obj/.test(k)) want[k] = "학습목표 문장 (~할 수 있다.)";
        else if (/^ck/.test(k)) want[k] = { text: "체크리스트 문장", ref: "다시 볼 곳" };
        else want[k] = { title: "덩어리 제목", body: "본문 (목록, ```언어 코드블록, **굵게**)" };
      });
      prompt = ["직업훈련기관의 교재 편집자로서 교재의 일부 칸만 지시대로 고쳐 씁니다. 설계 규칙을 지킵니다.", "", ctx, "",
        "[고칠 칸]",
        keys.map(function (k) { var t = T.filter(function (x) { return x.key === k; })[0]; return "- " + k + " (" + (t ? t.label : k) + "): " + JSON.stringify(fieldValue(tb, k)); }).join("\n").slice(0, 40000), "",
        "[지시]", o.ins, "",
        "[작업 원칙]", "- 고칠 칸만 다시 씁니다. 학습목표·학습내용·체크리스트의 1:1 대응이 깨지지 않게, 다른 칸과 내용이 맞도록 씁니다.", "- 지시와 관계없는 내용은 최대한 유지합니다.", "",
        "[출력] JSON 하나만. 키는 고칠 칸 이름 그대로입니다.", JSON.stringify(want)].join("\n");
    }
    var big = tooBig(prompt);
    if (big) return Promise.reject(big);
    return call(prompt, { role: "write" }).then(ai().parseJson).then(function (res) {
      var next = clone(tb);
      if (sel) {
        var rep = String((res && res.replacement) != null ? res.replacement : "");
        if (!rep) throw new Error("수정 응답이 비어 있어요. 다시 시도해 주세요.");
        var cur = sel.field === "overview" ? next.overview : next.sections[sel.i].body;
        var nv = cur.slice(0, sel.start) + rep + cur.slice(sel.end);
        if (sel.field === "overview") next.overview = nv; else next.sections[sel.i].body = nv;
        return next;
      }
      keys.forEach(function (k) {
        var v = res && res[k];
        if (v == null) return;
        var i = Number(k.replace(/\D/g, ""));
        if (k === "overview") next.overview = String(v);
        else if (/^obj/.test(k)) next.objectives[i] = String(v);
        else if (/^ck/.test(k)) next.checklist[i] = { text: String(v.text != null ? v.text : v.item != null ? v.item : next.checklist[i].text), ref: String(v.ref != null ? v.ref : next.checklist[i].ref) };
        else next.sections[i] = { title: String(v.title != null ? v.title : next.sections[i].title), body: String(v.body != null ? v.body : next.sections[i].body) };
      });
      return next;
    });
  }

  /* ================= NCS 능력단위요소 추천 ================= */
  function elementCandidates(course, unit, m, tb) {
    var NR = K.ncsRef, seen = {}, out = [];
    function add(u) { if (u && !seen[u.code || u.name]) { seen[u.code || u.name] = 1; out.push(u); } }
    NR.enrichedUnits().forEach(add);
    (unit.ncs || []).forEach(function (n) { add(NR.unitInfo(n.code)); });
    var q = [m.title, m.category, tb.objectives.join(" "), tb.sections.map(function (s) { return s.title; }).join(" ")].join(" ");
    NR.search(q, 30).forEach(add);
    NR.search(unit.title + " " + m.title, 12).forEach(add);
    return out.slice(0, 60);
  }
  function refLines(units) {
    return units.map(function (u) {
      return (u.code || "(코드 없음)") + "|" + u.name + "|" + (u.level || "") + "수준|" + (u.subclass || "") + (u.verified === false ? "|미검증" : "") +
        (u.elements.length ? "\n" + u.elements.map(function (e) { return "  - " + (e.code || "(코드없음)") + "|" + e.name; }).join("\n") : "\n  - (능력단위요소 미등록)");
    }).join("\n");
  }
  function normRec(r) {
    var unitCode = String(r.unitCode || "").trim(), elementCode = String(r.elementCode || "").trim();
    if (!unitCode && elementCode) unitCode = elementCode.split(".")[0];
    var info = unitCode ? K.ncsRef.unitInfo(unitCode) : null;
    return {
      unitCode: unitCode, unitName: String(r.unitName || (info && info.name) || ""), level: Number(r.level) || (info && info.level) || null,
      elementCode: elementCode, elementName: String(r.elementName || ""),
      fit: Math.max(0, Math.min(100, Math.round(Number(r.fit) || 0))),
      covers: (r.covers || []).map(Number).filter(function (n) { return n >= 0; }), reason: String(r.reason || "").trim()
    };
  }
  function recommendElements(course, unit, m) {
    var tb = tbOf(m);
    if (!tb.objectives.length) return Promise.reject(new Error("학습목표가 있어야 분석할 수 있습니다."));
    var cands = elementCandidates(course, unit, m, tb);
    if (!ai() || !ai().available("plan")) {
      return Promise.resolve({ recs: cands.slice(0, 6).map(function (u) {
        return { unitCode: u.code, unitName: u.name, level: u.level, elementCode: "", elementName: "", fit: 50, covers: [], reason: "키워드 일치(참조 목록 검색) — AI 키를 저장하면 교재를 분석해 추천합니다." };
      }), note: "AI 없이 키워드로 찾은 후보입니다." });
    }
    var prompt = [
      "국가직무능력표준(NCS) 매핑 담당자로서, 아래 학습모듈 교재에 대응하는 NCS 능력단위요소를 추천합니다.", "",
      "[매핑 규칙]",
      "- 능력단위요소는 학습모듈에 대응한다(추천의 주 대상). 능력단위는 교과목에 대응한다.",
      "- 반드시 [참조 목록]에서 먼저 고른다. 참조 목록의 능력단위에 요소가 등록되지 않았다면 elementCode와 elementName은 빈 문자열로 두고 unitCode만 채운다.",
      "- 참조 목록에 적합한 것이 없을 때만 목록 밖 후보를 제시하되, 코드를 지어내지 말고 unitCode를 빈 문자열로 둔다.",
      "- 교재의 학습목표 중 어느 것을 덮는지 covers에 0부터 시작하는 번호로 적는다.",
      "- fit은 0~100 적합도. 부풀리지 않고 정직하게 매긴다. 확실한 후보 외에 관련성이 낮은 후보(50 미만)도 함께 넣어 모두 8~12개를 추천하고, 적합도 내림차순으로 정렬한다.", "",
      "[참조 목록] (코드|이름|수준|세분류)", refLines(cands).slice(0, 60000), "",
      "[학습모듈] " + m.title + (m.category ? " (" + m.category + ")" : "") + " — 단원: " + unit.title,
      "[개요] " + tb.overview.slice(0, 1500),
      "[학습목표]", tb.objectives.map(function (o, i) { return i + ". " + o; }).join("\n"),
      "[학습내용 제목과 요지]", tb.sections.map(function (s, i) { return i + ". " + s.title + ": " + R().plain(s.body).replace(/\s+/g, " ").slice(0, 500); }).join("\n"), "",
      "[출력] JSON 하나만:",
      "{\"recs\":[{\"unitCode\":\"\",\"unitName\":\"\",\"level\":3,\"elementCode\":\"\",\"elementName\":\"\",\"fit\":85,\"covers\":[0,1],\"reason\":\"한두 문장 근거\"}],\"note\":\"전체 매핑에 대한 한 문장 메모(없으면 빈 문자열)\"}"
    ].join("\n");
    return call(prompt, { role: "plan" }).then(ai().parseJson).then(function (res) {
      var recs = ((res && res.recs) || (Array.isArray(res) ? res : [])).slice(0, 12).map(normRec).filter(function (r) { return r.unitName || r.elementName; });
      if (!recs.length) throw new Error("NCS 추천 응답을 해석하지 못했어요. 다시 시도해 주세요.");
      recs.sort(function (a, b) { return b.fit - a.fit; });
      return { recs: recs, note: String((res && res.note) || "") };
    });
  }

  /* ================= 삽화 (SVG) ================= */
  function artPrompt(art, anchorSvg, req, vb, prevSvg, instruction) {
    return [
      "교육용 교재 삽화를 SVG 코드로 그립니다. 같은 교재 시리즈의 모든 삽화가 한 사람이 그린 것처럼 보이도록 아래 스타일 가이드를 엄격히 지킵니다.", "",
      "[스타일 가이드: " + art.name + "]",
      "- 사용 가능한 색(이 목록의 hex만 사용, 그 밖의 색·투명도 변형 금지): " + art.palette.map(function (p) { return p.role + " " + p.hex; }).join(", "),
      "- 윤곽선: 모든 stroke-width=\"" + art.stroke + "\", stroke는 윤곽선 색, stroke-linecap/linejoin=\"round\"",
      "- 모서리: " + art.corner, "- 채색: " + art.shading, "- 글자: " + art.text, "- 그림 규칙: " + art.rules,
      anchorSvg ? "\n[기준 삽화 SVG — 이 그림과 같은 화풍·도형 문법·선·여백감을 유지]\n" + anchorSvg.slice(0, 14000) + "\n" : "",
      "[기술 조건]",
      "- <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + vb + "\"> 하나. width/height 속성 생략 가능.",
      "- 바탕은 첫 요소로 바탕색 rect 하나.",
      "- <script>, <image>, <foreignObject>, 외부 링크, filter, 그라디언트, opacity 사용 금지.",
      "- 색은 fill/stroke 속성에 hex로 직접 쓴다(style 속성·class 금지).",
      "- 전체 20KB 이하, 도형 수는 필요한 만큼만.",
      prevSvg ? "\n[수정할 기존 SVG]\n" + prevSvg.slice(0, 16000) + "\n\n[수정 요청]\n" + instruction + "\n"
        : "\n[그릴 내용 — " + req.kind + "]\n" + req.desc + "\n" + (req.context ? "\n[참고: 이 삽화가 들어갈 교재 부분]\n" + req.context : ""),
      "[출력] SVG 코드만 출력합니다. 설명·코드펜스 없이 <svg로 시작해 </svg>로 끝냅니다."
    ].join("\n");
  }
  function drawSvg(art, anchorSvg, req, vb) { return call(artPrompt(art, anchorSvg, req, vb), { role: "write" }); }
  function reviseSvg(art, svg, instruction) {
    var vb = (String(svg).match(/viewBox="([^"]+)"/) || [])[1] || "0 0 640 360";
    return call(artPrompt(art, null, null, vb.split(/\s+/).slice(2).join(" "), svg, instruction), { role: "write" });
  }
  /* 이미지를 읽을 수 있는 공급자인지 (Google·Claude) */
  function canSee(role) {
    if (!ai() || !ai().available(role)) return false;
    var p = ai().providerFor(role);
    return p === "gemini" || p === "claude";
  }
  function extractArtStyle(image) {
    var prompt = "첨부한 이미지는 교재 삽화의 화풍 견본입니다. 이 화풍을 SVG 벡터 삽화로 재현할 수 있도록 스타일 가이드를 추출합니다.\n" +
      "JSON 하나만 출력:\n{\"name\":\"가이드 이름(짧게)\",\"palette\":[{\"role\":\"윤곽선|주색|보조색|강조색|바탕|그림자 등\",\"hex\":\"#RRGGBB\"}],\"stroke\":2.5,\"corner\":\"모서리 처리\",\"shading\":\"채색 방식\",\"text\":\"이미지 안 글자 처리\",\"rules\":\"형태·인물·구도 규칙 2~3문장\"}\npalette는 5~8색.";
    return call(prompt, { role: "write", images: [image] }).then(ai().parseJson);
  }
  /* 이미지(스캔 PDF 쪽·사진)의 글자를 그대로 옮겨 적기 — 4장씩 */
  function transcribeImages(pages, onStep) {
    var per = 4, out = [], chain = Promise.resolve();
    for (var i = 0; i < pages.length; i += per) {
      (function (part, at) {
        chain = chain.then(function () {
          if (onStep) onStep(at, pages.length);
          var prompt = "첨부한 이미지 " + part.length + "장은 교육 자료(교안·슬라이드·교재)의 페이지입니다. 각 이미지에 있는 글자를 빠짐없이 그대로 옮겨 적습니다. 요약하거나 고쳐 쓰지 않습니다. 표는 행마다 「칸 | 칸」으로, 코드는 그대로, 그림·도식은 [그림: 무엇을 나타내는지 한 줄]로 적습니다.\n" +
            "JSON 배열 하나만 출력합니다. 이미지 순서대로 각 원소는 그 페이지의 글자(문자열)입니다.";
          return call(prompt, { role: "fast", images: part.map(function (p) { return p.image; }) }).then(ai().parseJson).then(function (arr) {
            arr = Array.isArray(arr) ? arr : [];
            part.forEach(function (p, k) { out.push({ n: p.n, text: String(arr[k] || "").trim() }); });
          });
        });
      })(pages.slice(i, i + per), i);
    }
    return chain.then(function () { return out; });
  }

  K.courseTB = {
    tbOf: tbOf, applyTB: applyTB, lint: lint, isEmpty: isEmpty, lockLabel: lockLabel, enforceLocks: enforceLocks, shiftLocks: shiftLocks,
    editTargets: editTargets, toolsText: toolsText, bytes: bytes, PROMPT_LIMIT: PROMPT_LIMIT, LEVELS: LEVELS, LENGTHS: LENGTHS, EDIT_CHIPS: EDIT_CHIPS,
    normTB: normTB, tbPrompt: tbPrompt, canSee: canSee
  };
  Object.assign(K.courseAI, {
    draftTextbook: draftTextbook, fixTextbook: fixTextbook, editTextbook: editTextbook, recommendElements: recommendElements,
    drawSvg: drawSvg, reviseSvg: reviseSvg, extractArtStyle: extractArtStyle, transcribeImages: transcribeImages, artPrompt: artPrompt
  });
})();
