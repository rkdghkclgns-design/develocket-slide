/* ai-config.js — AI 생성(소스 원고 → 교수안·편성안) 백엔드 설정
 *
 * 백엔드 우선순위:
 *   1) edge   — Supabase 엣지 펑션 (⛔ 현재 차단: endpoint = null)
 *   2) gemini — 사용자가 직접 입력한 Google API 키로 Gemini API 직접 호출 (BYOK)
 *   3) claude — window.claude.complete 가 있는 호스트 환경의 로컬 폴백
 *
 * 🔑 Google API 키(BYOK)
 *   - 사용자가 화면의 'Google API 키' 칸에 직접 입력하면 이 브라우저의
 *     localStorage 에만 저장된다. 서버로 전송·수집되지 않으며, 소스코드나
 *     내보낸 HTML 에 포함되지 않는다.
 *   - 키는 URL 이 아니라 요청 헤더(x-goog-api-key)로만 전송된다.
 *   - 키 발급: https://aistudio.google.com/apikey
 *
 * ⛔ 외부 API 차단 가드
 *   - supabase.co 로 나가는 호출은 항상 차단.
 *   - generativelanguage.googleapis.com 은 사용자가 키를 저장한 경우에만 허용.
 */
window.KBuilder = window.KBuilder || {};
window.KBuilder.AI = {
  endpoint: null,       // ⛔ 차단 (이전: https://…supabase.co/functions/v1/slide-gemini)
  apiBase: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-2.5-pro",
  models: [
    { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro · 최고 품질(느림)" },
    { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash · 빠른 균형" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite · 가장 빠름·저렴" }
  ],
  imageEndpoint: null,  // ⛔ 차단 (이전: https://…supabase.co/functions/v1/slide-image)
  imageModel: "gemini-2.5-flash-image",

  /* ---- 사용자 Google API 키 (localStorage 전용, 외부 유출 없음) ---- */
  _KEY_STORE: "kb-gemini-key",
  getKey: function () {
    try { return (localStorage.getItem(this._KEY_STORE) || "").trim(); } catch (e) { return ""; }
  },
  setKey: function (key) {
    try {
      key = String(key || "").trim();
      if (key) localStorage.setItem(this._KEY_STORE, key);
      else localStorage.removeItem(this._KEY_STORE);
    } catch (e) {}
  },
  hasKey: function () { return !!this.getKey(); }
};

/* ── 외부 API 호출 차단 가드 ──────────────────────────────────────────
 * supabase.co 는 항상 차단. Google Gemini API 는 사용자가 키를 직접
 * 저장했을 때만 허용한다. 폰트·라이브러리 CDN 등 정적 리소스는 허용.
 */
(function () {
  var ALWAYS_BLOCKED = ["supabase.co"];
  var KEY_GATED = ["generativelanguage.googleapis.com"];
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = "";
    try { url = typeof input === "string" ? input : (input && input.url) || ""; } catch (e) {}
    var i;
    for (i = 0; i < ALWAYS_BLOCKED.length; i++) {
      if (url.indexOf(ALWAYS_BLOCKED[i]) !== -1) {
        console.warn("[ai-config] 외부 API 호출 차단:", url);
        return Promise.reject(new Error("외부 API 호출이 차단되어 있습니다: " + url));
      }
    }
    for (i = 0; i < KEY_GATED.length; i++) {
      if (url.indexOf(KEY_GATED[i]) !== -1 && !window.KBuilder.AI.hasKey()) {
        console.warn("[ai-config] Google API 키가 없어 호출 차단:", url);
        return Promise.reject(new Error("Google API 키가 저장되어 있지 않아 호출이 차단됐습니다. 화면의 'Google API 키' 칸에 키를 입력해 주세요."));
      }
    }
    return origFetch.apply(this, arguments);
  };
})();
