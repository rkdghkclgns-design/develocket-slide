/* course-ai.js — 과정 설계의 AI 단계 (프롬프트·응답 해석)
 *   planCourse      : 과정 목표 + 단원별 시간 제안 + 단원→학습모듈 블록(목표·흐름·시간)       [plan]
 *   recommendNcs    : 세분류 1차 선택 → 참조 목록 후보 중 능력단위 추천(혼합 모드는 두 모델 합의) [plan]
 *   generateUnit    : 학습모듈별 교재·교수안 작성 [write] + 슬라이드 편성 [혼합 모드는 fast] — 실패한 학습모듈은 다시 시도 후 건너뛰고 계속
 *   generateCourse  : 모든 단원의 남은 학습모듈만 이어서 작성
 *   generateQuestions / reviewQuestions : 문항 초안 [qgen] → 다른 모델이 교차 검수 [review]
 * 공급자 선택은 ai-client.js(K.ai) 가 역할(role)로 결정한다. */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  function C() { return K.course; }
  function ai() { return K.ai; }
  function mixed() { return !!(K.AI && K.AI.isMixed && K.AI.isMixed()); }
  function who(role) { return ai().providerLabel(ai().providerFor(role)); }

  /* 화면의 '중지' 버튼·진행 글자 수를 모든 호출에 연결한다 (작업은 한 번에 하나) */
  var CTX = {};
  function setCallContext(o) { CTX = o || {}; }
  function aicall(prompt, o) {
    var x = {};
    for (var k in (o || {})) x[k] = o[k];
    if (CTX.signal && !x.signal) x.signal = CTX.signal;
    if (CTX.onChars && !x.onChars) x.onChars = CTX.onChars;
    return ai().call(prompt, x);
  }

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
    return aicall(prompt, { role: "plan" }).then(ai().parseJson);
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
    return aicall(prompt, { role: "plan" }).then(ai().parseJson).then(function (j) {
      var mods = (j && j.modules) || [];
      if (!mods.length) throw new Error("'" + unit.title + "' 블록 설계 응답이 비어 있어요.");
      unit.modules = mods.map(function (m) {
        var flow = (m.flow || []).filter(function (f) { return f && f.title; }).map(function (f) {
          var ph = /도입/.test(f.phase) ? "도입" : /정리/.test(f.phase) ? "정리" : "전개";
          return { phase: ph, title: String(f.title).trim(), minutes: Number(f.minutes) || 10 };
        });
        // 학습모듈 기본 필드(상태·NCS·삽화·메타데이터)를 처음부터 갖춘다 — 설계가 중간에 실패해도 화면이 깨지지 않게
        return C().newModule({
          title: String(m.title || unit.title).trim(), minutes: Number(m.minutes) || 60,
          objectives: (m.objectives || []).map(function (o) { return String(o).trim(); }).filter(Boolean).slice(0, C().MAX_OBJECTIVES),
          flow: flow.length ? flow : null
        });
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
    return aicall(prompt, { role: "plan" }).then(ai().parseJson).then(function (j) {
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
        ? [aicall(prompt, { role: "plan", provider: "claude" }), aicall(prompt, { role: "plan", provider: "gemini" }).catch(function () { return "[]"; })]
        : [aicall(prompt, { role: "plan" })];
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
      "- 학습내용은 학습목표 하나당 한 덩어리입니다(목표 " + objs.length + "개 = 덩어리 " + objs.length + "개). 각 덩어리는 정의·원리·구체 예시 2개 이상을 담습니다.",
      "- " + ((K.courseRules && K.courseRules.LESSON_STYLE) || "학습내용 본문은 '## 소주제'와 '- ' 글머리 문장으로 씁니다.").replace(/^13\.\s*/, ""),
      "- 오늘의 퀘스트(기본 실습): 이 학습모듈을 마친 뒤 수행하는 실습 과제 하나 — 제목 한 줄과 수행할 일 2~4줄('- ~합니다.', 결과물 형식 포함).",
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
    L.push("@@체크리스트@@", objs.map(function (o, i) { return (i + 1) + ". (질문)"; }).join("\n"),
      "@@실습@@", "제목: (오늘의 퀘스트 제목)", "- (수행할 일)", "@@교수안@@");
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
      .filter(Boolean).slice(0, objs.length).map(function (t, i) { return { text: t, ref: "학습내용 " + (i + 1) }; });
    var guideRaw = String(s["교수안"] || "");
    var guide = (m.flow || []).map(function (f, i) {
      var mm = guideRaw.split(/^#\s*\d+\s*$/m);
      return (mm[i + 1] || "").trim();
    });
    return { overview: s["개요"] || "", sections: sections, checklist: checklist, guide: guide, slides: s["슬라이드"] || "", quest: parseQuest(s["실습"]) };
  }
  /* 오늘의 퀘스트 — "제목: …" 한 줄 + "- 수행할 일" 줄들 → {title, steps} (없으면 null) */
  function parseQuest(raw) {
    var lines = String(raw || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var tm = lines.map(function (l) { return l.match(/^제목\s*[:：]\s*(.+)$/); }).filter(Boolean)[0];
    var steps = lines.filter(function (l) { return /^[-*•]\s+/.test(l); }).map(function (l) { return l.replace(/^[-*•]\s+/, "").trim(); }).filter(Boolean);
    var title = tm ? tm[1].trim() : (lines[0] && !/^[-*•]\s+/.test(lines[0]) ? lines[0] : "");
    return title || steps.length ? { title: title.replace(/^[⚙️\s]+/, ""), steps: steps.slice(0, 6) } : null;
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

  /* 교재가 이미 있으면(직접 고친 교재 포함) 교재는 그대로 두고 교수안 지침·슬라이드만 만든다
     — 지침: 콘텐츠의 원본은 학습모듈(교재)에만 있고, 교안은 그것을 바탕으로 설계한다 */
  function hasTextbook(m) {
    var c = m.content;
    // 개요나 학습내용 중 하나라도 쓴 교재는 덮어쓰지 않는다
    return !!(c && (String(c.overview || "").trim() || (c.sections || []).some(function (s) { return String(s.body || "").trim(); })));
  }
  function lessonPrompt(course, unit, m, withSlides) {
    var c = m.content;
    var steps = (m.flow || []).map(function (f, i) { return "#" + (i + 1) + " " + f.phase + " - " + f.title + " (" + f.minutes + "분)"; }).join("\n");
    var L = [
      "당신은 직업훈련 교수설계자입니다. 아래 학습모듈 교재를 바탕으로 (B) 강사용 교수안 단계별 지침" + (withSlides ? "과 (C) 슬라이드 편성" : "") + "을 작성하세요. 교재에 없는 사실을 새로 만들지 않습니다.",
      unitBrief(course, unit), "[학습모듈] " + m.title + " — " + m.minutes + "분",
      "[학습목표]", m.objectives.map(function (o, i) { return (i + 1) + ". " + o; }).join("\n"),
      "[진행 단계]", steps, "",
      "[교재 개요] " + c.overview,
      c.sections.map(function (s, i) { return "[학습내용 " + (i + 1) + "] " + s.title + "\n" + String(s.body || "").slice(0, 4000); }).join("\n\n"), "",
      "[B 교수안 규칙] 진행 단계마다 아래 네 줄을 씁니다. 멘트 예시는 강사가 실제로 말하듯 1~2문장입니다.",
      "**강사 활동**: … / **설명 내용**: … / **멘트 예시**: \"…\" / **학생 활동**: …", ""
    ];
    if (withSlides) L.push("[C 슬라이드 규칙] " + slideRules() + " 학습자를 호칭하지 않습니다. 형식:", SLIDE_FORMAT, "");
    L.push("[출력 형식 — 구분자와 순서를 그대로 지키고 다른 말은 쓰지 않습니다]", "@@교수안@@");
    (m.flow || []).forEach(function (f, i) { L.push("#" + (i + 1), "**강사 활동**: …", "**설명 내용**: …", "**멘트 예시**: \"…\"", "**학생 활동**: …"); });
    if (withSlides) L.push("@@슬라이드@@", "(### 슬라이드 블록들)");
    return L.join("\n");
  }

  /* 학습모듈 하나 작성 후 삽화 자동 생성·능력단위요소 자동 배정(course-auto.js) — onLabel(진행 문구) */
  function generateModule(course, unit, mi, onLabel) {
    // 교재를 새로 쓴 경우에만 — 교재를 유지하고 교수안·슬라이드만 만들 때는 사용자가 지운 삽화를 다시 그리지 않는다
    var fresh = !hasTextbook(unit.modules[mi]);
    // 교재를 유지한 경우에도 아직 한 번도 보강하지 않은 학습모듈이면 삽화·NCS 를 채운다 (학습모듈마다 한 번)
    return writeModule(course, unit, mi).then(function (m) {
      var A = K.courseAuto;
      if (!A) return m;
      if (fresh) return A.afterTextbook(course, unit, m, onLabel).then(function () { return m; });
      return A.needsFill(course, m) ? A.fillModule(course, unit, m, onLabel).then(function () { return m; }) : m;
    });
  }
  function writeModule(course, unit, mi) {
    var m = unit.modules[mi];
    var split = mixed();
    if (hasTextbook(m)) {
      return aicall(lessonPrompt(course, unit, m, !split), { role: "write" }).then(function (text) {
        var s = splitMarkers(String(text || "").replace(/\r\n/g, "\n"));
        var guideRaw = String(s["교수안"] || "");
        var parts = guideRaw.split(/^#\s*\d+\s*$/m);
        m.content.guide = (m.flow || []).map(function (f, i) { return (parts[i + 1] || "").trim(); });
        if (!split) { m.content.slides = s["슬라이드"] || ""; return m; }
        return aicall(slidesPrompt(course, unit, m, m.content), { role: "fast" }).then(function (slides) {
          m.content.slides = String(slides || "").replace(/^```\w*\s*|```\s*$/g, "").trim();
          return m;
        }).catch(function () { return m; });
      }).then(function () {
        m.content.lint = C().lintModule(m);
        K.course.logChange(m, "교수안 지침·슬라이드 생성 (교재 유지)");
        return m;
      });
    }
    return aicall(moduleWritePrompt(course, unit, mi, !split), { role: "write" }).then(function (text) {
      var content = parseModuleWrite(text, m);
      content.by = who("write");
      if (!split) return content;
      return aicall(slidesPrompt(course, unit, m, content), { role: "fast" }).then(function (slides) {
        content.slides = String(slides || "").replace(/^```\w*\s*|```\s*$/g, "").trim();
        content.by = who("write") + " 교재·교수안 + " + who("fast") + " 슬라이드";
        return content;
      }).catch(function () { return content; });
    }).then(function (content) {
      m.content = content;
      content.lint = C().lintModule(m);
      K.course.logChange(m, "AI 교재·교수안 작성 (" + content.by + ")");
      return m;
    });
  }

  /* 단원 산출물 — 차시(1시간)별 교수안·슬라이드 편성안 + 단원 교재 */
  function buildOutputs(course, unit) {
    unit.outputs = C().assembleOutputs(course, unit);
    return unit.outputs;
  }

  /* 학습모듈 교안이 다 됐는지 — 교재와 교수안 지침이 있으면 */
  function moduleDone(m) {
    return hasTextbook(m) && ((m.content && m.content.guide) || []).some(function (g) { return String(g || "").trim(); });
  }
  function isCancel(e) { return !!(e && (e.code === "cancelled" || e.name === "AbortError")); }
  function errText(e) { return (e && e.message) || String(e); }

  /* 단원의 학습모듈마다 교재·교수안·슬라이드 작성 → 차시별 산출물 조립
     한 학습모듈이 실패해도 한 번 다시 시도하고, 그래도 안 되면 건너뛰고 나머지를 계속 만든다(중지는 바로 멈춤).
     opts.onlyMissing: 교안이 다 된 학습모듈은 건너뜀 · opts.label: 진행 문구 앞머리 · opts.onModule(m, err): 학습모듈마다(저장 등)
     결과: {made, failed:[{unit, module, error}]} */
  function generateUnit(course, unit, onProgress, opts) {
    opts = opts || {};
    var prog = onProgress || function () {};
    var total = unit.modules.length;
    var made = 0, filled = 0, failed = [], chain = Promise.resolve();
    var A = K.courseAuto;
    unit.modules.forEach(function (m, mi) {
      chain = chain.then(function () {
        if (opts.onlyMissing && moduleDone(m)) {
          // 이미 교안이 있는 학습모듈: 새 기능(삽화·NCS)만 아직 없으면 채운다
          if (!A || !A.needsFill(course, m)) return;
          var fh = (opts.label || "") + "학습모듈 " + (mi + 1) + "/" + total + " 보강";
          prog(mi, total, fh + " · " + m.title);
          return A.fillModule(course, unit, m, function (l) { prog(mi, total, fh + " · " + l); }).then(function () {
            filled++;
            if (opts.onModule) opts.onModule(m, null);
          }, function (e) {
            if (isCancel(e)) throw e;
            failed.push({ unit: unit.title, module: m.title, error: errText(e) });
          });
        }
        var head = (opts.label || "") + "학습모듈 " + (mi + 1) + "/" + total;
        var once = function () { return generateModule(course, unit, mi, function (l) { prog(mi, total, head + " · " + l); }); };
        prog(mi, total, head + " 작성 중… (" + m.title + " · " + (mixed() ? "Claude 교재 → Gemini 슬라이드" : who("write")) + ")");
        return once().catch(function (e) {
          if (isCancel(e)) throw e;
          prog(mi, total, head + " 다시 시도 중… (" + errText(e).slice(0, 60) + ")");
          return once();
        }).then(function () {
          made++;
          if (opts.onModule) opts.onModule(m, null);
        }, function (e) {
          if (isCancel(e)) throw e;
          failed.push({ unit: unit.title, module: m.title, error: errText(e) });
          if (opts.onModule) opts.onModule(m, e);
        });
      });
    });
    return chain.then(function () {
      prog(total, total, "차시별 교수안·편성안과 교재 조립 중…");
      buildOutputs(course, unit);
      return { made: made, filled: filled, failed: failed };
    });
  }

  /* 교안이 아직 안 된 학습모듈 [{unit, module}] */
  function remainingModules(course) {
    var out = [];
    (course.units || []).forEach(function (u) { (u.modules || []).forEach(function (m) { if (!moduleDone(m)) out.push({ unit: u, module: m }); }); });
    return out;
  }
  /* 과정 전체: 단원마다 남은 학습모듈만 작성 — 중간에 멈춰도 다시 누르면 남은 것부터 이어서 */
  function generateCourse(course, onProgress, opts) {
    opts = opts || {};
    var units = course.units || [], made = 0, filled = 0, failed = [], chain = Promise.resolve();
    var A = K.courseAuto, prog = onProgress || function () {};
    units.forEach(function (u, ui) {
      chain = chain.then(function () {
        var head = "단원 " + (ui + 1) + "/" + units.length + " · ";
        // 기존 단원에 NCS 능력단위가 없으면 먼저 자동 배정 (확정은 사용자가)
        var ncs = A && A.needsUnitNcs(u)
          ? A.assignUnit(course, u, function (l) { prog(0, 1, head + "NCS 능력단위 자동 배정 — " + l); }).catch(function (e) { if (isCancel(e)) throw e; })
          : Promise.resolve();
        return ncs.then(function () {
          var work = u.modules.some(function (m) { return !moduleDone(m) || (A && A.needsFill(course, m)); });
          if (!work) { if (u.outputs) buildOutputs(course, u); return; }
          return generateUnit(course, u, onProgress, { onlyMissing: true, label: head, onModule: opts.onModule })
            .then(function (r) { made += r.made; filled += r.filled; failed = failed.concat(r.failed); });
        });
      });
    });
    return chain.then(function () { return { made: made, filled: filled, failed: failed }; });
  }

  /* ================= 4. 문제은행 ================= */
  /* 유형별 출력 형식 */
  var SHAPES = {
    "객관식": function (multi) {
      return multi
        ? "{\"stem\":\"문항 (끝에 「모두 고르시오」)\",\"choices\":[{\"text\":\"보기\",\"correct\":true}, … 4~5개],\"explanation\":\"각 정답의 근거와 오답 이유\"}  (정답 2개 이상, 오답 1개 이상)"
        : "{\"stem\":\"문항\",\"choices\":[{\"text\":\"보기\",\"correct\":false}, … 4개],\"explanation\":\"정답 근거와 오답 이유\"}  (correct 는 정확히 하나)";
    },
    "단답식": function () { return "{\"stem\":\"단어나 값 하나로 답하는 문항\",\"answer\":\"정답 (단어·값 하나)\",\"accepted\":\"허용 표기(대소문자·띄어쓰기 변형 등)를 쉼표로, 없으면 빈 문자열\",\"explanation\":\"해설\"}"; },
    "서술형": function () { return "{\"stem\":\"줄글로 답하는 문항\",\"answer\":\"모범 답안\",\"rubric\":[{\"criterion\":\"채점 요소\",\"points\":2}, …],\"explanation\":\"해설\"}  (요소별 점수 합계 10점 내외)"; },
    "코드제출": function () { return "{\"stem\":\"요구사항\",\"code\":\"시작 코드(없으면 빈 문자열)\",\"tests\":\"입력/조건 → 기대 출력 형식으로 3개 이상\",\"explanation\":\"해설\"}"; },
    "파일제출": function () { return "{\"stem\":\"요구사항과 제출물 형식\",\"rubric\":[{\"criterion\":\"관찰 가능한 평가 기준\",\"full\":\"충족 조건(점수)\",\"partial\":\"부분 충족 조건(점수)\",\"none\":\"미흡 조건(0점)\",\"points\":3}],\"explanation\":\"채점 시 유의점\"}  (rubric 3~5행)"; }
  };
  /* 문항 자동 검수 기준을 AI 에게 그대로 알려 준다 (lintQuestion 과 같은 기준) */
  function qChecklist(type, multi) {
    var L = ["문항 내용(stem)이 비어 있지 않다.",
      "교재 체크리스트 문장을 그대로 또는 거의 그대로 쓰지 않는다. 구체적인 상황에서의 판단을 묻는다.",
      "버전 의존 정보(Ctrl·Cmd·Alt·Shift+키, '단축키', 2024.1.2 같은 버전 번호, '버전 6')를 쓰지 않는다.",
      "학습자를 '여러분', '당신'으로 부르지 않는다."];
    if (type === "객관식") {
      L.push("보기는 4개 이상이고 서로 다른 문장이다.");
      L.push(multi ? "정답 2개 이상, 오답 1개 이상이며 stem 에 「모두 고르시오」를 밝힌다." : "정답이 될 수 있는 보기는 정확히 하나다.");
    }
    if (type === "단답식") L.push("answer 는 단어나 값 하나다(30자 이내, 3단어 이하, 한 줄).");
    if (type === "서술형") L.push("rubric(채점 요소별 점수)을 반드시 쓴다.");
    if (type === "코드제출") L.push("tests(기대 출력 또는 테스트 케이스)를 반드시 쓴다.");
    if (type === "파일제출") L.push("rubric 을 3~5행 쓰고, 각 행에 관찰 가능한 기준과 충족·부분·미흡 조건과 점수를 쓴다.");
    return L.map(function (x) { return "- " + x; }).join("\n");
  }

  function questionPrompt(course, unit, m, spec) {
    var R = K.courseRules;
    var band = C().BANDS[spec.band];
    var oi = spec.objective - 1;
    var sec = m.content && m.content.sections && m.content.sections[oi];
    var checklist = m.content ? (m.content.checklist || []).map(function (c) { return "- " + (c.text || c); }).join("\n") : "";
    var existing = (m.questions || []).filter(function (q) { return q.objective === spec.objective; })
      .map(function (q) { return "- " + String(q.stem || "").replace(/\s+/g, " ").slice(0, 120); }).join("\n");
    var langs = R.codeLangs(m);
    var tools = (m.tools || []).map(function (t) { return [t.name, t.version].filter(Boolean).join(" "); }).join(", ") || course.tool || "없음";
    var bandHow = spec.band === "L1" ? "학습내용에서 다룬 것과 같은 상황을 묻는다."
      : spec.band === "L2" ? "같은 원리·구조를 학습내용과 다른 상황(다른 대상·도메인·시스템)에 적용하게 한다."
      : "학습내용의 지식으로 해결할 요구사항만 제시하고 풀이 방법은 주지 않는다.";
    return [
      "직업훈련 문제은행 출제자로서 문항을 만듭니다.", "", R.RULES_QB, "",
      "[학습모듈] " + m.title + " (단원: " + unit.title + ")",
      "[대상 학습목표 " + spec.objective + "] " + (m.objectives[oi] || m.title),
      "[대응 학습내용]", sec ? (sec.title || "") + "\n" + String(sec.body || "").slice(0, 6000) : "(교재 미작성 — 학습목표 기준으로 출제)", "",
      checklist ? "[체크리스트 문장 — 이 문장을 그대로 문항으로 쓰지 말 것]\n" + checklist : "",
      existing ? "\n[이미 있는 문항 — 중복 금지]\n" + existing + "\n" : "",
      "[출제 조건]",
      "- 밴드 " + spec.band + " (" + band.name + "): " + bandHow,
      "- 유형: " + spec.type + (spec.multi ? " (복수 정답)" : ""),
      "- 코드: " + (langs.length ? "학습내용에 쓰인 언어(" + langs.join(", ") + ")를 그대로 사용한다."
        : "학습내용에 코드가 없다. 사용 툴(" + tools + ")과 학습내용을 보고 코드가 꼭 필요한 경우에만 쓰고, 그렇지 않으면 코드 없이 출제한다." +
          (spec.type === "코드제출" ? " 코드제출 유형이므로 학습내용과 사용 툴에 맞는 언어 하나를 골라 문항 첫 줄에 언어를 밝힌다." : "")),
      "- " + spec.count + "문항, 서로 다른 상황을 쓴다.", "",
      "[자동 검수 기준 — 출력 전에 모든 문항이 아래를 통과하는지 스스로 확인합니다]", qChecklist(spec.type, spec.multi), "",
      "[출력] JSON 배열 하나만. 각 원소 형식:", SHAPES[spec.type](spec.multi)
    ].join("\n");
  }

  function toQuestion(raw, spec) {
    var Q = C().newQuestion({ objective: spec.objective, band: spec.band, type: spec.type, multi: !!spec.multi });
    Q.stem = String(raw.stem || "").trim();
    Q.code = String(raw.code || raw.starter || "").trim();
    if (spec.type === "객관식") {
      // 공백·중복 보기를 정리하고 정답 표시를 유지한다
      var seen = {};
      Q.choices = (raw.choices || raw.options || []).map(function (c) { return typeof c === "string" ? { text: c, correct: false } : c; })
        .map(function (c) { return { text: String(c.text || "").trim(), correct: !!c.correct }; })
        .filter(function (c) {
          if (!c.text) return false;
          if (seen[c.text] != null) { if (c.correct) Q._dupCorrect = true; return false; }
          seen[c.text] = 1; return true;
        });
      if (Array.isArray(raw.answer) || typeof raw.answer === "number") { // 번호로 온 정답도 받는다
        var nums = [].concat(raw.answer).map(Number);
        Q.choices.forEach(function (c, i) { c.correct = c.correct || nums.indexOf(i + 1) !== -1; });
      }
      delete Q._dupCorrect;
      if (spec.multi && !/모두|전부|있는 대로|복수/.test(Q.stem)) {
        Q.stem = /고르(시오|세요|십시오)\.?$/.test(Q.stem) ? Q.stem.replace(/고르(시오|세요|십시오)(\.?)$/, "모두 고르$1$2") : Q.stem.replace(/\s*$/, "") + " (모두 고르시오)";
      }
    } else {
      Q.choices = [];
    }
    Q.answer = typeof raw.answer === "string" ? raw.answer.trim() : "";
    Q.accepted = Array.isArray(raw.alts) ? raw.alts.join(", ") : String(raw.accepted || "").trim();
    Q.rubric = (raw.rubric || []).filter(function (r) { return r && r.criterion; }).map(function (r) {
      return { criterion: String(r.criterion).trim(), points: Number(r.points) || 0, full: String(r.full || ""), partial: String(r.partial || ""), none: String(r.none || "") };
    });
    if (spec.type === "서술형" && !Q.rubric.length && raw.criteria) Q.rubric = [{ criterion: String(raw.criteria), points: 0 }];
    Q.tests = String(raw.tests || raw.testcases || "").trim();
    Q.explanation = String(raw.explanation || raw.explain || "").trim();
    Q.by = who("qgen");
    return Q;
  }

  /* 검수에 걸린 문항만 한 번 더 고쳐 받기 — 지적이 줄어든 경우에만 바꾼다 */
  function repairQuestions(course, unit, m, qs, spec) {
    var R = K.courseRules;
    var flagged = qs.map(function (q, i) { return { i: i, q: q, issues: R.lintQuestion(q, m) }; }).filter(function (x) { return x.issues.length; });
    if (!flagged.length) return Promise.resolve({ qs: qs, fixed: 0 });
    var payload = flagged.map(function (x) {
      return { no: x.i, question: { stem: x.q.stem, code: x.q.code, choices: x.q.choices, answer: x.q.answer, accepted: x.q.accepted, rubric: x.q.rubric, tests: x.q.tests, explanation: x.q.explanation },
        issues: x.issues.map(function (v) { return v.msg; }) };
    });
    var prompt = [
      "아래 문항들이 자동 검수에서 지적을 받았습니다. 지적을 모두 해결하도록 고쳐 같은 형식으로 다시 씁니다. 지적과 관계없는 부분은 유지합니다.", "",
      R.RULES_QB, "", "[대상 학습목표 " + spec.objective + "] " + (m.objectives[spec.objective - 1] || ""),
      "[체크리스트 문장 — 그대로 쓰지 말 것]", ((m.content && m.content.checklist) || []).map(function (c) { return "- " + (c.text || c); }).join("\n"), "",
      "[자동 검수 기준]", qChecklist(spec.type, spec.multi), "",
      "[고칠 문항과 지적]", JSON.stringify(payload, null, 1).slice(0, 30000), "",
      "[출력] JSON 배열 하나만. 각 원소는 {\"no\": 위의 no, ...문항 필드} 형식이며 문항 필드는 다음과 같습니다.", SHAPES[spec.type](spec.multi)
    ].join("\n");
    return aicall(prompt, { role: "qgen" }).then(ai().parseJson).then(function (arr) {
      var fixed = 0;
      (Array.isArray(arr) ? arr : (arr && arr.items) || []).forEach(function (r) {
        var k = flagged.filter(function (x) { return x.i === Number(r.no); })[0];
        if (!k) return;
        var nq = toQuestion(r, spec);
        nq.id = k.q.id;
        var ni = R.lintQuestion(nq, m);
        var badBefore = k.issues.some(function (v) { return v.sev === "bad"; }), badAfter = ni.some(function (v) { return v.sev === "bad"; });
        if (ni.length < k.issues.length || (badBefore && !badAfter)) { qs[k.i] = nq; fixed++; }
      });
      return { qs: qs, fixed: fixed };
    }).catch(function (e) { if (e && e.code === "cancelled") throw e; return { qs: qs, fixed: 0 }; });
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
    return aicall(prompt, { role: "review" }).then(ai().parseJson).then(function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (r) {
        var q = qs[Number(r.i)];
        if (q) q.review = { by: who("review"), ok: r.ok !== false, notes: String(r.notes || "").trim() };
      });
      return qs;
    }).catch(function (e) { if (e && e.code === "cancelled") throw e; return qs; });
  }

  /* 결과: 문항 배열 (qs.fixed = 자동으로 고친 문항 수) */
  function generateQuestions(course, unit, mi, spec) {
    var m = unit.modules[mi];
    var fixed = 0;
    return aicall(questionPrompt(course, unit, m, spec), { role: "qgen" }).then(ai().parseJson).then(function (arr) {
      if (!Array.isArray(arr)) arr = (arr && (arr.questions || arr.items)) || [];
      var qs = arr.slice(0, spec.count).map(function (r) { return toQuestion(r, spec); }).filter(function (q) { return q.stem; });
      if (!qs.length) throw new Error("문항 생성 응답이 비어 있어요. 다시 시도해 주세요.");
      return repairQuestions(course, unit, m, qs, spec);
    }).then(function (r) {
      fixed = r.fixed;
      // 혼합 모드: 생성한 모델과 다른 모델이 교차 검수한다
      return mixed() ? reviewQuestions(course, unit, m, r.qs) : r.qs;
    }).then(function (qs) { qs.fixed = fixed; return qs; });
  }

  K.courseAI = {
    setCallContext: setCallContext, aicall: aicall,
    planCourse: planCourse, planUnit: planUnit, recommendNcs: recommendNcs,
    generateUnit: generateUnit, generateModule: generateModule, buildOutputs: buildOutputs, hasTextbook: hasTextbook,
    generateCourse: generateCourse, remainingModules: remainingModules, moduleDone: moduleDone,
    generateQuestions: generateQuestions, reviewQuestions: reviewQuestions, toQuestion: toQuestion,
    _parseModuleWrite: parseModuleWrite, _splitMarkers: splitMarkers
  };
})();
