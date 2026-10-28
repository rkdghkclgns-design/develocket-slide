// build-ncs-catalog.mjs — ncs.go.kr 분류체계를 조회해 assets/ncs-catalog.js 를 다시 만든다.
// NCS 는 개정되며 코드가 바뀌므로, 개정 고시 후 이 스크립트로 참조 목록을 갱신한다.
//
//   node tools/build-ncs-catalog.mjs              # 기본 범위
//   node tools/build-ncs-catalog.mjs 20,08,05     # 대분류 지정
//
// 대분류 → 중분류 → 소분류 → 세분류 → 능력단위(분류번호·명칭) 를 걷고,
// 세분류마다 능력단위 수준과 직무정의를 받아 한 파일로 쓴다. 요청 사이에 짧게 쉰다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://www.ncs.go.kr";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "assets", "ncs-catalog.js");
const LCLAS = (process.argv[2] || "20,08,02,05,10,04").split(",");
// 대분류 20·08 은 전체, 나머지는 과정 설계에 자주 쓰는 세분류만
const KEEP = /^(20|08)|^0501020[1-3]|^0201020[12]|^02010301|^10030102|^04030202/;

let cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(p, body, json) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": json ? "application/json; charset=UTF-8" : "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: BASE + "/unity/th03/ncsSearchMain.do",
      Cookie: cookie
    },
    body: json ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  try { return JSON.parse(await res.text()); } catch { return null; }
}
const list = async (p) => ((await post(p)) || {}).data || [];

const subd = {};
const units = [];
let degree = 0;
for (const l of LCLAS) {
  for (const m of await list(`/unity/th03/getMclassCd.do?ncsLclasCd=${l}`)) {
    for (const s of await list(`/unity/th03/getSclassCd.do?ncsLclasCd=${l}&ncsMclasCd=${m.ncsMclasCd}`)) {
      for (const d of await list(`/unity/th03/getSubdCd.do?ncsLclasCd=${l}&ncsMclasCd=${m.ncsMclasCd}&ncsSclasCd=${s.ncsSclasCd}`)) {
        const code = `${l}${m.ncsMclasCd}${s.ncsSclasCd}${d.ncsSubdCd}`;
        if (!KEEP.test(code)) continue;
        await sleep(150);
        const us = await list(`/unity/th03/getCompeUnit.do?dutySvcNo=${d.dutySvcNo || ""}&ncsLclasCd=${l}&ncsMclasCd=${m.ncsMclasCd}&ncsSclasCd=${s.ncsSclasCd}&ncsSubdCd=${d.ncsSubdCd}`);
        let info = null;
        if (us[0]) {
          const u = us[0];
          const r = await post("/unity/hth01/hth0101/ncsResultSearchList.do", {
            doCompeUnit: "false", ncsLclasCd: u.ncsLclasCd, ncsMclasCd: u.ncsMclasCd, ncsSclasCd: u.ncsSclasCd, ncsSubdCd: u.ncsSubdCd,
            ncsCompeUnitCd: u.ncsCompeUnitCd, ncsClCd: u.ncsClCd, dutySvcNo: u.dutySvcNo, output: "ncsRsnInfo"
          }, true);
          info = r && r.data && r.data.ncsRsnInfo;
          await sleep(150);
        }
        const levels = {};
        for (const x of (info && info.ncsList) || []) { levels[x.ncsClCd] = x.compeUnitLevel; degree = Math.max(degree, x.ncsDegr || 0); }
        subd[code] = [d.ncsLclasCdnm || "", m.ncsMclasCdnm, s.ncsSclasCdnm, d.ncsSubdCdnm, ((info && info.defInfo && info.defInfo.dutyDef) || "").trim()];
        for (const u of us) units.push([u.ncsClCd, u.compeUnitName.replace(/\s+/g, " ").trim(), levels[u.ncsClCd] || 0]);
        process.stderr.write(".");
      }
    }
  }
}

if (!units.length) { console.error("\n수집 결과가 비어 있습니다. ncs.go.kr 응답 형식이 바뀌었는지 확인하세요."); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
const head = `/* ncs-catalog.js — NCS 능력단위 참조 목록 (자동 생성 파일 · 직접 수정하지 마세요 → tools/build-ncs-catalog.mjs)
 * 출처: 국가직무능력표준 ncs.go.kr 분류체계 조회 (NCS ${degree}차 고시 체계, ${today} 수집)
 * subd: 세분류코드(8자리) → [대분류, 중분류, 소분류, 세분류, 직무정의]
 * units: [능력단위 분류번호(코드_버전), 능력단위명, 수준] — 앞 8자리가 세분류코드
 * NCS는 개정되며 코드가 바뀝니다. 사용 전 ncs.go.kr에서 현행 여부를 확인하세요. */
`;
const body = `window.KBuilder = window.KBuilder || {};\nwindow.KBuilder.NCS = ${JSON.stringify({ degree, collectedAt: today, source: BASE, subd, units })};\n`;
fs.writeFileSync(OUT, head + body);
console.log(`\n세분류 ${Object.keys(subd).length}개 · 능력단위 ${units.length}개 → ${path.relative(process.cwd(), OUT)}`);
