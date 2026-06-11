/* ai-config.js — AI 생성(소스 원고 → 교수안·편성안) 백엔드 설정
 *
 * ⛔ 외부 API 차단됨: Supabase 엣지 펑션(slide-gemini / slide-image) 엔드포인트를
 * 제거해 외부 서버로 나가는 AI 호출이 일어나지 않는다.
 * 아래 fetch 가드가 혹시 모를 외부 API 호출까지 이중으로 차단한다.
 *
 * (window.claude 가 존재하는 호스트 환경에서는 generate.js 의 로컬 폴백으로
 *  AI 생성이 동작할 수 있으며, 이 경우에도 외부 키/서버는 사용하지 않는다.)
 *
 * 다시 외부 백엔드를 쓰려면 endpoint(POST {prompt} → {text} 규약)를 채우고
 * BLOCKED_HOSTS 에서 해당 도메인을 빼면 된다.
 */
window.KBuilder = window.KBuilder || {};
window.KBuilder.AI = {
  endpoint: null,       // ⛔ 차단 (이전: https://…supabase.co/functions/v1/slide-gemini)
  model: "gemini-2.5-pro",
  models: [
    { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro · 최고 품질(느림)" },
    { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash · 빠른 균형" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite · 가장 빠름·저렴" }
  ],
  imageEndpoint: null,  // ⛔ 차단 (이전: https://…supabase.co/functions/v1/slide-image)
  imageModel: "gemini-3.1-flash-image-preview"
};

/* ── 외부 API 호출 차단 가드 ──────────────────────────────────────────
 * supabase.co 등 외부 API 도메인으로 향하는 모든 fetch 를 즉시 거부한다.
 * 폰트(fonts.gstatic.com)·라이브러리 CDN(jsdelivr)은 정적 리소스이므로 허용.
 */
(function () {
  var BLOCKED_HOSTS = ["supabase.co", "generativelanguage.googleapis.com"];
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = "";
    try { url = typeof input === "string" ? input : (input && input.url) || ""; } catch (e) {}
    for (var i = 0; i < BLOCKED_HOSTS.length; i++) {
      if (url.indexOf(BLOCKED_HOSTS[i]) !== -1) {
        console.warn("[ai-config] 외부 API 호출 차단:", url);
        return Promise.reject(new Error("외부 API 호출이 차단되어 있습니다: " + url));
      }
    }
    return origFetch.apply(this, arguments);
  };
})();
