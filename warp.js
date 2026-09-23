// 연출: 잘못 골랐을 때 글이 일그러지고, 식구가 찢기듯 수신되고, 사망 도장과 피가 찍힌다.
// 몸이 망가지는 것이 곧 전송이 깨지는 것이라서, 전부 종이와 글자가 망가지는 모습으로 만든다.
// 움직임 줄이기를 켜 두면 반전·떨림·찢김·흘러내림을 빼고 정지 화면과 도장만 남긴다.

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const jitter = (spread) => (Math.random() * 2 - 1) * spread;

/* ---------- 글 일그러짐 ---------- */

// 감각이 빠진 것을 썼을 때: 글자가 하나씩 커지고 줄끼리 밀어내다 쪽 밖으로 넘친다.
async function swell(body) {
  const chars = [];
  for (const p of body.children) {
    const text = p.textContent;
    p.replaceChildren(
      ...[...text].map((ch) => {
        const s = document.createElement("span");
        s.className = "warp-ch";
        s.textContent = ch;
        chars.push(s);
        return s;
      })
    );
  }
  const order = chars
    .map((s) => [Math.random(), s])
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s);
  const step = 1500 / order.length;
  order.forEach((s, i) => {
    setTimeout(() => s.style.setProperty("--grow", (1.5 + Math.random() * 2).toFixed(2)), i * step);
  });
  await wait(1700);
}

// 뒤집힌 것을 평소대로 썼을 때: 줄이 하나씩 좌우로 뒤집히고 문장 순서가 거꾸로 섞인다.
async function flipLines(body) {
  const lines = [...body.children];
  for (const p of lines) {
    p.classList.add("is-mirrored");
    await wait(320);
  }
  for (const p of lines) {
    p.textContent = p.textContent.split(/(?<=[.?!])\s+/).reverse().join(" ");
  }
  body.append(...lines.reverse());
  await wait(420);
}

// 하나 더 있는 것에 걸려 죽을 때: 같은 문장이 두 번, 세 번 어긋나게 겹쳐 찍히며 쪽을 채운다.
async function echo(body) {
  const lines = [...body.children];
  for (let r = 0; r < 7; r++) {
    const copy = lines[r % lines.length].cloneNode(true);
    copy.classList.add("echo");
    copy.style.setProperty("--dx", `${jitter(14).toFixed(1)}px`);
    body.append(copy);
    await wait(210);
  }
}

// 어느 경우든 장 전체가 가로로 찢기고 검은 줄이 긁힌다. 기한 초과는 이것만 한다.
async function tear(sheet) {
  const marks = document.createElement("div");
  marks.className = "tear";
  marks.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("span");
    s.className = "tear-scratch";
    s.style.setProperty("--y", `${(12 + Math.random() * 76).toFixed(1)}%`);
    s.style.setProperty("--r", `${jitter(1.2).toFixed(2)}deg`);
    s.style.setProperty("--w", `${(1 + Math.random() * 3).toFixed(1)}px`);
    s.style.setProperty("--d", `${i * 90}ms`);
    marks.append(s);
  }
  sheet.append(marks);
  sheet.classList.add("is-torn");
  await wait(700);
}

async function warp(kind, body, sheet) {
  if (still()) return;
  body.classList.add("is-warping");
  if (kind === "sense") await swell(body);
  else if (kind === "flip") await flipLines(body);
  else if (kind === "extra") await echo(body);
  await tear(sheet);
}

/* ---------- 식구의 점프스케어 ---------- */

// 쪽이 넘어가는 대신 용지가 한 번 새까맣게 반전되고, 화면 전체에 식구 사진이 찢기듯 빠르게 수신된다.
// 줄이 옆으로 밀리며 지직거리다 1초쯤 뒤 그림 판 자리로 줄어든다. image는 이미 1비트로 디더한 캔버스다.
async function scare({ sheet, image, target }) {
  if (still()) return;
  sheet.classList.add("is-inverted");
  const c = document.createElement("canvas");
  c.className = "scare";
  c.setAttribute("aria-hidden", "true");
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
  document.body.append(c);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1b1b1b";
  ctx.fillRect(0, 0, c.width, c.height);
  const sy = c.height / image.height;
  const bands = 14;
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor((image.height * b) / bands);
    const y1 = Math.floor((image.height * (b + 1)) / bands);
    ctx.drawImage(image, 0, y0, image.width, y1 - y0, jitter(0.06 * c.width), y0 * sy, c.width, (y1 - y0) * sy);
    await frame();
  }
  sheet.classList.remove("is-inverted");
  c.classList.add("is-jitter");
  await wait(820);
  c.classList.remove("is-jitter");
  c.style.transform = `translate(${target.left}px, ${target.top}px) scale(${target.width / innerWidth}, ${target.height / innerHeight})`;
  await wait(280);
  c.remove();
}

