/* course-refs.js — 참고 자료(레거시 교안 등) 읽기: PDF · PPTX(슬라이드 노트 포함) · DOCX · TXT/MD · 이미지
 *   글자만 뽑아 이 창의 메모리에만 둔다(저장하지 않음). 쪽 범위를 골라 AI 프롬프트에 붙인다.
 *   K.courseRefs.create(scope) → 참고 자료 묶음 { list, sel, add(files, ui), html(budget), block(kind), ... }
 *   라이브러리: pdf.js 3.11.174, JSZip 3.10.1 (cdnjs, 필요할 때만 불러옴)
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  /* 외부 라이브러리는 버전을 고정하고 무결성(SRI) 해시로 검증한다 — API 키가 있는 같은 출처에서 실행되므로 */
  var PDFJS = { src: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", sri: "sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==" };
  var PDFJS_W = { src: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", sri: "sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==" };
  var JSZIP = { src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", sri: "sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==" };
  var MEM_LIMIT = 400000; // 자료 하나에서 읽어 둘 최대 바이트
  var KIND = { pdf: "PDF", pptx: "PPTX", docx: "DOCX", text: "텍스트", image: "이미지" };

  var loaded = {};
  function loadScript(lib) {
    if (loaded[lib.src]) return loaded[lib.src];
    loaded[lib.src] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = lib.src; s.integrity = lib.sri; s.crossOrigin = "anonymous";
      s.onload = res;
      s.onerror = function () { delete loaded[lib.src]; rej(new Error("파일을 읽는 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.")); };
      document.head.appendChild(s);
    });
    return loaded[lib.src];
  }
  function bytes(s) { return K.courseTB.bytes(s); }
  function esc(s) { return K.courseRules.esc(s); }

  /* ---------- 형식별 읽기 → {pages:[{n, text}], unit} ---------- */
  /* 워커 스크립트도 SRI 로 검증해 메인 스레드에 올린다 (window.pdfjsWorker 가 있으면 pdf.js 가 별도 워커를 띄우지 않는다) */
  function pdfLib() {
    return loadScript(PDFJS_W).then(function () { return loadScript(PDFJS); }).then(function () {
      var lib = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
      lib.GlobalWorkerOptions.workerSrc = PDFJS_W.src;
      return lib;
    });
  }
  function readPdf(file) {
    return Promise.all([pdfLib(), file.arrayBuffer()]).then(function (r) {
      return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false, useSystemFonts: true }).promise;
    }).then(function (doc) {
      var pages = [], chain = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) {
        (function (n) {
          chain = chain.then(function () { return doc.getPage(n); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
            var out = "", lastY = null;
            tc.items.forEach(function (it) {
              var y = it.transform ? it.transform[5] : null;
              if (lastY != null && Math.abs(y - lastY) > Math.max(2, (it.height || 10) * 0.6)) out += "\n";
              out += it.str;
              if (it.hasEOL) out += "\n";
              lastY = y;
            });
            pages.push({ n: n, text: out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() });
          });
        })(i);
      }
      return chain.then(function () { return { doc: doc, pages: pages, unit: "쪽" }; });
    });
  }
  /* 스캔 PDF: 쪽을 이미지로 바꿔 AI 가 글자를 옮겨 적게 한다 */
  function renderPdfPages(doc, from, to) {
    var out = [], chain = Promise.resolve();
    for (var i = from; i <= to; i++) {
      (function (n) {
        chain = chain.then(function () { return doc.getPage(n); }).then(function (pg) {
          var vp = pg.getViewport({ scale: 1.6 });
          var c = document.createElement("canvas");
          c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          return pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () {
            var data = c.toDataURL("image/jpeg", 0.85);
            out.push({ n: n, image: { mime: "image/jpeg", data: data.slice(data.indexOf(",") + 1) } });
          });
        });
      })(i);
    }
    return chain.then(function () { return out; });
  }
  function xmlText(xml, tag) {
    var re = new RegExp("<" + tag + "[^>]*>([^<]*)</" + tag + ">", "g"), m, s = "";
    while ((m = re.exec(xml))) s += m[1];
    return s;
  }
  function unxml(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
  function paras(xml, re) { var out = [], m; while ((m = re.exec(xml))) out.push(m[0]); return out; }
  /* 관계 파일(.rels) → {rId: 경로} */
  function rels(zip, path, base) {
    var f = zip.file(path);
    if (!f) return Promise.resolve({});
    return f.async("string").then(function (x) {
      var out = {}, re = /<Relationship\b([^>]*)\/?>/g, m;
      while ((m = re.exec(x))) {
        var id = (m[1].match(/\bId="([^"]+)"/) || [])[1], t = (m[1].match(/\bTarget="([^"]+)"/) || [])[1];
        if (id && t) out[id] = t.charAt(0) === "/" ? t.slice(1) : (base + t).replace(/[^/]+\/\.\.\//g, "");
      }
      return out;
    });
  }
  function paraText(xml) { return paras(xml, /<a:p>[\s\S]*?<\/a:p>/g).map(function (p) { return unxml(xmlText(p, "a:t")); }); }
  /* 슬라이드 순서는 presentation.xml 의 sldIdLst, 노트는 각 슬라이드의 관계 파일을 따른다 (파일 번호와 다를 수 있음) */
  function readPptx(file) {
    var zip;
    return loadScript(JSZIP).then(function () { return window.JSZip.loadAsync(file); }).then(function (z) {
      zip = z;
      var pres = zip.file("ppt/presentation.xml");
      return Promise.all([pres ? pres.async("string") : "", rels(zip, "ppt/_rels/presentation.xml.rels", "ppt/")]);
    }).then(function (r) {
      var ids = [], re = /<p:sldId\b[^>]*\br:id="([^"]+)"/g, m;
      while ((m = re.exec(r[0]))) ids.push(m[1]);
      var order = ids.map(function (id) { return r[1][id]; }).filter(function (p) { return p && zip.file(p); });
      if (!order.length) {
        order = Object.keys(zip.files).filter(function (k) { return /^ppt\/slides\/slide\d+\.xml$/.test(k); })
          .sort(function (a, b) { return Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]); });
      }
      var pages = [], chain = Promise.resolve();
      order.forEach(function (path, i) {
        chain = chain.then(function () {
          return Promise.all([zip.file(path).async("string"), rels(zip, path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"), "ppt/slides/")]);
        }).then(function (x) {
          var text = paraText(x[0]).filter(Boolean).join("\n");
          var notePath = Object.keys(x[1]).map(function (k) { return x[1][k]; }).filter(function (t) { return /notesSlides\/notesSlide\d+\.xml$/.test(t); })[0];
          if (!notePath || !zip.file(notePath)) return pages.push({ n: i + 1, text: text });
          return zip.file(notePath).async("string").then(function (nx) {
            var note = paraText(nx).filter(function (t) { return t && !/^\d+$/.test(t); }).join("\n");
            pages.push({ n: i + 1, text: text + (note ? "\n[슬라이드 노트]\n" + note : "") });
          });
        });
      });
      return chain.then(function () { return { pages: pages, unit: "슬라이드" }; });
    });
  }
  /* 쪽 개념이 없는 문서는 약 1,500자(4.5KB)씩 나눠 범위를 고를 수 있게 한다 */
  function chunk(lines) {
    var pages = [], buf = "";
    lines.forEach(function (p) {
      if (bytes(buf + p) > 4500 && buf) { pages.push({ n: pages.length + 1, text: buf.trim() }); buf = ""; }
      buf += p + "\n";
    });
    if (buf.trim()) pages.push({ n: pages.length + 1, text: buf.trim() });
    return pages;
  }
  function readDocx(file) {
    return loadScript(JSZIP).then(function () { return window.JSZip.loadAsync(file); }).then(function (zip) {
      var f = zip.file("word/document.xml");
      if (!f) throw new Error("DOCX 본문을 찾지 못했습니다.");
      return f.async("string");
    }).then(function (xml) {
      var ps = paras(xml, /<w:p[ >][\s\S]*?<\/w:p>/g).map(function (p) { return unxml(xmlText(p, "w:t")); }).filter(Boolean);
      return { pages: chunk(ps), unit: "구간" };
    });
  }
  /* UTF-8 로 읽고, 깨지면 CP949(EUC-KR)로 다시 읽는다 — 한글 윈도우 메모장 파일 */
  function readText(file) {
    return file.arrayBuffer().then(function (buf) {
      var t;
      try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e) { try { t = new TextDecoder("euc-kr").decode(buf); } catch (e2) { t = new TextDecoder("utf-8").decode(buf); } }
      return { pages: chunk(t.replace(/^\uFEFF/, "").split(/\r?\n/)), unit: "구간" };
    });
  }
  function fileToImage(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); res({ mime: file.type || "image/png", data: s.slice(s.indexOf(",") + 1) }); };
      r.onerror = function () { rej(new Error("이미지를 읽지 못했습니다.")); };
      r.readAsDataURL(file);
    });
  }

  function capPages(pages) {
    var total = 0, keep = [];
    for (var i = 0; i < pages.length; i++) {
      var b = bytes(pages[i].text) + 20;
      if (total + b > MEM_LIMIT) break;
      total += b; keep.push(pages[i]);
    }
    return { pages: keep, truncated: keep.length < pages.length };
  }

  /* ================= 참고 자료 묶음 ================= */
  function create(scope) {
    var B = { scope: scope, list: [], sel: {} };
    var uid = 0;

    B.addParsed = function (name, kind, r) {
      var c = capPages(r.pages);
      var id = scope + "-" + (++uid);
      var ref = { id: id, name: name, kind: kind, unit: r.unit || "쪽", pages: c.pages, total: r.pages.length, truncated: c.truncated,
        chars: c.pages.reduce(function (a, p) { return a + p.text.length; }, 0) };
      B.list.push(ref);
      B.sel[id] = { on: true, from: c.pages.length ? c.pages[0].n : 1, to: c.pages.length ? c.pages[c.pages.length - 1].n : 1 };
      return ref;
    };
    B.remove = function (id) { B.list = B.list.filter(function (r) { return r.id !== id; }); delete B.sel[id]; };
    B.find = function (id) { return B.list.filter(function (r) { return r.id === id; })[0]; };
    B.selected = function () { return B.list.filter(function (r) { return (B.sel[r.id] || {}).on !== false; }); };
    function rangeText(r) {
      var s = B.sel[r.id] || {};
      var multi = r.pages.length > 1;
      return r.pages.filter(function (p) { return p.n >= (s.from || 0) && p.n <= (s.to || 1e9) && p.text; })
        .map(function (p) { return multi ? "[" + r.unit + " " + p.n + "]\n" + p.text : p.text; }).join("\n\n");
    }
    function listText() {
      return B.selected().map(function (r) {
        var s = B.sel[r.id] || {};
        var rng = r.pages.length > 1 ? " (" + r.unit + " " + s.from + "~" + s.to + ")" : "";
        return "\n=== 자료: " + r.name + rng + " ===\n" + rangeText(r);
      }).join("\n");
    }
    /* kind: "draft"(초안) | "edit"(부분 수정) */
    B.block = function (kind) {
      if (!B.selected().length) return "";
      if (kind === "edit") {
        return "\n[참고 자료 — 고칠 때 근거로 삼는 자료]\n- 지시를 따르되, 내용의 근거는 아래 자료에서 찾습니다. 자료에 없는 사실을 지어내지 않습니다.\n" +
          "- 자료의 수업 진행·강사 멘트·시간 배분은 버리고, 학습자가 배울 내용만 씁니다.\n- 자료의 표현은 설계 규칙의 어투로 바꾸고, 버전 번호·단축키·메뉴 위치는 옮기지 않습니다.\n" + listText() + "\n";
      }
      return "\n[참고 자료 — 레거시 교안 등]\n아래 자료를 근거로 교재를 씁니다.\n" +
        "- 자료에서 학습자가 배울 내용(개념·절차·예제·주의점)만 뽑습니다. 수업 진행 순서, 강사 행동·멘트, 시간 배분, 인사말, 출석·과제 안내는 버립니다.\n" +
        "- 자료에 없는 내용을 지어내지 않습니다. 개요의 문제 상황 서술처럼 설계 규칙을 지키기 위한 서술은 자료의 주제 안에서 씁니다.\n" +
        "- 자료의 표현은 설계 규칙의 어투로 바꿉니다. 자료가 다른 회차·강의·모듈을 가리키면 도메인 상황으로 바꿔 씁니다.\n" +
        "- 자료 속 버전 번호·단축키·메뉴 위치는 본문에 옮기지 않습니다.\n- [가르칠 내용] 칸이 있으면 그 범위에 맞는 부분을 우선합니다.\n" + listText() + "\n";
    };

    /* files: FileList · ui: {status(t), error(t), toast(t), askScan(file, doc, n), render()} */
    B.add = function (files, ui) {
      var chain = Promise.resolve();
      Array.prototype.forEach.call(files, function (f) {
        chain = chain.then(function () {
          var ext = (f.name.split(".").pop() || "").toLowerCase();
          ui.status("「" + f.name + "」 읽는 중…");
          var p;
          if (ext === "pdf") {
            p = readPdf(f).then(function (r) {
              var chars = r.pages.reduce(function (a, x) { return a + x.text.replace(/\s/g, "").length; }, 0);
              if (chars < r.pages.length * 30) { ui.status(""); ui.askScan(f, r.doc, r.pages.length); return null; }
              return B.addParsed(f.name, "pdf", r);
            });
          } else if (ext === "pptx") p = readPptx(f).then(function (r) { return B.addParsed(f.name, "pptx", r); });
          else if (ext === "docx") p = readDocx(f).then(function (r) { return B.addParsed(f.name, "docx", r); });
          else if (ext === "txt" || ext === "md") p = readText(f).then(function (r) { return B.addParsed(f.name, "text", r); });
          else if (/^image\//.test(f.type)) {
            if (!K.courseTB.canSee("fast")) { ui.error("이미지를 읽으려면 Google 또는 Claude API 키가 필요합니다."); return null; }
            ui.status("「" + f.name + "」의 글자를 AI로 옮겨 적는 중…");
            p = fileToImage(f).then(function (img) { return K.courseAI.transcribeImages([{ n: 1, image: img }]); })
              .then(function (pages) { return B.addParsed(f.name, "image", { pages: pages, unit: "쪽" }); });
          } else { ui.error("「" + f.name + "」은(는) 지원하지 않는 형식입니다. PDF, PPTX, DOCX, TXT, MD, 이미지 파일을 올려 주세요."); return null; }
          return p.then(function (r) {
            ui.status("");
            if (r) ui.toast(r.truncated ? "「" + f.name + "」이 커서 앞부분만 읽었습니다." : "「" + f.name + "」을(를) 참고 자료에 추가했습니다.");
            ui.render();
          }, function (err) {
            ui.status("");
            if (err && err.code === "cancelled") return;
            ui.error("「" + f.name + "」을(를) 읽지 못했습니다. " + ((err && err.message) || "") + " 암호가 걸린 파일이면 해제 후 다시 올려 주세요.");
          });
        });
      });
      return chain;
    };
    B.scan = function (file, doc, a, b, onMsg) {
      onMsg("페이지를 이미지로 바꾸는 중…");
      return renderPdfPages(doc, a, b).then(function (imgs) {
        return K.courseAI.transcribeImages(imgs, function (i, t) { onMsg("글자를 옮겨 적는 중… (" + Math.min(i + 1, t) + "/" + t + "쪽)"); });
      }).then(function (pages) {
        return B.addParsed(file.name + (a > 1 || b < doc.numPages ? " (" + a + "~" + b + "쪽)" : ""), "pdf", { pages: pages, unit: "쪽" });
      });
    };

    /* 참고 자료 칸 HTML — budget = {used, avail} */
    B.html = function (budget) {
      var pct = budget && budget.avail ? Math.round(budget.used / budget.avail * 100) : 0;
      var rows = B.list.map(function (r) {
        var s = B.sel[r.id] || {}, lo = r.pages.length ? r.pages[0].n : 1, hi = r.pages.length ? r.pages[r.pages.length - 1].n : 1;
        var paged = r.pages.length > 1;
        return '<div class="cs-ref' + (s.on === false ? " off" : "") + '"><input type="checkbox" data-ref-on="' + r.id + '"' + (s.on === false ? "" : " checked") + ' aria-label="' + esc(r.name) + ' 사용">' +
          '<div class="cs-ref-main"><div class="cs-ref-name" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="cs-muted">' + (KIND[r.kind] || r.kind) + " · " +
          (paged ? r.pages.length + r.unit + " · " : "") + r.chars.toLocaleString() + "자" + (r.truncated ? ' · <span class="cs-warn">앞 ' + r.pages.length + r.unit + "만 읽음</span>" : "") + "</div></div>" +
          (paged ? '<span class="cs-ref-range"><input type="number" min="' + lo + '" max="' + hi + '" value="' + s.from + '" data-ref-from="' + r.id + '">~<input type="number" min="' + lo + '" max="' + hi + '" value="' + s.to + '" data-ref-to="' + r.id + '"> ' + r.unit + "</span>" : "<span></span>") +
          '<span><button class="cs-link" data-act="ref-view" data-id="' + r.id + '">보기</button> <button class="cs-link cs-danger-t" data-act="ref-del" data-id="' + r.id + '">빼기</button></span></div>';
      }).join("");
      return '<div class="cs-refs" data-ref-scope="' + scope + '"><label class="cs-lab">참고 자료 <span class="cs-muted">· PDF, PPTX, DOCX, TXT·MD, 이미지 — 저장하지 않으며 새로고침하거나 다른 학습모듈로 옮기면 사라집니다</span></label>' +
        rows + (B.list.length ? '<div class="cs-ref-meter' + (pct > 100 ? " over" : pct > 85 ? " near" : "") + '"><span class="cs-pbar"><i style="width:' + Math.min(100, pct) + '%"></i></span><span class="cs-muted">' +
          (pct > 100 ? "한도를 넘었습니다 (" + pct + "%). 쪽 범위를 줄이거나 자료 선택을 해제하세요." : "AI에 보낼 분량 · 한도의 " + pct + "%") + "</span></div>" : "") +
        '<label class="cs-ref-drop" data-ref-drop="' + scope + '"><input type="file" data-ref-file="' + scope + '" multiple accept=".pdf,.pptx,.docx,.txt,.md,image/png,image/jpeg,image/webp" hidden>' +
        '<span>파일을 끌어 놓거나 <u>선택</u></span></label><div class="cs-muted" data-ref-status="' + scope + '"></div><div class="cs-error-t" data-ref-err="' + scope + '"></div></div>';
    };
    B.viewHtml = function (id) {
      var r = B.find(id);
      if (!r) return "";
      var s = B.sel[id] || {};
      return '<div class="cs-dlg-h"><h3>' + esc(r.name) + '</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
        '<p class="cs-muted">' + (KIND[r.kind] || r.kind) + " · " + r.pages.length + r.unit + " · " + r.chars.toLocaleString() + "자. 뽑아낸 글자입니다. 잘못 읽힌 부분이 많으면 원본을 다른 형식(PPTX 등)으로 올려 주세요. 선택 범위는 파란 테두리로 표시합니다.</p>" +
        r.pages.map(function (p) { return '<div class="cs-ref-page' + (p.n >= (s.from || 0) && p.n <= (s.to || 1e9) ? " in" : "") + '"><div class="mono cs-muted">' + r.unit + " " + p.n + "</div><pre>" + esc(p.text || "(글자 없음)") + "</pre></div>"; }).join("") + "</div>";
    };
    return B;
  }

  K.courseRefs = { create: create, KIND: KIND };
})();
