/* course-rules.js — 「콘텐츠 업무 설계」 5·6장 검수 규칙 (순수 로직 · DOM 불필요)
 *   lintTextbook(module)  : 교재 자동 검수 → [{sev:"bad"|"warn", where, msg, snip}]
 *   lintQuestion(q, module): 문항 자동 검수 → [{sev, msg}]
 *   RULES_TB / RULES_QB   : AI 프롬프트에 그대로 넣는 규칙 원문
 *   RULE_LIST / MANUAL_RULES / Q_RULE_LIST : 화면의 '검사 규칙 목록'·'수동 검수'
 *   wordDiff(a, b)        : 단어 단위 변경 표시(HTML) — 미리보기에서 사용
 *
 * 모듈 형식: { objectives:[문장], content:{ overview, sections:[{title, body}], checklist:[{text, ref}] } }
 * 문항 형식: { objective(1부터), band, type, multi, stem, choices:[{text, correct}], answer, accepted, rubric:[…], tests, … }
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});

  /* 기존 교안 양식 — 학습내용 본문을 소주제(##)와 글머리 문장으로 (기관에서 쓰던 교안 형식) */
  var LESSON_STYLE = "13. 학습내용 본문은 기존 교안 양식으로 쓴다: 소주제마다 \"## 소주제\" 줄을 두고 그 아래에 \"- \"로 시작하는 글머리 문장을 3~6줄 쓴다(한 줄에 한 문장, \"~니다.\"로 끝남). " +
    "분류·대조는 \"**이름**\" 굵은 줄 다음 글머리나 표(| 구분 | 내용 |)로, 절차는 \"1. \" 번호 목록으로, 꼭 기억할 문구는 \"> \" 인용으로 쓴다. 긴 줄글 문단은 쓰지 않는다. 소주제는 2~4개이고 덩어리 제목을 소주제로 되풀이하지 않는다.";
  var RULES_TB = [
    "[교재 작성 규칙 — 콘텐츠 업무 설계]",
    "1. 교재는 무엇을 배울지를 지정한다. 어떻게 가르칠지(수업 진행, 강사 활동)는 교안의 몫이므로 쓰지 않는다.",
    "2. 구성 순서는 개요 → 학습목표 → 학습내용 → 학습 후 체크리스트로 고정한다.",
    "3. 개요: 이 학습모듈을 왜 배우는지 제시한다. 어떤 문제 상황이 있는지 / 무엇을 해결해야 하는지 / 학습 후 무엇이 가능해지는지를 담는다. 문제는 과정의 흐름이 아니라 도메인의 상황으로 서술한다. (\"앞에서 만든 기능이 느려져서\" (X) → \"요청마다 새 연결을 여는 구조에서는\" (O))",
    "4. 학습목표: \"~할 수 있다\"로 끝낸다. \"이해한다·안다·익힌다\"는 쓰지 않는다. 관찰 가능한 행동으로 끝내고 수행의 조건과 제약을 포함한다. 3개 이하.",
    "5. 학습내용: 각 덩어리는 학습목표 하나에 1:1로 대응한다(목표 N개 → 내용 N덩어리, 같은 순서). 어느 목표에도 속하지 않는 내용은 넣지 않는다.",
    "6. 버전에 의존하는 정보(툴 버전 번호, 단축키, 메뉴·UI 위치)를 본문에 흩지 않는다. 기준 버전은 메타데이터가 관리한다.",
    "7. 학습 후 체크리스트: 학습자가 스스로 확인하는 목록이다. 학습목표와 1:1(N개). 각 항목에 이해가 부족할 때 다시 볼 학습내용 위치(예: \"학습내용 2\")를 적는다.",
    "8. 다른 학습모듈이나 과정을 지칭하지 않는다. \"앞에서 배운\", \"앞서\", \"이전 시간\", \"다음 모듈\" 같은 표현을 쓰지 않는다.",
    "9. 어투: 경어체. 종결은 \"~합니다 / ~하지 않습니다\"로 통일한다(학습목표 문장만 \"~할 수 있다\"). 학습자를 호칭하지 않는다(\"여러분\", \"당신\", \"우리\" 금지, 주어 없이 동작만 서술).",
    "10. 지시 강도는 어미로 구분한다. 규칙 \"~해야 합니다 / ~하지 않습니다\", 권장 \"~하는 것이 좋습니다 / 권장합니다\", 설명 \"~입니다 / ~합니다\".",
    "11. 모호한 표현 금지: \"경우에 따라 다릅니다\", \"상황에 맞게\"(판단 기준을 명시), \"매우/아주/굉장히\"(정도는 수치로), \"당연히/물론/쉽게\".",
    "12. [자동 검수 — 출력 전에 확인] 코드 블록 밖의 본문(개요·학습내용·체크리스트)에 다음 표현이 하나도 없어야 한다: 여러분, 당신, 우리는/우리가/우리를, 앞에서, 앞서, 이전 시간·모듈·차시·장, 지난 시간, 다음 시간·모듈·차시·장에, 경우에 따라, 상황에 맞게, 매우, 아주, 굉장히, 당연히, 물론, 쉽게, 단축키, Ctrl+·Cmd+·Alt+·Shift+ 키 조합, 버전 번호, 강사는, 교수자는, 시연합니다, 수업에서는. 모든 문장은 \"~니다.\"로 끝나고 \"~다.\"로 끝나는 평서문을 쓰지 않는다(학습목표만 \"~할 수 있다.\"). 학습목표 문장은 조건·제약을 담아 18자 이상으로 쓴다. 체크리스트마다 다시 볼 곳(ref)을 채운다.",
    LESSON_STYLE
  ].join("\n");

  var RULES_QB = [
    "[문제은행 규칙 — 콘텐츠 업무 설계]",
    "- 모든 문항은 두 태그를 가진다: 어느 학습목표를 묻는가(objective), 어느 밴드인가(band).",
    "- 밴드: L1 수업에서 다뤘던 것과 동일한 상황(객관식·단답식) / L2 같은 구조를 다른 맥락에 적용(서술형·코드제출) / L3 수업 내용으로 요구사항만 제시(파일제출) / L4는 프로젝트에서 다루므로 문제은행에 만들지 않는다.",
    "- 객관식은 정답이 확정되도록 출제한다(보기 4~5개). 단일 선택은 정답 1개, 복수 정답은 정답 2개 이상과 오답 1개 이상이며 문항에 「모두 고르시오」를 밝힌다.",
    "- 단답식은 단어나 값 하나로 답하는 문항이다. 해석에 따라 정오가 갈리지 않도록 정답이 하나로 확정되게 출제하고, 정답과 허용 표기(대소문자·띄어쓰기 등)를 함께 쓴다. 문장이나 코드 여러 줄을 쓰게 하는 문항은 단답식이 아니다.",
    "- 서술형은 줄글로 답하는 문항이다. 채점 기준을 요소별 점수로 함께 작성하고, 답변이 각 요소를 충족할 때마다 점수를 더하는 방식으로 쓴다.",
    "- 코드제출은 기대 출력 또는 테스트 케이스를 함께 작성한다.",
    "- 파일제출은 채점 루브릭을 구성한다. 채점자에 따른 편차를 줄이도록 관찰 가능한 기준과 충족·부분·미흡 조건, 점수를 쓴다.",
    "- 교재의 체크리스트 문장을 그대로 문항으로 쓰지 않는다. 체크리스트는 설명 가능 여부를, 문항은 구체적 상황에서의 판단을 묻는다.",
    "- 버전에 의존하는 정보(툴 버전 번호, 단축키, 메뉴 위치)를 문항에 담지 않는다.",
    "- 문항 문장은 경어체로 쓰고 학습자를 호칭하지 않는다."
  ].join("\n");

  /* ---------- 교재 검수 ---------- */
  var FORBID = [
    { re: /여러분|당신|우리(?=[는가를의도와])/g, sev: "warn", msg: "학습자를 호칭하지 않습니다. 주어 없이 동작만 서술합니다." },
    { re: /앞에서|앞서|이전 (?:시간|모듈|차시|장)|지난 시간|다음 (?:시간|모듈|차시|장)에/g, sev: "bad", msg: "다른 학습모듈·과정을 지칭하지 않습니다. 도메인 상황으로 서술합니다." },
    { re: /경우에 따라 다릅니다|경우에 따라 달라|상황에 맞게/g, sev: "warn", msg: "판단 기준을 명시하거나 문장을 삭제합니다." },
    { re: /매우|아주|굉장히/g, sev: "warn", msg: "정도는 수치로 씁니다." },
    { re: /당연히|물론|쉽게/g, sev: "warn", msg: "학습자에게 당연하지 않은 표현입니다. 삭제합니다." },
    { re: /(?:Ctrl|Cmd|Alt|Shift)\s*\+\s*\w|단축키|20\d\d\.\d+\.\d+|버전\s*\d/gi, sev: "warn", msg: "버전 의존 정보는 메타데이터(사용 툴과 버전)로 옮깁니다." },
    { re: /강사는|교수자는|시연(?:한다|합니다)|수업에서는/g, sev: "warn", msg: "어떻게 가르칠지는 교안의 몫입니다. 교재는 무엇을 배울지만 씁니다." }
  ];
  var BANNED_OBJ = /이해한다|이해할 수|안다(?=[.\s]|$)|알 수 있다|익힌다|익힐 수/;

  /* 코드 블록·인라인 코드는 검사하지 않는다 */
  function plain(s) { return String(s || "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " "); }
  function ctx(s, i, l) { return "…" + s.slice(Math.max(0, i - 14), i + l + 10).replace(/\s+/g, " ") + "…"; }

  function scanText(where, txt, out) {
    var p = plain(txt);
    FORBID.forEach(function (r) {
      r.re.lastIndex = 0;
      var m, seen = {};
      while ((m = r.re.exec(p))) {
        if (seen[m[0]]) continue;
        seen[m[0]] = 1;
        out.push({ sev: r.sev, where: where, msg: r.msg, snip: ctx(p, m.index, m[0].length) });
      }
    });
    var re = /([가-힣])다\.(?=\s|$)/g, m2;
    while ((m2 = re.exec(p))) {
      if (m2[1] !== "니") { out.push({ sev: "warn", where: where, msg: "경어체(~합니다)로 종결합니다.", snip: ctx(p, m2.index, 3) }); break; }
    }
  }

  function lintTextbook(mod) {
    var I = [];
    var objs = (mod && mod.objectives) || [];
    var c = (mod && mod.content) || {};
    var sections = c.sections || [], checklist = c.checklist || [];
    var n = objs.length;
    if (!n) I.push({ sev: "bad", where: "학습목표", msg: "학습목표가 없습니다." });
    if (n > 3) I.push({ sev: "warn", where: "학습목표", msg: n + "개입니다. 4개 이상이면 학습모듈 분할을 검토합니다." });
    objs.forEach(function (o, i) {
      var t = String(o || "").trim(), w = "학습목표 " + (i + 1);
      if (!t) { I.push({ sev: "bad", where: w, msg: "비어 있습니다." }); return; }
      if (!/수 있다\.?$/.test(t)) I.push({ sev: "bad", where: w, msg: "\"~할 수 있다\"로 끝냅니다.", snip: t.slice(-20) });
      if (BANNED_OBJ.test(t)) I.push({ sev: "bad", where: w, msg: "\"이해한다·안다·익힌다\"는 관찰할 수 없습니다. 행동으로 바꿉니다.", snip: t });
      if (t.length < 18) I.push({ sev: "warn", where: w, msg: "수행의 조건과 제약이 빠졌을 수 있습니다." });
    });
    if (!mod || !mod.content) return I; // 교재를 아직 쓰지 않았으면 목표 규칙만
    if (sections.length !== n) I.push({ sev: "bad", where: "학습내용", msg: "학습목표 " + n + "개, 학습내용 " + sections.length + "덩어리입니다. 1:1로 맞춥니다." });
    if (checklist.length !== n) I.push({ sev: "bad", where: "체크리스트", msg: "학습목표 " + n + "개, 체크리스트 " + checklist.length + "항목입니다. 1:1로 맞춥니다." });
    checklist.forEach(function (k, i) {
      if (!String(k.ref || "").trim()) I.push({ sev: "warn", where: "체크리스트 " + (i + 1), msg: "다시 볼 학습내용 위치를 적습니다." });
    });
    if (!String(c.overview || "").trim()) I.push({ sev: "bad", where: "개요", msg: "개요가 없습니다." });
    scanText("개요", c.overview, I);
    sections.forEach(function (s, i) { scanText("학습내용 " + (i + 1), (s.title || "") + "\n" + (s.body || ""), I); });
    checklist.forEach(function (k, i) { scanText("체크리스트 " + (i + 1), k.text, I); });
    return I;
  }

  /* ---------- 문항 검수 ---------- */
  function bigrams(s) {
    var t = String(s || "").replace(/\s+/g, ""), b = {};
    for (var i = 0; i < t.length - 1; i++) b[t.slice(i, i + 2)] = 1;
    return b;
  }
  function sim(a, b) {
    var A = bigrams(a), B = bigrams(b), ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var n = 0;
    ka.forEach(function (x) { if (B[x]) n++; });
    return n / (ka.length + kb.length - n);
  }
  var BAND_TYPES = { L1: ["객관식", "단답식"], L2: ["서술형", "코드제출"], L3: ["파일제출"] };

  function lintQuestion(q, mod) {
    var I = [];
    var nObj = mod && mod.objectives ? mod.objectives.length : 0;
    var stem = String(q.stem || "");
    if (!stem.trim()) I.push({ sev: "bad", msg: "문항 내용이 없습니다." });
    if (!BAND_TYPES[q.band]) I.push({ sev: "bad", msg: "밴드 태그(L1~L3)가 없습니다." });
    else if (BAND_TYPES[q.band].indexOf(q.type) === -1) I.push({ sev: "bad", msg: q.band + " 밴드에는 " + BAND_TYPES[q.band].join("·") + " 유형을 씁니다." });
    if (q.type === "객관식") {
      var opts = (q.choices || []).map(function (c) { return String(c.text || "").trim(); });
      var A = (q.choices || []).filter(function (c) { return c.correct; }).length;
      if (opts.length < 4) I.push({ sev: "warn", msg: "보기가 4개 미만입니다." });
      if (opts.some(function (t) { return !t; })) I.push({ sev: "bad", msg: "빈 보기가 있습니다." });
      if (!A) I.push({ sev: "bad", msg: "정답 번호가 없습니다." });
      if (q.multi) {
        if (A === 1) I.push({ sev: "warn", msg: "복수 정답 문항인데 정답이 하나입니다. 단일 선택으로 바꾸거나 정답을 추가합니다." });
        if (A && A >= opts.length) I.push({ sev: "bad", msg: "모든 보기가 정답입니다. 오답 보기를 포함합니다." });
        if (!/모두|전부|있는 대로|복수/.test(stem)) I.push({ sev: "warn", msg: "문항에 「모두 고르시오」처럼 복수 선택임을 밝힙니다." });
      } else if (A > 1) I.push({ sev: "bad", msg: "단일 선택 문항에 정답이 여러 개입니다." });
      var uniq = {};
      opts.filter(Boolean).forEach(function (t) { uniq[t] = 1; });
      if (Object.keys(uniq).length !== opts.filter(Boolean).length) I.push({ sev: "bad", msg: "같은 보기가 있습니다." });
    }
    if (q.type === "단답식") {
      var a = String(q.answer || "").trim();
      if (!a) I.push({ sev: "bad", msg: "정답이 없습니다." });
      else if (a.length > 30 || a.split(/\s+/).length > 3 || /\n/.test(a)) I.push({ sev: "warn", msg: "정답이 단어·값 하나로 확정되는지 확인합니다. 줄글 답이면 서술형(L2)으로 만듭니다." });
    }
    var rub = (q.rubric || []).filter(function (r) { return String(r.criterion || "").trim(); });
    if (q.type === "서술형") {
      if (!rub.length && !String(q.criteria || "").trim()) I.push({ sev: "bad", msg: "채점 기준이 없습니다." });
      else if (rub.length && rub.some(function (r) { return !(Number(r.points) > 0); })) I.push({ sev: "warn", msg: "채점 요소마다 점수를 적습니다." });
    }
    if (q.type === "코드제출" && !String(q.tests || "").trim()) I.push({ sev: "bad", msg: "기대 출력 또는 테스트 케이스가 없습니다." });
    if (q.type === "파일제출" && !rub.length) I.push({ sev: "bad", msg: "채점 루브릭이 없습니다." });
    var cks = ((mod && mod.content && mod.content.checklist) || []).map(function (c) { return c.text || c; });
    var mx = 0;
    cks.forEach(function (c) { mx = Math.max(mx, sim(c, stem)); });
    if (mx > 0.55) I.push({ sev: "bad", msg: "체크리스트 문장과 거의 같습니다. 구체적 상황에서의 판단을 묻도록 바꿉니다." });
    var optText = (q.choices || []).map(function (c) { return c.text; }).join(" ");
    if (/(?:Ctrl|Cmd|Alt|Shift)\s*\+|단축키|20\d\d\.\d+\.\d+|버전\s*\d/i.test(stem + " " + optText)) I.push({ sev: "warn", msg: "버전 의존 정보가 들어 있습니다." });
    if (/여러분|당신/.test(stem)) I.push({ sev: "warn", msg: "학습자를 호칭하지 않습니다." });
    if (q.objective == null || q.objective < 1 || (nObj && q.objective > nObj)) I.push({ sev: "bad", msg: "대응하는 학습목표가 없습니다." });
    if (q.review && q.review.ok === false) I.push({ sev: "warn", msg: "AI 교차 검수: " + (q.review.notes || "수정 필요") });
    return I;
  }

  /* ---------- 화면용 규칙 목록 ---------- */
  var RULE_LIST = [
    { sev: "bad", area: "개요", rule: "개요를 작성합니다.", desc: "이 학습모듈을 왜 배우는지 제시합니다. 문제 상황, 해결할 일, 학습 후 가능해지는 일을 담습니다." },
    { sev: "bad", area: "학습목표", rule: "학습목표를 1개 이상 작성합니다.", desc: "교재는 학습목표로 시작해 그 목표를 확인하며 끝납니다. 빈 목표 칸은 남기지 않습니다." },
    { sev: "bad", area: "학습목표", rule: "학습목표는 「~할 수 있다」로 끝냅니다.", desc: "학습 후 할 수 있게 되는 행동을 선언하는 형식입니다." },
    { sev: "bad", area: "학습목표", rule: "학습목표는 관찰 가능한 행동으로 씁니다.", desc: "이해·앎·익힘은 밖에서 확인할 수 없습니다. 구현한다, 측정한다, 비교한다처럼 결과를 보고 판정할 수 있는 동사를 씁니다." },
    { sev: "bad", area: "1:1 대응", rule: "학습내용은 학습목표와 같은 수로 작성합니다.", desc: "학습내용의 각 덩어리는 학습목표 하나에 대응합니다. 목표가 3개면 내용도 3덩어리입니다." },
    { sev: "bad", area: "1:1 대응", rule: "체크리스트는 학습목표와 같은 수로 작성합니다.", desc: "체크리스트 항목은 학습목표를 하나씩 스스로 확인하는 문장입니다." },
    { sev: "bad", area: "재사용성", rule: "다른 학습모듈과 과정을 지칭하지 않습니다.", desc: "다른 교과목에서도 그대로 쓸 수 있도록 문제를 도메인 상황으로 서술합니다." },
    { sev: "warn", area: "학습목표", rule: "학습목표는 3개 이하로 작성합니다.", desc: "목표가 4개 이상이면 한 학습모듈이 다루는 범위가 넓은 것입니다. 모듈 분할을 검토합니다." },
    { sev: "warn", area: "학습목표", rule: "학습목표에 수행 조건과 제약을 포함합니다.", desc: "어떤 상황에서, 무엇을 써서, 어느 수준까지 하는지를 함께 적습니다." },
    { sev: "warn", area: "체크리스트", rule: "체크리스트에 다시 볼 학습내용 위치를 적습니다.", desc: "이해가 부족할 때 돌아갈 곳을 알려 줍니다. 예: 「학습내용 2」" },
    { sev: "warn", area: "어투", rule: "학습자를 호칭하지 않습니다.", desc: "주어 없이 동작만 서술합니다." },
    { sev: "warn", area: "어투", rule: "경어체로 종결합니다.", desc: "「~합니다 / ~하지 않습니다」로 끝냅니다. 학습목표만 「~할 수 있다」를 씁니다." },
    { sev: "warn", area: "모호한 표현", rule: "판단 기준을 명시합니다.", desc: "「경우에 따라」, 「상황에 맞게」 대신 어떤 조건에서 무엇을 선택하는지 적습니다." },
    { sev: "warn", area: "모호한 표현", rule: "정도는 수치로 씁니다.", desc: "「매우 느리다」 대신 「응답 시간이 2배로 늘어난다」처럼 씁니다." },
    { sev: "warn", area: "모호한 표현", rule: "당연하다는 표현을 쓰지 않습니다.", desc: "「당연히」, 「물론」, 「쉽게」는 모르는 학습자를 자책하게 만듭니다." },
    { sev: "warn", area: "버전 의존", rule: "버전에 의존하는 정보를 본문에 쓰지 않습니다.", desc: "툴 버전, 단축키, 메뉴 위치는 메타데이터의 사용 툴과 버전이 관리합니다." },
    { sev: "warn", area: "교재/교안", rule: "가르치는 방법은 쓰지 않습니다.", desc: "교재는 무엇을 배울지 지정하고, 어떻게 가르칠지는 교안(교수안)에서 설계합니다." }
  ];
  var MANUAL_RULES = [
    { key: "domain", text: "개요의 문제 상황을 과정 흐름이 아니라 도메인 상황으로 서술했다", hint: "「앞에서 만든 기능이 느려져서」가 아니라 「요청마다 새 연결을 여는 구조에서는」" },
    { key: "strength", text: "지시 강도를 어미로 구분했다", hint: "규칙 「~해야 합니다」 · 권장 「~하는 것이 좋습니다」 · 설명 「~입니다」" },
    { key: "mapping", text: "각 학습내용 덩어리가 실제로 해당 학습목표를 다루고, 어느 목표에도 속하지 않는 내용이 없다", hint: "목표와 무관한 배경 설명·잡담이 섞였는지 확인" },
    { key: "version", text: "메뉴·UI 위치처럼 키워드로 드러나지 않는 버전 의존 정보가 없다", hint: "「상단 Window 메뉴의 세 번째 항목」 같은 위치 설명" }
  ];
  var Q_RULE_LIST = [
    { group: "공통", sev: "bad", rule: "문항 내용을 작성합니다.", desc: "비어 있는 문항은 출제할 수 없습니다." },
    { group: "공통", sev: "bad", rule: "학습목표에 연결합니다.", desc: "어느 목표를 묻는지 알아야 오답률이 높을 때 무너진 목표를 찾을 수 있습니다." },
    { group: "공통", sev: "bad", rule: "밴드에 맞는 유형을 씁니다.", desc: "L1 객관식·단답식 / L2 서술형·코드제출 / L3 파일제출." },
    { group: "공통", sev: "bad", rule: "체크리스트 문장을 그대로 쓰지 않습니다.", desc: "체크리스트는 설명할 수 있는지를, 문항은 구체적인 상황에서의 판단을 묻습니다." },
    { group: "공통", sev: "warn", rule: "버전에 의존하는 정보를 쓰지 않습니다.", desc: "단축키나 버전 번호가 들어가면 툴 버전이 바뀔 때마다 문항을 고쳐야 합니다." },
    { group: "공통", sev: "warn", rule: "학습자를 호칭하지 않습니다.", desc: "「여러분」, 「당신」 없이 상황과 요구만 씁니다." },
    { group: "객관식", sev: "bad", rule: "정답을 지정합니다.", desc: "정답이 비어 있으면 채점할 수 없습니다." },
    { group: "객관식", sev: "bad", rule: "같은 보기를 두지 않습니다.", desc: "내용이 같은 보기가 있으면 정답이 하나로 확정되지 않습니다." },
    { group: "객관식", sev: "warn", rule: "보기를 4개 이상 둡니다.", desc: "보기가 적으면 찍어서 맞힐 확률이 높아져 변별이 어렵습니다." },
    { group: "객관식", sev: "bad", rule: "단일 선택은 정답을 하나만 둡니다.", desc: "정답이 여럿이면 복수 정답으로 바꿉니다." },
    { group: "객관식", sev: "bad", rule: "복수 정답은 오답 보기를 하나 이상 둡니다.", desc: "모든 보기가 정답이면 판단을 묻지 못합니다." },
    { group: "객관식", sev: "warn", rule: "복수 정답은 정답을 2개 이상 둡니다.", desc: "정답이 하나뿐이면 단일 선택으로 바꿉니다." },
    { group: "객관식", sev: "warn", rule: "복수 정답임을 문항에 밝힙니다.", desc: "문항 끝에 「모두 고르시오」를 붙입니다." },
    { group: "단답식", sev: "bad", rule: "정답을 작성합니다.", desc: "정답과 함께 대소문자·띄어쓰기 같은 허용 표기를 적어 둡니다." },
    { group: "단답식", sev: "warn", rule: "정답은 단어나 값 하나로 씁니다.", desc: "30자·3단어 이내, 한 줄로 확정되는 답이어야 합니다." },
    { group: "서술형", sev: "bad", rule: "채점 기준을 작성합니다.", desc: "요소별 점수로 적고, 답변이 각 요소를 충족할 때마다 점수를 더합니다." },
    { group: "코드제출", sev: "bad", rule: "기대 출력이나 테스트 케이스를 작성합니다.", desc: "입력·조건과 기대 출력을 함께 적어야 채점자 없이도 정오를 가릴 수 있습니다." },
    { group: "파일제출", sev: "bad", rule: "채점 루브릭을 작성합니다.", desc: "관찰 가능한 기준과 충족·부분·미흡 조건을 점수와 함께 적습니다." }
  ];

  /* ---------- 단어 단위 diff (LCS) ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function wordDiff(a, b) {
    var A = String(a || "").split(/(\s+)/), B = String(b || "").split(/(\s+)/);
    if (A.length * B.length > 4e6) return "<del>" + esc(a) + "</del><ins>" + esc(b) + "</ins>";
    var n = A.length, m = B.length, L = [];
    for (var x = 0; x <= n; x++) L.push(new Uint16Array(m + 1));
    for (var i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var p = 0, q = 0, out = "", del = "", ins = "";
    function flush() { if (del) out += "<del>" + esc(del) + "</del>"; if (ins) out += "<ins>" + esc(ins) + "</ins>"; del = ins = ""; }
    while (p < n && q < m) {
      if (A[p] === B[q]) { flush(); out += esc(A[p]); p++; q++; }
      else if (L[p + 1][q] >= L[p][q + 1]) del += A[p++]; else ins += B[q++];
    }
    while (p < n) del += A[p++];
    while (q < m) ins += B[q++];
    flush();
    return out;
  }

  /* 학습내용 코드 블록에서 언어 추출 (```python → Python) */
  var LANG_NAMES = { cs: "C#", csharp: "C#", "c#": "C#", cpp: "C++", "c++": "C++", c: "C", py: "Python", python: "Python", js: "JavaScript", javascript: "JavaScript",
    ts: "TypeScript", typescript: "TypeScript", lua: "Lua", java: "Java", kotlin: "Kotlin", swift: "Swift", go: "Go", rust: "Rust", sql: "SQL", json: "JSON",
    yaml: "YAML", bash: "Bash", sh: "Bash", powershell: "PowerShell", html: "HTML", css: "CSS", mlua: "mLua", gdscript: "GDScript" };
  function codeLangs(mod) {
    var out = {};
    ((mod && mod.content && mod.content.sections) || []).forEach(function (s) {
      var re = /^[ \t]*```[ \t]*([\w#+.-]*)[ \t]*$/gm, m;
      while ((m = re.exec(String(s.body || "")))) { if (m[1]) out[LANG_NAMES[m[1].toLowerCase()] || m[1]] = 1; }
    });
    return Object.keys(out);
  }

  K.courseRules = {
    RULES_TB: RULES_TB, RULES_QB: RULES_QB, FORBID: FORBID, LESSON_STYLE: LESSON_STYLE,
    RULE_LIST: RULE_LIST, MANUAL_RULES: MANUAL_RULES, Q_RULE_LIST: Q_RULE_LIST, BAND_TYPES: BAND_TYPES,
    lintTextbook: lintTextbook, lintQuestion: lintQuestion, scanText: scanText, plain: plain,
    sim: sim, wordDiff: wordDiff, codeLangs: codeLangs, esc: esc
  };
})();