/* ---------- 사망 도장 ---------- */

// 일그러짐이 멈추면 수신 장을 가로지르는 큰 빨간 사망 도장이 비스듬히 찍히고, 아래에 기계 글씨가 남는다.
function deathStamp(sheet, clone, time) {
  const mark = document.createElement("div");
  mark.className = "death";
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", `사망. 신호 끊김, 사본 ${clone}, 사망 확인 ${time}.`);
  mark.style.setProperty("--r", `${(-13 + jitter(2)).toFixed(1)}deg`);
  const seal = document.createElement("span");
  seal.className = "death-seal";
  seal.textContent = "사망";
  const line = document.createElement("span");
  line.className = "death-line";
  line.textContent = `신호 끊김 · 사본 ${clone} · 사망 확인 ${time}`;
  mark.append(seal, line);
  sheet.append(mark);
}

/* ---------- 피 ---------- */

// 피는 그림 안이 아니라 종이와 책상 위에 묻는다. 색은 죽음의 빨강(--seal) 하나다.
// 종이에 스민 것처럼 보이게 하는 것은 셋이다. 가장자리를 #blood 필터로 흩뜨려 종이 결을 타게 하고,
// 같은 모양을 조금 키워 옅게 깔아 번진 자리를 만들고, 가운데에 작은 심을 겹쳐 multiply로 짙게 한다.
// 모양은 원 둘레의 점 몇 개를 곡선으로 이어 닫은 방울이고, 튄 방울에는 바깥으로 뻗는 꼬리가 붙는다.
function blobPath(cx, cy, r, bumps = 9, tail = 0, angle = 0) {
  const pts = Array.from({ length: bumps }, (_, i) => {
    const a = (i / bumps) * Math.PI * 2;
    const rr = r * (0.72 + Math.random() * 0.56);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const f = (v) => v.toFixed(1);
  let [mx, my] = mid(pts[bumps - 1], pts[0]);
  let d = `M${f(mx)} ${f(my)}`;
  pts.forEach((p, i) => {
    [mx, my] = mid(p, pts[(i + 1) % bumps]);
    d += ` Q${f(p[0])} ${f(p[1])} ${f(mx)} ${f(my)}`;
  });
  d += " Z";
  // 꼬리: 방울 몸통에서 바깥쪽(angle)으로 가늘어지며 뻗는 한 조각. 같은 path 안의 다른 조각이라 한 획으로 치고,
  // 몸통과 같은 방향으로 감아야 겹친 자리가 구멍으로 뚫리지 않는다.
  if (tail > 0) {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy * r * 0.62;
    const ny = ux * r * 0.62;
    const tipX = cx + ux * tail;
    const tipY = cy + uy * tail;
    const bx = cx + ux * tail * 0.55;
    const by = cy + uy * tail * 0.55;
    d += ` M${f(cx - nx)} ${f(cy - ny)} Q${f(bx - nx * 0.45)} ${f(by - ny * 0.45)} ${f(tipX)} ${f(tipY)}`;
    d += ` Q${f(bx + nx * 0.45)} ${f(by + ny * 0.45)} ${f(cx + nx)} ${f(cy + ny)} Z`;
  }
  return d;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 층은 위에서부터 겹쳐 그린다. { d, opacity, scale } 중 scale은 가운데(50,50)를 기준으로 키우거나 줄인다.
function bloodSvg(className, layers) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  const ink = document.createElementNS(SVG_NS, "g");
  ink.setAttribute("filter", "url(#blood)");
  for (const layer of layers) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", layer.d);
    if (layer.opacity != null) path.setAttribute("opacity", layer.opacity);
    if (layer.scale != null) path.setAttribute("transform", `translate(50 50) scale(${layer.scale}) translate(-50 -50)`);
    ink.append(path);
  }
  svg.append(ink);
  return svg;
}

// 번진 테두리, 고인 자리, 그 안의 심 둘. 겹치는 만큼만 짙어져서 가운데가 가장 어둡고
// 가장자리로 갈수록 옅어진다. 색은 하나뿐이고 짙기만 다르다. 번진 테두리만 같은 모양을 키운 것이고
// 안쪽 둘은 제 모양이라, 같은 윤곽이 등고선처럼 겹쳐 보이지 않는다.
function soakLayers(cx, cy, r, bumps, core) {
  const d = blobPath(cx, cy, r, bumps);
  return [
    { d, opacity: 0.3, scale: 1.07 },
    { d },
    { d: blobPath(cx + jitter(r * 0.12), cy + jitter(r * 0.12), r * 0.62, bumps), opacity: core },
    { d: blobPath(cx + jitter(r * 0.22), cy + jitter(r * 0.22), r * 0.34, Math.max(7, bumps - 2)), opacity: core },
  ];
}

// 쪽이 깊어질수록 용지 가장자리에 핏방울과 문지른 자국이 하나씩 는다. 4쪽부터 한 쪽에 하나, 여덟까지.
const BLEED_FROM = 4;
function bleed(sheet, page) {
  const want = Math.max(0, Math.min(8, page - BLEED_FROM + 1));
  for (let have = sheet.querySelectorAll(".blood-drop").length; have < want; have++) {
    const smear = Math.random() < 0.35;
    const layers = soakLayers(50, 50, smear ? 20 : 28, smear ? 11 : 9, 0.5);
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 34 + Math.random() * 12;
      const r = 2 + Math.random() * 3.4;
      layers.push({ d: blobPath(50 + Math.cos(a) * dist, 50 + Math.sin(a) * dist, r, 6, k === 0 ? r * 2.4 : 0, a) });
    }
    const drop = bloodSvg(`blood blood-drop${smear ? " is-smear" : ""}`, layers);
    const size = 14 + Math.random() * 22;
    drop.style.width = `${(size * (smear ? 2.6 : 1)).toFixed(0)}px`;
    drop.style.height = `${size.toFixed(0)}px`;
    const edge = ["left", "right", "top", "bottom"][Math.floor(Math.random() * 4)];
    // 문지른 자국은 종이가 쓸린 방향대로 가장자리를 따라 눕는다. 방울은 아무렇게나 돌아가도 된다.
    const lie = edge === "left" || edge === "right" ? 90 : 0;
    drop.style.setProperty("--r", smear ? `${(lie + jitter(12)).toFixed(0)}deg` : `${Math.floor(Math.random() * 360)}deg`);
    const along = `${(6 + Math.random() * 88).toFixed(1)}%`;
    const off = `${(-size * 0.35 + Math.random() * 18).toFixed(0)}px`;
    if (edge === "left" || edge === "right") drop.style.top = along;
    else drop.style.left = along;
    drop.style[edge] = off;
    sheet.append(drop);
  }
}

