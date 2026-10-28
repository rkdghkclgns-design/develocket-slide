/* course-ai.js — 과정 설계의 AI 단계 (프롬프트·응답 해석)
 *   planCourse      : 과정 목표 + 단원별 시간 제안 + 단원→학습모듈 블록(목표·흐름·시간)       [plan]
 *   recommendNcs    : 세분류 1차 선택 → 참조 목록 후보 중 능력단위 추천(혼합 모드는 두 모델 합의) [plan]
 *   generateUnit    : 학습모듈별 교재·교수안 작성 [write] + 슬라이드 편성 [혼합 모드는 fast]
 *   generateQuestions / reviewQuestions : 문항 초안 [qgen] → 다른 모델이 교차 검수 [review]
 * 공급자 선택은 ai-client.js(K.ai) 가 역할(role)로 결정한다. */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  function C() { return K.course; }
  function ai() { return K.ai; }
  function mixed() { return !!(K.AI && K.AI.isMixed && K.AI.isMixed()); }
  function who(role) { return ai().providerLabel(ai().providerFor(role)); }

  /* 학습자용 교재 작성 규칙 (「콘텐츠 업무 설계」 5장 교재·작성 어투) */
  var STYLE_RULES = [
    "- 경어체로 쓰고 종결은 '~합니다 / ~하지 않습니다'로 통일합니다.",
    "- 학습자를 호칭하지 않습니다('여러분·당신·우리' 금지). 주어 없이 동작만 서술합니다.",
    "- 지시의 강도를 어미로 구분합니다: 규칙 '~해야 합니다', 권장 '~하는 것이 좋습니다', 설명 '~입니다'.",
    "- 모호한 표현을 쓰지 않습니다: '경우에 따라 다릅니다·상황에 맞게'는 판단 기준을 쓰고, '매우·아주·굉장히'는 수치로, '당연히·물론·쉽게'는 쓰지 않습니다.",
    "- 다른 학습모듈·과정을 지칭하지 않습니다('앞에서 배운', '다음 시간에' 금지). 문제는 도메인의 상황으로 서술합니다.",
    "- 버전·단축키·UI 위치처럼 버전에 따라 바뀌는 정보는 본문에 흩어 쓰지 않습니다."
  ].join("\n");

  function unitBrief(course, unit) {
    return "[과정] " + course.title + (course.goal ? "\n[과정 목표] " + course.goal : "") +
      "\n[대상] " + (course.target || "직업훈련 수강생") + "\n[단원(교과목)] " + unit.title + " — " + unit.hours + "시간";
  }

  /* ================= 1. 과정·블록 설계 ================= */
  function planGoal(course) {
    var prompt = [
      "당신은 직업훈련 과정 설계 전문가입니다. 아래 과정의 '과정 목표'와 단원별 시간 배분을 제안하세요.",
      "과정 목표는 수료 시점에 도달해야 할 최종 목표를 관찰 가능한 행동으로 1~2문장에 씁니다('~할 수 있다').",
      "시간은 각 단원의 난이도·실습량을 반영한 정수 시간이며 합계가 정확히 " + course.totalHours + "시간이어야 합니다.",
      "",
      "[과정] " + course.title,
      "[대상] " + (course.target || "직업훈련 수강생"),
      "[단원]",
      course.units.map(function (u, i) { return (i + 1) + ". " + u.title; }).join("\n"),
      "",
      "JSON만 출력합니다: {\"goal\": \"...\", \"hours\": [정수, ...]}"
    ].join("\n");
    return ai().call(prompt, { role: "plan" }).then(ai().parseJson);
  }

  function planUnit(course, unit) {
    var prompt = [
      "당신은 직업훈련 교재 설계 전문가입니다. 아래 단원(교과목)을 학습모듈(교육의 최소 단위 블록)로 나누세요.",
      unitBrief(course, unit),
      "",
      "[규칙]",
      "- 학습모듈은 다른 교과목에서도 재사용할 수 있는 독립 블록입니다. 블록 하나는 60~180분입니다.",
      "- 모든 학습모듈의 minutes 합계는 정확히 " + (unit.hours * 60) + "분입니다.",
      "- 학습목표는 블록당 1~3개, '~할 수 있다'로 끝나며 관찰 가능한 행동(설명·비교·분류·작성·구현·평가)과 수행 조건·제약을 포함합니다. '이해한다·안다·익힌다'는 쓰지 않습니다.",
      "- flow는 블록 안의 진행 단계로 도입 1개, 전개 1~4개, 정리 1개입니다. flow의 minutes 합계는 블록 minutes와 같고 5분 단위입니다.",
      "- 전개 단계 title은 실제로 다룰 내용이나 활동을 구체적으로 씁니다.",
      "",
      "JSON만 출력합니다:",
      "{\"modules\": [{\"title\": \"...\", \"minutes\": 120, \"objectives\": [\"...\"], \"flow\": [{\"phase\": \"도입\", \"title\": \"...\", \"minutes\": 10}]}]}"
    ].join("\n");
    return ai().call(prompt, { role: "plan" }).then(ai().parseJson).then(function (j) {
      var mods = (j && j.modules) || [];
      if (!mods.length) throw new Error("'" + unit.title + "' 블록 설계 응답이 비어 있어요.");
      unit.modules = mods.map(function (m) {
        var flow = (m.flow || []).filter(function (f) { return f && f.title; }).map(function (f) {
          var ph = /도입/.test(f.phase) ? "도입" : /정리/.test(f.phase) ? "정리" : "전개";
          return { phase: ph, title: String(f.title).trim(), minutes: Number(f.minutes) || 10 };
        });
        return {
          id: C().uid("m"), title: String(m.title || unit.title).trim(), minutes: Number(m.minutes) || 60,
          objectives: (m.objectives || []).map(function (o) { return String(o).trim(); }).filter(Boolean).slice(0, C().MAX_OBJECTIVES),
          flow: flow.length ? flow : null, content: null, questions: []
        };
      });
      C().normalizeUnit(unit);
      unit.outputs = null;
      return unit;
    });
  }

  /* opts.keepHours: 사용자가 정한 단원 시간을 유지 */
  function planCourse(course, onProgress, opts) {
    opts = opts || {};
    var prog = onProgress || function () {};
    var total = course.units.length + 1;
    prog(0, total, "과정 목표·시간 배분 설계 중… (" + who("plan") + ")");
    return planGoal(course).catch(function () { return {}; }).then(function (g) {
      if (g && g.goal && !course.goal) course.goal = String(g.goal).trim();
      if (!opts.keepHours && g && Array.isArray(g.hours) && g.hours.length === course.units.length) {
        var hours = C().allocateHours(course.units.length, course.totalHours, g.hours.map(Number));
        course.units.forEach(function (u, i) { u.hours = hours[i]; });
      }
      prog(1, total, "과정 목표 완료");
      var chain = Promise.resolve();
      course.units.forEach(function (u, i) {
        chain = chain.then(function () {
          prog(i + 1, total, "단원 " + (i + 1) + "/" + course.units.length + " 블록 설계 중… (" + u.title + ")");
          return planUnit(course, u).then(function () { prog(i + 2, total, "단원 " + (i + 1) + " 완료"); });
        });
      });
      return chain.then(function () { return course; });
    });
  }

  /* ================= 2. NCS 추천 ================= */
  function objectiveLines(unit) {
    return C().objectiveRefs(unit).map(function (o) { return o.ref + " " + o.text; }).join("\n") || "(학습목표 없음)";
  }

  function pickSubds(course, unit) {
    var list = C().ncsSubdList().map(function (s) { return s.code + " | " + s.path.join(" > "); }).join("\n");
    var prompt = [
      "아래 단원(교과목)에 대응할 NCS 세분류를 현행 분류 목록에서 최대 6개 고르세요.",
      unitBrief(course, unit), "[학습목표]", objectiveLines(unit), "",
      "[현행 세분류 목록: 코드 | 대분류 > 중분류 > 소분류 > 세분류]", list, "",
      "목록에 있는 코드만 사용합니다. JSON만 출력합니다: {\"subds\": [\"20010707\", ...]}"
    ].join("\n");
    return ai().call(prompt, { role: "plan" }).then(ai().parseJson).then(function (j) {
      var valid = (K.NCS && K.NCS.subd) || {};
      return ((j && j.subds) || []).map(String).filter(function (c) { return valid[c]; }).slice(0, 6);
    }).catch(function () { return []; });
  }

  function rankPrompt(course, unit, cands) {
    return [
      "당신은 NCS 기반 교육과정 설계 전문가입니다. 아래 단원(교과목)에 대응할 능력단위를 후보 목록에서 고르세요.",
      "지침: 교과목에는 능력단위를 대응시키며 하나의 교과목이 여러 능력단위를 묶을 수 있습니다. 분류번호는 후보에 적힌 현행 코드를 그대로 씁니다.",
      unitBrief(course, unit), "[학습목표 — 번호는 '학습모듈.목표']", objectiveLines(unit), "",
      "[후보: 코드 | 능력단위 | 세분류 | 수준]",
      cands.map(function (u) { return u.code + " | " + u.name + " | " + u.path[3] + " | " + u.level + "수준"; }).join("\n"), "",
      "최대 5개를 적합도 높은 순으로 고르고, 각 항목이 대응하는 학습목표 번호와 근거(1문장, 학습목표의 어떤 수행이 능력단위의 어떤 직무와 대응하는지)를 씁니다.",
      "JSON만 출력합니다: [{\"code\": \"...\", \"score\": 0~100 정수, \"objectives\": [\"1.2\"], \"reason\": \"...\"}]"
    ].join("\n");
  }

  function parseRank(text, candMap) {
    var arr = ai().parseJson(text);
    if (!Array.isArray(arr)) arr = (arr && (arr.items || arr.results)) || [];
    return arr.filter(function (r) { return r && candMap[r.code]; }).slice(0, 5).map(function (r) {
      return {
        code: r.code, score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
        objectives: (r.objectives || []).map(String), reason: String(r.reason || "").trim()
      };
    });
  }

  function recommendNcs(course, unit, onProgress) {
    var prog = onProgress || function () {};
    var query = unit.title + " " + C().objectiveRefs(unit).map(function (o) { return o.text; }).join(" ") + " " +
      (unit.modules || []).map(function (m) { return m.title; }).join(" ");
    var local = C().ncsSearch(query, 15);
    if (!ai() || !ai().available("plan")) {
      return Promise.resolve(local.slice(0, 6).map(function (u) {
        return Object.assign(u, { score: u.match, objectives: [], reason: "키워드 일치(참조 목록 검색) — AI 키를 저장하면 근거와 학습목표 대응을 함께 추천합니다.", source: "catalog", by: "키워드" });
      }));
    }
    prog("세분류 후보 선택 중… (" + who("plan") + ")");
    return pickSubds(course, unit).then(function (subds) {
      var cands = local.slice();
      var have = {};
      cands.forEach(function (u) { have[u.code] = 1; });
      if (subds.length) {
        C().ncsSearch(query, 30, { subds: subds, perSubd: 8 }).forEach(function (u) { if (!have[u.code]) { have[u.code] = 1; cands.push(u); } });
        (K.NCS.units || []).forEach(function (u) {
          if (cands.length < 45 && subds.indexOf(u[0].slice(0, 8)) !== -1 && !have[u[0]]) { have[u[0]] = 1; cands.push(C().ncsUnit(u[0])); }
        });
      }
      var candMap = {};
      cands.forEach(function (u) { candMap[u.code] = u; });
      var prompt = rankPrompt(course, unit, cands);
      prog("능력단위 적합도 판단 중… (" + (mixed() ? "Claude·Gemini 교차" : who("plan")) + ")");
      var runs = mixed()
        ? [ai().call(prompt, { role: "plan", provider: "claude" }), ai().call(prompt, { role: "plan", provider: "gemini" }).catch(function () { return "[]"; })]
        : [ai().call(prompt, { role: "plan" })];
      return Promise.all(runs).then(function (texts) {
        var lists = texts.map(function (t) { try { return parseRank(t, candMap); } catch (e) { return []; } });
        var merged = {};
        lists.forEach(function (list, li) {
          list.forEach(function (r) {
            var m = merged[r.code] || (merged[r.code] = { code: r.code, scores: [], objectives: {}, reasons: [], by: [] });
            m.scores.push(r.score);
            r.objectives.forEach(function (o) { m.objectives[o] = 1; });
            if (r.reason) m.reasons.push(r.reason);
            m.by.push(lists.length > 1 ? (li === 0 ? "Claude" : "Gemini") : who("plan"));
          });
        });
        var out = Object.keys(merged).map(function (code) {
          var m = merged[code];
          var avg = m.scores.reduce(function (a, b) { return a + b; }, 0) / m.scores.length;
          var cross = lists.length > 1 && m.by.length > 1;
          // 한 모델만 고른 항목은 합의 항목보다 뒤에 오도록 소폭 감점
          var score = Math.round(lists.length > 1 && !cross ? avg * 0.9 : avg);
          return Object.assign({}, candMap[code], {
            score: score, objectives: Object.keys(m.objectives).sort(), reason: m.reasons[0] || "",
            source: "catalog", cross: cross, by: m.by.join("·")
          });
        }).sort(function (a, b) { return b.score - a.score; });
        if (!out.length) throw new Error("NCS 추천 응답을 해석하지 못했어요. 다시 시도해 주세요.");
        return out.slice(0, 6);
      });
    });
  }

  /* ================= 3. 학습모듈 교재·교수안·슬라이드 ================= */
  function slideRules() {
    var detailed = K.AI && K.AI.slideStyle === "detailed";
    return detailed
      ? "슬라이드는 상세 교재형으로 학습내용 덩어리마다 1~2장, 슬라이드만 읽어도 이해되도록 설명 문장(각 1~2문장) 3~5개로 구성합니다."
      : "슬라이드는 프레젠테이션용으로 학습내용 덩어리마다 1장, 화면에 띄울 짧은 문구·핵심 키워드 위주로 구성합니다(단계는 ' → ', 나열은 ' / ').";
  }
  var SLIDE_FORMAT = [
    "### 슬라이드 - (슬라이드 제목)",
    "- 슬라이드 문구:",
    "  - (문구)",
    "- 이미지/시각: (어울리는 이미지 한 줄 제안)",
    "- 핵심 메시지: (한 줄 메시지)"
  ].join("\n");

  function moduleWritePrompt(course, unit, mi, withSlides) {
    var m = unit.modules[mi];
    var objs = m.objectives.length ? m.objectives : [m.title + "의 핵심 내용을 사례를 들어 설명할 수 있다"];
    var steps = (m.flow || []).map(function (f, i) { return "#" + (i + 1) + " " + f.phase + " - " + f.title + " (" + f.minutes + "분)"; }).join("\n");
    var L = [
      "당신은 직업훈련 교재 작가이자 교수설계자입니다. 아래 학습모듈 하나의 (A) 학습자용 교재와 (B) 강사용 교수안 단계별 지침" + (withSlides ? "과 (C) 슬라이드 편성" : "") + "을 작성하세요.",
      unitBrief(course, unit),
      "[학습모듈] " + m.title + " — " + m.minutes + "분",
      "[학습목표]", objs.map(function (o, i) { return (i + 1) + ". " + o; }).join("\n"),
      "[진행 단계]", steps, "",
      "[A 교재 작성 규칙]", STYLE_RULES,
      "- 개요: 이 학습모듈을 왜 배우는지 — 어떤 문제 상황이 있는지 / 무엇을 해결해야 하는지 / 학습 후 무엇이 가능해지는지 (3~5문장).",
      "- 학습내용은 학습목표 하나당 한 덩어리입니다(목표 " + objs.length + "개 = 덩어리 " + objs.length + "개). 각 덩어리는 정의·원리·구체 예시 2개 이상을 담고 400~900자, 필요하면 목록·표를 씁니다.",
      "- 체크리스트는 학습목표와 1:1로, 학습자가 스스로 확인하는 질문 문장입니다('~할 수 있습니까?').",
      "",
      "[B 교수안 규칙] 진행 단계마다 아래 네 줄을 씁니다. 멘트 예시는 강사가 실제로 말하듯 1~2문장입니다.",
      "**강사 활동**: … / **설명 내용**: … / **멘트 예시**: \"…\" / **학생 활동**: …",
      ""
    ];
    if (withSlides) L.push("[C 슬라이드 규칙] " + slideRules() + " 학습자를 호칭하지 않습니다. 형식:", SLIDE_FORMAT, "");
    L.push("[출력 형식 — 아래 구분자와 순서를 그대로 지키고 다른 말은 쓰지 않습니다]",
      "@@개요@@", "(개요)");
    objs.forEach(function (o, i) { L.push("@@내용 " + (i + 1) + "@@", "제목: (소제목)", "(본문)"); });
    L.push("@@체크리스트@@", objs.map(function (o, i) { return (i + 1) + ". (질문)"; }).join("\n"), "@@교수안@@");
    (m.flow || []).forEach(function (f, i) { L.push("#" + (i + 1), "**강사 활동**: …", "**설명 내용**: …", "**멘트 예시**: \"…\"", "**학생 활동**: …"); });
    if (withSlides) L.push("@@슬라이드@@", "(### 슬라이드 블록들)");
    return L.join("\n");
  }

  function splitMarkers(text) {
    var out = {};
    var re = /^@@\s*([^@]+?)\s*@@\s*$/gm;
    var idx = [], m;
    while ((m = re.exec(text))) idx.push({ key: m[1].trim(), start: m.index, end: re.lastIndex });
    idx.forEach(function (x, i) { out[x.key] = text.slice(x.end, i + 1 < idx.length ? idx[i + 1].start : text.length).trim(); });
    return out;
  }

  function parseModuleWrite(text, m) {
    var s = splitMarkers(String(text || "").replace(/\r\n/g, "\n"));
    var objs = m.objectives.length ? m.objectives : [m.title];
    var sections = objs.map(function (o, i) {
      var raw = s["내용 " + (i + 1)] || s["내용" + (i + 1)] || "";
      var tm = raw.match(/^제목\s*[:：]\s*(.+)$/m);
      return { title: tm ? tm[1].trim() : o, body: raw.replace(/^제목\s*[:：].*$/m, "").trim() };
    });
    var checklist = String(s["체크리스트"] || "").split("\n").map(function (l) { return l.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim(); })
      .filter(Boolean).slice(0, objs.length).map(function (t) { return { text: t }; });
    var guideRaw = String(s["교수안"] || "");
    var guide = (m.flow || []).map(function (f, i) {
      var mm = guideRaw.split(/^#\s*\d+\s*$/m);
      return (mm[i + 1] || "").trim();
    });
    return { overview: s["개요"] || "", sections: sections, checklist: checklist, guide: guide, slides: s["슬라이드"] || "" };
  }

  function slidesPrompt(course, unit, m, content) {
    return [
      "아래 학습모듈 교재를 발표 슬라이드 편성으로 바꾸세요. " + slideRules(),
      "학습자를 호칭하지 않고, 교재에 없는 사실을 새로 만들지 않습니다. 각 슬라이드의 이미지/시각에는 생성 AI로 만들 수 있는 구체적 장면을 한 줄로 제안합니다.",
      "[단원] " + unit.title + " / [학습모듈] " + m.title,
      "[개요] " + content.overview,
      content.sections.map(function (s, i) { return "[학습내용 " + (i + 1) + "] " + s.title + "\n" + s.body; }).join("\n\n"),
      "", "형식(이 블록만 반복 출력):", SLIDE_FORMAT
    ].join("\n");
  }

  function generateModule(course, unit, mi) {
    var m = unit.modules[mi];
    var split = mixed();
    return ai().call(moduleWritePrompt(course, unit, mi, !split), { role: "write" }).then(function (text) {
      var content = parseModuleWrite(text, m);
      content.by = who("write");
      if (!split) return content;
      return ai().call(slidesPrompt(course, unit, m, content), { role: "fast" }).then(function (slides) {
        content.slides = String(slides || "").replace(/^```\w*\s*|```\s*$/g, "").trim();
        content.by = who("write") + " 교재·교수안 + " + who("fast") + " 슬라이드";
        return content;
      }).catch(function () { return content; });
    }).then(function (content) {
      var all = [content.overview].concat(content.sections.map(function (s) { return s.body; }), content.checklist.map(function (c) { return c.text; })).join("\n");
      content.lint = C().lintText(all);
      m.content = content;
      return m;
    });
  }

  function buildOutputs(course, unit) {
    unit.outputs = {
      docMd: C().lessonPlanMd(course, unit),
      textMd: C().textbookMd(course, unit),
      deckMd: C().deckMd(course, unit),
      generatedAt: C().todayStr()
    };
    return unit.outputs;
  }

  function generateUnit(course, unit, onProgress) {
    var prog = onProgress || function () {};
    var total = unit.modules.length;
    var chain = Promise.resolve();
    unit.modules.forEach(function (m, mi) {
      chain = chain.then(function () {
        prog(mi, total, "학습모듈 " + (mi + 1) + "/" + total + " 작성 중… (" + m.title + " · " + (mixed() ? "Claude 교재 → Gemini 슬라이드" : who("write")) + ")");
        return generateModule(course, unit, mi);
      });
    });
    return chain.then(function () {
      prog(total, total, "교수안·교재·편성안 조립 중…");
      return buildOutputs(course, unit);
    });
  }

  /* ================= 4. 문제은행 ================= */
  var TYPE_RULES = {
    "객관식": "보기 4개. 정답이 해석에 따라 갈리지 않게 확정되도록 출제합니다. 단일 선택은 정답 1개, 복수 정답은 정답 2개 이상 + 오답 1개 이상이며 본문에 '모두 고르시오'를 밝힙니다. 오답 보기는 흔한 오개념으로 만듭니다.",
    "단답식": "단어나 값 하나로 답합니다. answer에 정답, accepted에 허용 표기(대소문자·띄어쓰기·동의어)를 씁니다.",
    "서술형": "줄글로 답합니다. rubric에 채점 요소별 점수(합계 10점 내외)를 씁니다. 답변이 각 요소를 충족할 때마다 점수를 더합니다.",
    "코드제출": "code에 시작 코드(학습내용에 쓰인 언어 기준, 없으면 의사코드/프롬프트 텍스트)를 주고, tests에 기대 출력 또는 테스트 케이스를 씁니다.",
    "파일제출": "요구사항만 제시하고 방법은 주지 않습니다. rubric에 채점자 간 편차를 줄이는 관찰 가능한 평가 기준과 점수를 씁니다."
  };

  function questionPrompt(course, unit, m, spec) {
    var band = C().BANDS[spec.band];
    var content = m.content
      ? m.content.sections.map(function (s, i) { return "[학습내용 " + (i + 1) + "] " + s.title + "\n" + s.body.slice(0, 1400); }).join("\n\n")
      : "(교재 미작성 — 학습목표 기준으로 출제)";
    var checklist = m.content ? m.content.checklist.map(function (c) { return "- " + c.text; }).join("\n") : "";
    return [
      "당신은 직업훈련 평가 문항 출제 전문가입니다. 아래 학습모듈의 문제은행 문항 " + spec.count + "개를 만드세요.",
      "[학습모듈] " + m.title + " (단원: " + unit.title + ")",
      "[대상 학습목표 " + spec.objective + "] " + (m.objectives[spec.objective - 1] || m.title),
      "[밴드 " + spec.band + " — " + band.name + "] " + band.desc,
      "[유형] " + spec.type + (spec.multi ? " (복수 정답)" : "") + " — " + TYPE_RULES[spec.type],
      "", "[공통 규칙]",
      "- 문항은 학습목표 " + spec.objective + "의 도달 여부를 판정합니다. 서로 다른 상황·소재로 겹치지 않게 만듭니다.",
      "- 체크리스트 문장을 그대로 문항으로 쓰지 않습니다. 체크리스트는 설명 가능 여부, 문항은 구체적 상황에서의 판단을 묻습니다.",
      "- 버전·단축키·UI 위치처럼 버전에 의존하는 정보를 문항에 담지 않습니다.",
      "- 경어체로 씁니다. explanation에는 정답 근거와 오답이 틀린 이유를 씁니다.",
      checklist ? "[체크리스트(그대로 쓰지 말 것)]\n" + checklist : "",
      "", content, "",
      "JSON 배열만 출력합니다. 해당 유형에 필요 없는 필드는 빈 값으로 둡니다:",
      "[{\"stem\": \"...\", \"code\": \"\", \"choices\": [{\"text\": \"...\", \"correct\": false}], \"answer\": \"\", \"accepted\": \"\", \"rubric\": [{\"criterion\": \"...\", \"points\": 0}], \"tests\": \"\", \"explanation\": \"...\"}]"
    ].join("\n");
  }

  function toQuestion(raw, spec) {
    var Q = C().newQuestion({ objective: spec.objective, band: spec.band, type: spec.type, multi: !!spec.multi });
    Q.stem = String(raw.stem || "").trim();
    Q.code = String(raw.code || "").trim();
    Q.choices = spec.type === "객관식" ? (raw.choices || []).map(function (c) { return { text: String(c.text || c).trim(), correct: !!c.correct }; }) : [];
    Q.answer = String(raw.answer || "").trim();
    Q.accepted = String(raw.accepted || "").trim();
    Q.rubric = (raw.rubric || []).filter(function (r) { return r && r.criterion; }).map(function (r) { return { criterion: String(r.criterion).trim(), points: Number(r.points) || 0 }; });
    Q.tests = String(raw.tests || "").trim();
    Q.explanation = String(raw.explanation || "").trim();
    Q.by = who("qgen");
    return Q;
  }

  function reviewQuestions(course, unit, m, qs) {
    var payload = qs.map(function (q, i) {
      return { i: i, objective: q.objective, band: q.band, type: q.type, multi: q.multi, stem: q.stem, code: q.code,
        choices: q.choices, answer: q.answer, accepted: q.accepted, rubric: q.rubric, tests: q.tests, explanation: q.explanation };
    });
    var prompt = [
      "당신은 평가 문항 검수자입니다. 다른 출제자가 만든 문항을 아래 기준으로 엄격히 검수하세요.",
      "[학습모듈] " + m.title, "[학습목표]", m.objectives.map(function (o, i) { return (i + 1) + ". " + o; }).join("\n"),
      "[기준] 1) 태그한 학습목표를 실제로 묻는가 2) 밴드 정의에 맞는가(L1 수업과 같은 상황 / L2 같은 구조·다른 맥락 / L3 요구사항만 제시) 3) 정답이 하나로 확정되는가, 오답 보기가 명백히 틀렸는가 4) 서술형·파일제출 채점 기준이 관찰 가능한가 5) 사실 오류가 없는가 6) 버전 의존 정보·모호한 표현이 없는가",
      "", JSON.stringify(payload), "",
      "JSON 배열만 출력합니다: [{\"i\": 0, \"ok\": true, \"notes\": \"문제가 있으면 무엇을 고쳐야 하는지 1문장, 없으면 빈 문자열\"}]"
    ].join("\n");
    return ai().call(prompt, { role: "review" }).then(ai().parseJson).then(function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (r) {
        var q = qs[Number(r.i)];
        if (q) q.review = { by: who("review"), ok: r.ok !== false, notes: String(r.notes || "").trim() };
      });
      return qs;
    }).catch(function () { return qs; });
  }

  function generateQuestions(course, unit, mi, spec) {
    var m = unit.modules[mi];
    return ai().call(questionPrompt(course, unit, m, spec), { role: "qgen" }).then(ai().parseJson).then(function (arr) {
      if (!Array.isArray(arr)) arr = (arr && (arr.questions || arr.items)) || [];
      var qs = arr.slice(0, spec.count).map(function (r) { return toQuestion(r, spec); }).filter(function (q) { return q.stem; });
      if (!qs.length) throw new Error("문항 생성 응답이 비어 있어요. 다시 시도해 주세요.");
      // 혼합 모드: 생성한 모델과 다른 모델이 교차 검수한다
      return mixed() ? reviewQuestions(course, unit, m, qs) : qs;
    });
  }

  K.courseAI = {
    planCourse: planCourse, planUnit: planUnit, recommendNcs: recommendNcs,
    generateUnit: generateUnit, generateModule: generateModule, buildOutputs: buildOutputs,
    generateQuestions: generateQuestions, reviewQuestions: reviewQuestions,
    _parseModuleWrite: parseModuleWrite, _splitMarkers: splitMarkers
  };
})();
