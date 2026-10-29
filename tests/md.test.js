/* md.test.js — 입력칸 마크다운 미리 보기 렌더러 (md-render.js)
 *
 *   안전성(HTML·스크립트·위험 링크는 글자로) · 제목·서식 · 중첩 목록 · 체크 · 표 · 코드 블록 · 인용 · 프론트매터
 *
 * 실행:  node tests/md.test.js   (성공 exit 0, 실패 exit 1)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
const failures = [];
function ok(cond, msg) { if (cond) passed++; else failures.push(msg); }

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "md-render.js"), "utf8"), ctx, { filename: "md-render.js" });
const R = ctx.KBuilder.renderMarkdown;

/* 안전성 */
const xss = R('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n[클릭](javascript:alert(1))\n![x](javascript:alert(1))');
ok(xss.indexOf("<script") === -1 && xss.indexOf("&lt;script&gt;") !== -1, "HTML 태그는 글자로 보임");
ok(!/<img[^>]*onerror/i.test(xss), "입력한 img 태그·이벤트 속성은 실행되지 않음");
ok(!/href="javascript/i.test(xss) && !/<a /.test(xss), "javascript: 링크는 만들지 않음");
ok(!/<img /.test(xss), "위험한 이미지 주소는 그리지 않음");
ok(R('[a](https://x.com/"onmouseover="y)').indexOf('"onmouseover') === -1, "링크 주소의 따옴표로 속성을 깨지 못함");

/* 제목·서식 */
const t = R("# 큰 제목\n## 둘째\n본문 **굵게** *기울임* ~~취소~~ `a < b` [링크](https://example.com)");
ok(/<h1>큰 제목<\/h1>/.test(t) && /<h2>둘째<\/h2>/.test(t), "제목 h1·h2");
ok(/<strong>굵게<\/strong>/.test(t) && /<em>기울임<\/em>/.test(t) && /<del>취소<\/del>/.test(t), "굵게·기울임·취소선");
ok(/<code>a &lt; b<\/code>/.test(t), "인라인 코드는 이스케이프된 글자로");
ok(/<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">링크<\/a>/.test(t), "https 링크");
ok(/<code>\*\*x\*\*<\/code>/.test(R("`**x**`")), "코드 안의 문법은 그대로 글자");

/* 입력칸 예시(하위 주제 목록) — 들여쓴 '*' 는 중첩 목록 */
const list = R("* 주제 입력: 생성형 AI와 UGC 산업의 이해\n   * 생성형 AI의 종류\n   * LLM의 동작 원리\n* 다음");
ok(/^<ul><li>주제 입력: 생성형 AI와 UGC 산업의 이해<ul><li>생성형 AI의 종류<\/li><li>LLM의 동작 원리<\/li><\/ul><\/li><li>다음<\/li><\/ul>$/.test(list), "들여쓰기로 중첩 목록");
ok(/<ol><li>a<\/li><li>b<\/li><\/ol>/.test(R("1. a\n2. b")), "번호 목록");
ok(/<ol start="3">/.test(R("3. c\n4. d")), "번호 목록 시작 번호");
ok(/<li class="md-task"><input type="checkbox" disabled checked> 끝남/.test(R("- [x] 끝남\n- [ ] 남음")), "체크 목록");

/* 표·코드 블록·인용·구분선 */
const tb = R("| 항목 | 내용 |\n|---|:---:|\n| 시간 | **60분** |");
ok(/<table><thead><tr><th>항목<\/th><th>내용<\/th><\/tr><\/thead><tbody><tr><td>시간<\/td><td><strong>60분<\/strong><\/td><\/tr><\/tbody><\/table>/.test(tb), "표");
const code = R("```js\nconst a = '<b>';\n```");
ok(/<pre><code data-lang="js">const a = &#39;&lt;b&gt;&#39;;<\/code><\/pre>/.test(code), "코드 블록(언어 표시·이스케이프)");
ok(/<blockquote><p>인용 <strong>문장<\/strong><\/p><\/blockquote>/.test(R("> 인용 **문장**")), "인용");
ok(/<hr>/.test(R("앞\n\n---\n\n뒤")), "구분선");
ok(/<p>첫 줄<br>둘째 줄<\/p>/.test(R("첫 줄\n둘째 줄")), "문단 안 줄바꿈 유지");

/* 프론트매터 */
const fm = R("---\n교과목: 게임 기획\nstatus: 초안\n---\n# 제목");
ok(/^<div class="md-front"><span><b>교과목<\/b> 게임 기획<\/span><span><b>status<\/b> 초안<\/span><\/div><h1>제목<\/h1>$/.test(fm), "프론트매터는 정보 칩으로");
ok(/<img src="data:image\/png;base64,AAAA" alt="그림" loading="lazy">/.test(R("![그림](data:image/png;base64,AAAA)")), "붙여넣은 data:image 그림");

console.log(`md.test.js: ${passed} 통과, ${failures.length} 실패`);
if (failures.length) { failures.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
