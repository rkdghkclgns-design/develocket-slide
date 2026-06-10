/* tutorial.js — 빌더 사용 튜토리얼 (다시 보지 않기 지원) */
(function () {
  "use strict";
  var KEY = "kb-tut-hide";
  var STEPS = [
    { t: "1단계 · MD 넣기", b: "<b>완성된 MD 올리기</b>: 교수안·슬라이드 편성안 .md를 끌어다 놓고 <b>변환하기</b>.<br/><b>소스 원고로 생성</b>: 강의 원고 .md를 넣으면 AI가 교수안·편성안을 만들어 줍니다(검토·편집 후 빌드).<br/><b>내보낸 HTML 불러오기</b>: 이전에 내보낸 슬라이드 HTML을 다시 열어 이어서 편집할 수 있어요." },
    { t: "2단계 · 결과 보기", b: "상단 탭으로 <b>📖 교수안</b>과 <b>🎬 슬라이드</b>를 오갑니다.<br/>슬라이드 탭에서 테마(<b>🍄 메이플 / 🌙 다크</b>)를 바꿀 수 있고, 왼쪽 <b>썸네일 레일</b>을 클릭하면 해당 슬라이드로 바로 이동합니다. (썸네일에 마우스를 올리면 복제·추가·삭제 버튼)" },
    { t: "3단계 · 슬라이드 편집", b: "<b>✏️ 편집</b>을 켜면:<br/>· <b>클릭</b> = 객체 선택 (주황 외곽선 + 크기조절 핸들)<br/>· <b>더블클릭</b> = 텍스트 수정 (상단 서식 툴바 사용)<br/>· <b>드래그</b> = 자유 이동, <b>모서리 핸들</b> = 크기조절<br/>· <b>빈 곳 드래그</b> = 여러 객체 선택, <b>Shift+클릭</b> = 선택 추가" },
    { t: "4단계 · 단축키", b: "· <b>Ctrl+C / Ctrl+X / Ctrl+V</b> — 복사·잘라내기·붙여넣기 (클립보드의 <b>이미지(JPG·PNG·GIF)</b>도 Ctrl+V로 붙여넣기)<br/>· <b>Delete</b> — 선택한 객체 삭제 (툴바 ✂ 선택 삭제 버튼도 동일)<br/>· <b>Ctrl+A</b> — 슬라이드 전체 선택, <b>Esc</b> — 선택 해제<br/>· <b>Shift+드래그</b> = 직선 이동, <b>Shift+핸들</b> = 비율 유지" },
    { t: "5단계 · 추가와 내보내기", b: "· <b>📐 레이아웃</b> — 표지·소결·카드·표·케이스 등 양식을 골라 새 슬라이드 추가 또는 현재 슬라이드 교체<br/>· <b>🖼 이미지</b> — 파일 선택으로 이미지 삽입<br/>· <b>⤓ PDF</b>(슬라이드는 가로 1장 1페이지) · <b>⤓ HTML</b>(폰트 포함, 다시 불러오기 가능) · <b>⤓ PPTX</b>(편집 가능)" }
  ];
  var idx = 0, box = null;

  function build() {
    if (box) return box;
    box = document.createElement("div");
    box.className = "tut-overlay";
    box.innerHTML =
      '<div class="tut-card">' +
        '<div class="tut-head"><span class="tut-step"></span><button class="tut-x" title="닫기">✕</button></div>' +
        '<h3 class="tut-title"></h3>' +
        '<p class="tut-body"></p>' +
        '<div class="tut-dots"></div>' +
        '<div class="tut-foot">' +
          '<label class="tut-never"><input type="checkbox" id="tut-never-chk" /> 다시 보지 않기</label>' +
          '<span class="spacer"></span>' +
          '<button class="tut-prev">이전</button>' +
          '<button class="tut-next">다음</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);
    box.querySelector(".tut-x").addEventListener("click", close);
    box.querySelector(".tut-prev").addEventListener("click", function () { go(idx - 1); });
    box.querySelector(".tut-next").addEventListener("click", function () {
      if (idx >= STEPS.length - 1) close(); else go(idx + 1);
    });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    return box;
  }
  function go(n) {
    idx = Math.max(0, Math.min(STEPS.length - 1, n));
    var s = STEPS[idx];
    box.querySelector(".tut-step").textContent = (idx + 1) + " / " + STEPS.length;
    box.querySelector(".tut-title").textContent = s.t;
    box.querySelector(".tut-body").innerHTML = s.b;
    box.querySelector(".tut-prev").style.visibility = idx === 0 ? "hidden" : "visible";
    box.querySelector(".tut-next").textContent = idx === STEPS.length - 1 ? "시작하기 →" : "다음";
    box.querySelector(".tut-dots").innerHTML = STEPS.map(function (_, i) {
      return '<span class="tut-dot' + (i === idx ? " on" : "") + '"></span>';
    }).join("");
  }
  function open() { build(); go(0); box.classList.add("open"); }
  function close() {
    if (box.querySelector("#tut-never-chk").checked) localStorage.setItem(KEY, "1");
    box.classList.remove("open");
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.openTutorial = open;

  var helpBtn = document.getElementById("btn-help");
  if (helpBtn) helpBtn.addEventListener("click", open);

  // 첫 방문 시 자동 표시 (다시 보지 않기 선택 시 생략)
  if (localStorage.getItem(KEY) !== "1") setTimeout(open, 400);
})();