// 죽는 순간 큰 핏자국이 장을 넘어 책상까지 튀고, 몇 줄기가 아래로 흘러내린다.
function splatter(sheet) {
  const splat = document.createElement("div");
  splat.className = "blood-splat";
  // 사망 도장과 기계 글씨는 장 가운데를 크게 차지하니, 왼쪽 아래나 오른쪽 아래 중 하나를 골라 피해서 튄다
  const corner = Math.random() < 0.5 ? "left" : "right";
  const x = corner === "left" ? -28 + Math.random() * 6 : 84 + Math.random() * 6;
  const y = 30 + Math.random() * 12;
  splat.style.setProperty("--x", `${x.toFixed(1)}%`);
  splat.style.setProperty("--y", `${y.toFixed(1)}%`);
  const layers = soakLayers(50, 50, 28, 13, 0.55);
  // 고인 자리가 동그래지지 않게, 한쪽으로 치우친 덩어리를 하나 겹쳐 윤곽을 깬다.
  const lobe = Math.random() * Math.PI * 2;
  layers.splice(2, 0, { d: blobPath(50 + Math.cos(lobe) * 15, 50 + Math.sin(lobe) * 15, 19, 11) });
  // 가까이 튄 방울에는 바깥으로 뻗는 꼬리가 있고, 멀리 간 것은 점만 남는다.
  for (let k = 0; k < 14; k++) {
    const a = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 20;
    const r = 1.4 + Math.random() * 3.4;
    layers.push({ d: blobPath(50 + Math.cos(a) * dist, 50 + Math.sin(a) * dist, r, 6, k < 5 ? r * (2.2 + Math.random() * 2.6) : 0, a) });
  }
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2;
    const dist = 52 + Math.random() * 8;
    layers.push({ d: blobPath(50 + Math.cos(a) * dist, 50 + Math.sin(a) * dist, 0.7 + Math.random() * 1.1, 5), opacity: 0.8 });
  }
  splat.append(bloodSvg("blood", layers));
  // 움직임 줄이기에서는 흘러내림 없이 멈춘 핏자국만 남는다
  if (!still()) {
    for (let k = 0; k < 4; k++) {
      const d = document.createElement("span");
      d.className = "drip";
      // 자국의 아래쪽 절반에서 시작해 아래로 흐른다. 자국을 따라다니게 자국의 자식으로 둔다.
      d.style.setProperty("--x", `${(34 + Math.random() * 32).toFixed(1)}%`);
      d.style.setProperty("--len", `${(80 + Math.random() * 220).toFixed(0)}px`);
      d.style.setProperty("--w", `${(4 + Math.random() * 6).toFixed(1)}px`);
      d.style.setProperty("--tilt", `${jitter(2.2).toFixed(1)}deg`);
      d.style.setProperty("--delay", `${(Math.random() * 500).toFixed(0)}ms`);
      splat.append(d);
    }
  }
  sheet.append(splat);
}
