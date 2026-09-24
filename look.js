// 잘못 베낀 집: 수신 팩스와 매뉴얼 한 쪽.
// 집의 글은 content.js, 배치는 house.js, 진행은 run.js에 있고, 여기서는 그것을 팩스 용지 위에 찍는다.
// ?seed=숫자로 열면 같은 집이 나오고, ?debug를 붙이면 지금 쪽(window.__sheet)과 상태(window.__game)를 밖에서 볼 수 있다.

const ANSWER = { sense: "pass", flip: "flip", extra: "ignore" };

const params = new URLSearchParams(location.search);
const SEED = Number(params.get("seed")) || Date.now() % 1e9;
const DEBUG = params.has("debug");

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = matchMedia("(max-width: 960px)");

const T = reduced
  ? { line: 0, gap: 0, tick: 0, leave: 0, arrive: 0, entry: 0 }
  : { line: 280, gap: 140, tick: 320, leave: 260, arrive: 720, entry: 260 };


// 첫 판은 언제나 1회, 사본 0409다(2026-09-23 사용자 결정). 앞 사본의 일지와 근거는 비어 있다.
const FIRST_CLONE = 409;

const state = {
  clone: FIRST_CLONE,
  entry: 1,
  page: 1,
  place: "복도",
  turn: 0,
  timer: null,
  left: DEADLINE,
  limit: DEADLINE,
  open: false,
  keyboard: false,
  unread: 0,
  rejects: 0,
  rng: null,
  house: null,
  run: null,
  sheet: null,
  shown: 0,
  moods: [],
  heads: [],
};
if (DEBUG) { window.__game = { state }; document.body.classList.add("is-debug"); }

const pad = (n) => String(n).padStart(4, "0");
const two = (n) => String(n).padStart(2, "0");
const clock = (d = new Date()) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const clockSec = (d = new Date()) => `${clock(d)}:${two(d.getSeconds())}`;

// 번호를 소리 내어 읽을 때 끝자리에 받침이 있는지: 0 공, 1 일, 3 삼, 6 육, 7 칠, 8 팔
const HAS_FINAL = "013678";

function fill(text) {
  const nums = {
    clone: pad(state.clone),
    prev: pad(state.clone - 1),
    p1: pad(state.clone - 2),
    p2: pad(state.clone - 3),
    p3: pad(state.clone - 4),
  };
  return text.replace(/\{(\w+)(?:\|([^}]+))?\}/g, (_, key, pair) => {
    const n = nums[key];
    if (!pair) return n;
    const [open, closed] = pair.split("/");
    return n + (HAS_FINAL.includes(n.at(-1)) ? closed : open);
  });
}

function setAll(selector, value) {
  $$(selector).forEach((el) => (el.textContent = value));
}

// 쪽이 바뀌면 앞 쪽에서 걸어 둔 예약은 버린다.
function later(token, ms, fn) {
  setTimeout(() => {
    if (token === state.turn) fn();
  }, ms);
}

/* ---------- 전송 사진 ---------- */

const PW = 360;
const PH = 210;
const PAPER = [0xf2, 0xf0, 0xea];
const INK = [0x1b, 0x1b, 0x1b];
// 캔버스 대체 텍스트. 실제로 걸린 그림을 설명한다(방 사진이 없어 복도 그림이 걸리면 복도 설명).
// 방 여섯은 art-prompts/house-20260922.md의 방 사진과 같은 것을 적는다.
const LABELS = {
  door: "전송 사진. 창문 없는 복도 끝에 문패 없는 검은 문이 있다.",
  house: "전송 사진. 오래된 아파트의 집 안.",
  hall: "전송 사진. 현관. 바닥에 신발이 가지런하고 신발장 위에 우편물이 쌓여 있다.",
  living: "전송 사진. 거실. 소파 맞은편에 꺼진 텔레비전이 있고 벽에 둥근 시계가 걸려 있다.",
  kitchen: "전송 사진. 부엌. 식탁 위에 밥 한 공기가 있고 의자들이 뒤로 빠져 있다.",
  bath: "전송 사진. 욕실. 젖은 타일 바닥 너머로 세면대와 칫솔 컵이 보인다.",
  master: "전송 사진. 불 꺼진 안방. 침대에 이불이 개어져 있고 커튼이 반쯤 쳐져 있다.",
  small: "전송 사진. 작은방. 책상 위에 라디오가 있고 책장에 인형들이 앉아 있다.",
  sikgu: "전송 사진. 문간에 사람 같은 것이 서 있다. 팔꿈치와 무릎이 반대로 꺾여 있다.",
  "master-door": "전송 사진. 불 꺼진 안방. 옷장 옆 벽에 방문이 하나 더 나 있다.",
  // 클로즈업은 무엇을 찍었는지만 적는다. 틀린 것은 글이 알려 준다.
  "thing-shoes": "전송 사진. 현관 바닥의 신발들을 가까이 찍었다.",
  "thing-light": "전송 사진. 현관 천장의 센서등을 가까이 찍었다.",
  "thing-clock": "전송 사진. 거실 벽시계를 가까이 찍었다.",
  "thing-photo": "전송 사진. 텔레비전 위 가족사진을 가까이 찍었다.",
  "thing-rice": "전송 사진. 식탁 위 밥공기를 가까이 찍었다.",
  "thing-calendar": "전송 사진. 냉장고 문의 달력을 가까이 찍었다.",
  "thing-faucet": "전송 사진. 세면대와 수도꼭지를 가까이 찍었다.",
  "thing-brushes": "전송 사진. 세면대 위 칫솔 컵을 가까이 찍었다.",
  "thing-blanket": "전송 사진. 침대 발치에 개어 둔 이불을 가까이 찍었다.",
  "thing-switch": "전송 사진. 안방 문 옆 스위치를 가까이 찍었다.",
  "thing-dolls": "전송 사진. 책장 위 인형들을 가까이 찍었다.",
  "thing-radio": "전송 사진. 책상 위 라디오를 가까이 찍었다.",
  "target-glasses": "전송 사진. 안경을 가까이 찍었다.",
  "target-seal": "전송 사진. 나무 도장을 가까이 찍었다.",
  "target-comb": "전송 사진. 머리빗을 가까이 찍었다.",
};
const LABEL_MIRROR = " 좌우가 뒤집혀 찍혔다.";

// 대표 그림이 오기 전까지 쓰는 복도 그림. 360×210 좌표로 그려 사진처럼 맞춰 넣는다.
function drawCorridor(ctx) {
  const vx = PW * 0.5;
  const vy = PH * 0.47;
  const g = ctx.createLinearGradient(0, 0, 0, PH);
  g.addColorStop(0, "#9a9a9a");
  g.addColorStop(1, "#6a6a6a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PW, PH);

  const dw = 58;
  const dh = 104;
  const dx = vx - dw / 2;
  const dy = vy - dh * 0.46;

  // 천장
  ctx.fillStyle = "#b8b8b8";
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(PW, 0); ctx.lineTo(dx + dw + 30, dy - 16); ctx.lineTo(dx - 30, dy - 16);
  ctx.closePath(); ctx.fill();
  // 바닥
  const fg = ctx.createLinearGradient(0, dy + dh, 0, PH);
  fg.addColorStop(0, "#5c5c5c");
  fg.addColorStop(1, "#8e8e8e");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(0, PH); ctx.lineTo(PW, PH); ctx.lineTo(dx + dw + 30, dy + dh + 6); ctx.lineTo(dx - 30, dy + dh + 6);
  ctx.closePath(); ctx.fill();
  // 왼쪽 벽
  const lw = ctx.createLinearGradient(0, 0, dx, 0);
  lw.addColorStop(0, "#4a4a4a");
  lw.addColorStop(1, "#7c7c7c");
  ctx.fillStyle = lw;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(dx - 30, dy - 16); ctx.lineTo(dx - 30, dy + dh + 6); ctx.lineTo(0, PH);
  ctx.closePath(); ctx.fill();
  // 오른쪽 벽
  const rw = ctx.createLinearGradient(PW, 0, dx + dw, 0);
  rw.addColorStop(0, "#a4a4a4");
  rw.addColorStop(1, "#838383");
  ctx.fillStyle = rw;
  ctx.beginPath();
  ctx.moveTo(PW, 0); ctx.lineTo(dx + dw + 30, dy - 16); ctx.lineTo(dx + dw + 30, dy + dh + 6); ctx.lineTo(PW, PH);
  ctx.closePath(); ctx.fill();
  // 복도 끝 벽
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(dx - 30, dy - 16, dw + 60, dh + 22);
  // 형광등
  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.moveTo(vx - 40, 10); ctx.lineTo(vx + 40, 10); ctx.lineTo(vx + 22, 26); ctx.lineTo(vx - 22, 26);
  ctx.closePath(); ctx.fill();
  const glow = ctx.createRadialGradient(vx, 22, 4, vx, 22, 120);
  glow.addColorStop(0, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, PW, PH);
  // 문틀과 문
  ctx.fillStyle = "#c9c9c9";
  ctx.fillRect(dx - 5, dy - 5, dw + 10, dh + 5);
  ctx.fillStyle = "#070707";
  ctx.fillRect(dx, dy, dw, dh);
  // 문틈의 빛
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(dx + 2, dy + dh - 2, dw - 4, 1.4);
  // 손잡이
  ctx.fillStyle = "#6f6f6f";
  ctx.fillRect(dx + dw - 12, dy + dh * 0.55, 6, 2.5);
  // 문패 떼어 낸 못 자국
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(vx - 9, dy - 16, 2, 2);
  ctx.fillRect(vx + 7, dy - 16, 2, 2);
  // 바닥 타일 줄
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(vx + i * 8, dy + dh + 6);
    ctx.lineTo(vx + i * 70, PH);
    ctx.stroke();
  }
}

const CORRIDOR = (() => {
  const c = document.createElement("canvas");
  c.width = PW;
  c.height = PH;
  drawCorridor(c.getContext("2d"));
  return c;
})();

// 식구 그림이 오기 전까지 쓰는 임시 그림. 어두운 문간에 선 형체의 팔꿈치와 무릎이 반대로 꺾였고, 손가락이 여섯이다.
function drawSikgu(ctx) {
  ctx.fillStyle = "#262626";
  ctx.fillRect(0, 0, PW, PH);
  const door = ctx.createLinearGradient(0, 0, 0, PH);
  door.addColorStop(0, "#9a9a9a");
  door.addColorStop(1, "#5e5e5e");
  ctx.fillStyle = door;
  ctx.fillRect(PW * 0.36, 10, PW * 0.28, PH - 10);
  const cx = PW / 2;
  const seg = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  ctx.fillStyle = "#e2e2e2";
  ctx.strokeStyle = "#e2e2e2";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(cx, 42, 12, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - 13, 58, 26, 62);
  // 팔꿈치는 바깥으로, 무릎은 뒤로 꺾였다
  ctx.lineWidth = 7;
  seg(cx - 13, 64, cx - 40, 88); seg(cx - 40, 88, cx - 24, 122);
  seg(cx + 13, 64, cx + 40, 88); seg(cx + 40, 88, cx + 24, 122);
  seg(cx - 8, 120, cx - 2, 158); seg(cx - 2, 158, cx - 16, 198);
  seg(cx + 8, 120, cx + 2, 158); seg(cx + 2, 158, cx + 16, 198);
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    seg(cx - 24, 122, cx - 32 + i * 3, 134);
    seg(cx + 24, 122, cx + 16 + i * 3, 134);
  }
  // 눈 자리 없이 입이 둘
  ctx.fillStyle = "#141414";
  ctx.fillRect(cx - 5, 47, 10, 2);
  ctx.fillRect(cx - 4, 54, 8, 2);
}

const SIKGU = (() => {
  const c = document.createElement("canvas");
  c.width = PW;
  c.height = PH;
  drawSikgu(c.getContext("2d"));
  return c;
})();

// 장면마다 쓰는 그림. art/에 사용자가 뽑은 사진이 있으면 그것을, 없으면 임시 그림을 쓴다.
// 장면은 복도(door), 방 여섯(hall~small, 방 id 그대로), 식구(sikgu)다. 방 사진이 아직 없으면
// 예전의 집 안 한 장(house), 그것도 없으면 문 사진, 그것도 없으면 복도 임시 그림으로 떨어진다.
const ROOMS = Object.keys(HOUSE.rooms);
// 식구는 프레임 넉 장(sikgu-1~4)을 읽고, 없으면 예전 한 장(sikgu)을 쓴다.
const ART_FILES = {
  door: "black-door",
  house: "house",
  sikgu: "sikgu",
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`sikgu-${i}`, `sikgu-${i}`])),
  ...Object.fromEntries(ROOMS.map((r) => [r, r])),
};
// 클로즈업(2026-09-23 사용자 결정). 물건 걸음이 찍히면 판이 그 물건을 가까이 찍은 그림을 받는다.
// thing-<id>는 제대로일 때, thing-<id>-odd는 틀렸을 때 눈에 보이게 다른 그림이다. -odd가 없으면(감각이 빠진
// 물건) 같은 그림을 쓴다. thing-<id>-1~4가 있으면 1초마다 바꿔 끼우는 프레임이고(시계 초침), 틀리면 거꾸로 돈다.
// target-<id>, target-<id>-fake는 채취물의 진짜와 가짜다. <방>-<id>는 하나가 더 있는 장소 변이가 나타난 방이다.
// 새 그림은 전부 도트 PNG라 png만 찾는다.
const CLOSE_FILES = [
  ...HOUSE.things.filter((t) => !t.space).flatMap((t) => [`thing-${t.id}`, `thing-${t.id}-odd`, ...[1, 2, 3, 4].map((i) => `thing-${t.id}-${i}`)]),
  ...HOUSE.targets.flatMap((t) => [`target-${t.id}`, `target-${t.id}-fake`]),
  ...HOUSE.things.filter((t) => t.space && t.kind === "extra").map((t) => `${t.room}-${t.id}`),
];
const art = Object.fromEntries([...Object.keys(ART_FILES), ...CLOSE_FILES].map((k) => [k, null]));
// 원고는 [그림, 파일 이름, 그림 키]다. 키는 art의 키(또는 임시 그림이면 door·sikgu)이고 대체 텍스트를 고른다.
const drawnFor = (scene) => (scene === "sikgu" ? [SIKGU, null, "sikgu"] : [CORRIDOR, null, "door"]);

function sourceFor(scene, variant = null) {
  const room = ROOMS.includes(scene) ? [scene, "house", "door"] : null;
  const chain = room ? (variant ? [`${scene}-${variant}`, ...room] : room) : scene === "sikgu" ? ["sikgu-1", "sikgu"] : [scene];
  const key = chain.find((k) => art[k]);
  return key ? [art[key].img, art[key].name, key] : drawnFor(scene);
}

// 식구 프레임. art/sikgu-1부터 이어서 있는 만큼(최대 넉 장) 쓰고, sikgu-1이 없으면 한 장뿐이다.
// 첫 프레임은 점프스케어에도 쓰인다(scareIn이 sourceFor("sikgu")를 쓴다).
function sikguFrames() {
  const frames = [];
  for (let i = 1; i <= 4 && art[`sikgu-${i}`]; i++) frames.push([art[`sikgu-${i}`].img, art[`sikgu-${i}`].name, `sikgu-${i}`]);
  return frames.length ? frames : [sourceFor("sikgu")];
}

const isClose = (scene) => /^(thing|target)-/.test(scene);
const closeBase = (key) => key.replace(/-(odd|fake)$/, "");

// 클로즈업 원고 목록. 프레임이 있으면 프레임을, 없으면 틀린 그림, 그것도 없으면 제대로인 그림을 쓴다.
// 틀린 시계는 같은 프레임을 거꾸로 돌린다. 하나도 없으면 null이고, 판은 방 사진 그대로 둔다.
function closeFrames(key) {
  const base = closeBase(key);
  const frames = [];
  for (let i = 1; i <= 4 && art[`${base}-${i}`]; i++) frames.push([art[`${base}-${i}`].img, art[`${base}-${i}`].name, base]);
  if (frames.length) return key === base ? frames : [frames[0], ...frames.slice(1).reverse()];
  const hit = [key, base].find((k) => art[k]);
  return hit ? [[art[hit].img, art[hit].name, hit]] : null;
}

// 장면에 걸 원고 목록. 프레임이 여럿인 장면은 식구와 초침이 도는 클로즈업이다.
const framesFor = (scene, variant = null) =>
  scene === "sikgu" ? sikguFrames() : isClose(scene) ? closeFrames(scene) || [sourceFor("door")] : [sourceFor(scene, variant)];

function drawCover(ctx, src, w, h) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  const s = Math.max(w / sw, h / sh);
  ctx.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
}

// 사진을 팩스 원고로 만드는 곡선. 양끝 0.5%를 잘라 명암을 펴고, 윤곽을 조금 세운 뒤 감마와 대비를 건다.
const TONE = { clip: 0.005, sharpen: 0.7, gamma: 1, contrast: 1.2, noise: 0.025 };

// 팩스는 흑백 1비트다. 지그재그로 훑는 플로이드-스타인버그 디더로 회색을 점으로 바꾼다.
// 원본이 캔버스를 오염시키면 getImageData가 던지고, 부르는 쪽이 복도 그림으로 돌아간다.
// mirror면 원고를 좌우로 뒤집어 놓고 디더한다(뒤집힌 방). 점과 전송 흠은 뒤집지 않는다.
function ditherBits(src, gw, gh, mirror = false) {
  const off = document.createElement("canvas");
  off.width = gw;
  off.height = gh;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, gw, gh);
  if (mirror) {
    ctx.translate(gw, 0);
    ctx.scale(-1, 1);
  }
  drawCover(ctx, src, gw, gh);
  const { data } = ctx.getImageData(0, 0, gw, gh);

  const n = gw * gh;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = v / 255;
    hist[Math.min(255, Math.round(v))]++;
  }

  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * TONE.clip; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * TONE.clip; hi--);
  const span = Math.max(1, hi - lo) / 255;
  const base = lo / 255;

  let src2 = lum;
  if (TONE.sharpen) {
    // 3×3 평균과의 차이를 더해 윤곽을 세운다
    src2 = new Float32Array(n);
    for (let y = 0; y < gh; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(gh - 1, y + 1);
      for (let x = 0; x < gw; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(gw - 1, x + 1);
        let sum = 0;
        let cnt = 0;
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            sum += lum[yy * gw + xx];
            cnt++;
          }
        }
        const i = y * gw + x;
        src2[i] = lum[i] + TONE.sharpen * (lum[i] - sum / cnt);
      }
    }
  }

  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = Math.min(1, Math.max(0, (src2[i] - base) / span));
    if (TONE.gamma !== 1) v = Math.pow(v, TONE.gamma);
    v = (v - 0.5) * TONE.contrast + 0.5 + (Math.random() - 0.5) * 2 * TONE.noise;
    buf[i] = Math.min(1, Math.max(0, v));
  }

  const out = new Uint8Array(n);
  for (let y = 0; y < gh; y++) {
    const ltr = y % 2 === 0;
    const dir = ltr ? 1 : -1;
    for (let k = 0; k < gw; k++) {
      const x = ltr ? k : gw - 1 - k;
      const i = y * gw + x;
      const old = buf[i];
      const nv = old < 0.5 ? 0 : 1;
      out[i] = nv;
      const err = old - nv;
      const xf = x + dir;
      const xb = x - dir;
      if (xf >= 0 && xf < gw) buf[i + dir] += (err * 7) / 16;
      if (y + 1 < gh) {
        if (xb >= 0 && xb < gw) buf[i + gw - dir] += (err * 3) / 16;
        buf[i + gw] += (err * 5) / 16;
        if (xf >= 0 && xf < gw) buf[i + gw + dir] += err / 16;
      }
    }
  }
  return out;
}

// 전송 중에 생긴 흠. 몇 줄이 옆으로 밀려 오고, 한 줄은 중간이 비어서 온다.
// rng는 장면을 새로 받을 때 plate.seed로 고정된다. 크기만 바뀌어 다시 그릴 때는 같은 시드로
// 같은 rng를 새로 만들어 쓰므로(receive 참고) 자리가 그대로다. 새 사본이나 새 장면에서만 달라진다.
// 도트 원고에도 같은 흠을 낸다. 그때 bits는 픽셀 하나가 칸 하나인 Uint32Array이고 blank는 종이색 픽셀이다.
function scarBits(bits, gw, gh, rng, blank = 1) {
  const bands = 2 + Math.floor(rng() * 2);
  for (let k = 0; k < bands; k++) {
    const y = Math.floor(gh * (0.1 + rng() * 0.8));
    const h = 1 + Math.floor(rng() * 2);
    const shift = (rng() < 0.5 ? -1 : 1) * (3 + Math.floor(rng() * 7));
    for (let yy = y; yy < Math.min(gh, y + h); yy++) {
      const row = bits.slice(yy * gw, yy * gw + gw);
      for (let x = 0; x < gw; x++) bits[yy * gw + x] = row[(x - shift + gw) % gw];
    }
  }
  const y = Math.floor(gh * (0.2 + rng() * 0.6));
  const x0 = Math.floor(gw * rng() * 0.5);
  const len = Math.floor(gw * (0.2 + rng() * 0.4));
  for (let x = x0; x < Math.min(gw, x0 + len); x++) bits[y * gw + x] = blank;
}

// 전송 흠 시드를 뽑는 자리. 게임 진행에 쓰는 state.rng와는 다른 줄기라, 판을 다시 그려도
// 집 안 배치나 쪽 내용에 영향을 주지 않는다.
const plateSeedRng = makeRng(SEED ^ 0x9e3779b1);

const plate = {
  box: $(".js-plate-box"),
  canvas: $(".js-plate"),
  note: $(".js-plate-note"),
  scene: "door",
  variant: null, // 방 사진의 변형(<방>-<id>). 없던 방문이 난 안방 같은 것
  ticker: 0, // 클로즈업 프레임을 1초마다 바꾸는 타이머
  mirror: false,
  frames: null, // 원고([그림, 파일 이름, 그림 키])의 목록. 식구 장면만 여러 장이다.
  frame: 1, // 지금 그린 프레임, 1부터
  cache: null, // { key: `${gw}x${gh}`, frames: 디더한 캔버스 목록 }. 원고나 판 크기가 바뀌면 버린다.
  source: null, // 첫 프레임의 그림. 프레임을 바꿔 끼워도 그대로다.
  name: null,
  run: 0,
  seed: SEED, // setScene이 실제로 장면을 받을 때까지 쓰는 기본값
  cssW: 0,
  cssH: 0,
};

if (DEBUG) window.__game.plate = plate;

// 첫 프레임과 캡션, 대체 텍스트. 원고를 거는 setFrames만 부른다. 파일 이름은 캡션에만 적고,
// 대체 텍스트는 그림 키로 고른 설명이다. 식구 프레임 넷(sikgu-1~4)은 식구 설명 하나를 같이 쓴다.
function setSource(src, name, key) {
  plate.source = src;
  plate.name = name;
  plate.note.textContent = name ? `원본: ${name}` : "전송 사진 · 임시 그림";
  const label = LABELS[key.startsWith("sikgu") ? "sikgu" : key] || LABELS[closeBase(key)] || LABELS.door;
  plate.canvas.setAttribute("aria-label", label + (plate.mirror ? LABEL_MIRROR : ""));
}

// 장면(door 복도, 방 여섯, sikgu 식구)이 바뀔 때만 그림을 새로 받는다. 방을 옮기면 그 방 사진을
// 받고, 같은 방에 머물면 받지 않는다. 뒤집힌 방은 같은 사진을 좌우로 뒤집어 받는데, 머무는 사이
// 방이 뒤집히면(mirror만 바뀌면) 그것도 새로 받는다.
// 전송 흠의 시드도 여기서만 새로 뽑는다. 크기가 바뀌어 다시 그릴 때는 이 시드를 그대로 쓴다.
// 식구 장면은 예외가 하나 있다. 기한이 줄 때마다 프레임을 바꿔 끼운다(stepFrame).
function setScene(scene, animate, mirror = false, variant = null) {
  if (plate.scene === scene && plate.mirror === mirror && plate.variant === variant && plate.source) return;
  plate.scene = scene;
  plate.mirror = mirror;
  plate.variant = variant;
  plate.seed = Math.floor(plateSeedRng() * 0xffffffff);
  setFrames(framesFor(scene, variant));
  paintPlate(animate);
}

// 물건 걸음이 찍힐 때 그 물건의 클로즈업을 받는다. 그림이 없으면 판을 그대로 둔다.
function showShot(shot) {
  const key = shot.kind === "thing" ? `thing-${shot.id}${shot.wrong ? "-odd" : ""}` : `target-${shot.id}${shot.fake ? "-fake" : ""}`;
  if (closeFrames(key)) setScene(key, true);
}

// 그림 판에 걸 원고 목록을 바꾼다. 디더 캐시는 원고가 바뀔 때 버린다.
// 클로즈업에 프레임이 여럿이면(시계) 1초마다 다음 프레임을 한 번에 끼운다. 기한과 상관없이 돈다.
// 움직임 줄이기에서는 첫 프레임에 멈춘다.
function setFrames(frames) {
  plate.frames = frames;
  plate.frame = 1;
  plate.cache = null;
  clearInterval(plate.ticker);
  if (isClose(plate.scene) && frames.length > 1 && !reduced) {
    plate.ticker = setInterval(() => {
      plate.frame = (plate.frame % plate.frames.length) + 1;
      paintPlate(false);
    }, 1000);
  }
  setSource(...frames[0]);
}

// 식구 쪽에서 기한이 한 초 줄 때마다 다음 프레임을 한 번에 끼운다. 한 줄씩 수신하지 않는다.
// 5초 기한이 4·3·2초로 줄 때 프레임 2·3·4, 1초는 4에서 멈춘다. 프레임이 한 장이면 아무것도 안 한다.
// 움직임 줄이기에서는 첫 프레임에 멈춘다. 캡션과 plate.source는 첫 프레임 그대로 둔다.
// 프레임 번호가 캡션에 드러나지 않게 하고, 그림 읽기가 늦게 끝나도(refreshArt) 되감지 않게 하려는 것이다.
function stepFrame(spent) {
  if (reduced || plate.scene !== "sikgu" || !plate.frames || plate.frames.length < 2) return;
  const n = Math.min(plate.frames.length, 1 + spent);
  if (n === plate.frame) return;
  plate.frame = n;
  paintPlate(false);
}

// 1비트 점을 감열지와 토너 두 색의 캔버스로 옮긴다.
function bitsCanvas(bits, gw, gh) {
  const off = document.createElement("canvas");
  off.width = gw;
  off.height = gh;
  const octx = off.getContext("2d");
  const img = octx.createImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) {
    const c = bits[i] ? PAPER : INK;
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return off;
}

// 도트 원고는 이미 흑백 몇 단으로 찍혀 있어서 디더하지 않는다. 폭이 이 값 이하면 도트로 본다(방 그림은 240×135).
const PIXEL_ART_MAX_W = 320;
const isPixelArt = (src) => (src.naturalWidth || src.width) <= PIXEL_ART_MAX_W && src instanceof HTMLImageElement;

// 도트 원고를 원본 크기 그대로 옮기고 전송 흠만 얹는다. 뒤집힌 방이면 좌우로 뒤집는다.
function receivePixels(src) {
  const sw = src.naturalWidth;
  const sh = src.naturalHeight;
  const off = document.createElement("canvas");
  off.width = sw;
  off.height = sh;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (plate.mirror) {
    ctx.translate(sw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, sw, sh);
  const px = new Uint32Array(img.data.buffer);
  const blank = new Uint32Array(new Uint8ClampedArray([...PAPER, 255]).buffer)[0];
  scarBits(px, sw, sh, makeRng(plate.seed), blank);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  return off;
}

// 원고 한 장을 판 크기로 디더하고 전송 흠을 얹어 캔버스로 만든다. 도트 원고는 디더하지 않는다.
// 흠은 plate.seed로만 뽑으니, 같은 장면이면 프레임이 바뀌어도 크기가 바뀌어도 자리가 같다.
function receive(src, gw, gh) {
  if (isPixelArt(src)) return receivePixels(src);
  const bits = ditherBits(src, gw, gh, plate.mirror);
  scarBits(bits, gw, gh, makeRng(plate.seed));
  return bitsCanvas(bits, gw, gh);
}

// 지금 프레임의 점 캔버스. 프레임마다 판 크기별로 한 번만 디더한다.
// 식구 장면은 기한이 줄 때 곧바로 바꿔 끼울 수 있게 처음 그릴 때 프레임을 전부 만들어 둔다.
// 움직임 줄이기에서는 첫 프레임만 쓰니 그것만 만든다.
function plateCanvas(gw, gh) {
  const key = `${gw}x${gh}`;
  if (!plate.cache || plate.cache.key !== key) plate.cache = { key, frames: [] };
  plate.frames.forEach(([src], i) => {
    if (plate.cache.frames[i] || (reduced && i !== plate.frame - 1)) return;
    plate.cache.frames[i] = receive(src, gw, gh);
  });
  return plate.cache.frames[plate.frame - 1];
}

// 캔버스 픽셀을 기기 픽셀에 맞추고 원고를 창 크기에 맞춘 배율로 그린다(plateLayout).
function paintPlate(animate) {
  const { canvas } = plate;
  if (!plate.source) return;
  const r = canvas.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(r.width * dpr);
  const H = Math.round(r.height * dpr);
  const run = ++plate.run;

  // 원본이 캔버스를 오염시키면(file://) 디더가 던지고, 임시 그림 한 장으로 돌아간다.
  let lay = plateLayout(W, H);
  let off;
  try {
    off = plateCanvas(lay.gw, lay.gh);
  } catch {
    const lost = plate.name;
    setFrames([drawnFor(plate.scene)]);
    document.body.classList.add("is-debug");
    if (lost) plate.note.textContent = `임시 그림 · ${lost}: file://로 열면 못 읽음, 사진 바꾸기로 넣기`;
    lay = plateLayout(W, H);
    off = plateCanvas(lay.gw, lay.gh);
  }
  const { gw, gh, k, ox, oy, pixel } = lay;

  canvas.width = W;
  canvas.height = H;
  plate.cssW = r.width;
  plate.cssH = r.height;
  const ctx = canvas.getContext("2d");
  // 원본보다 작게 그릴 때만 보간한다. 점을 건너뛰면 디더 무늬가 깨진다.
  ctx.imageSmoothingEnabled = k < 1;
  // 도트 원고가 판을 다 덮지 못한 자리는 종이다.
  ctx.fillStyle = `rgb(${PAPER.join(",")})`;
  if (ox > 0 || oy > 0) ctx.fillRect(0, 0, W, H);

  if (!animate || reduced) {
    ctx.drawImage(off, ox, oy, gw * k, gh * k);
    return;
  }

  // 위에서 아래로 한 줄씩 수신된다. 대략 0.9초. 도트 원고는 여백이 끝까지 남으니 종이색으로 깐다.
  ctx.fillStyle = pixel ? `rgb(${PAPER.join(",")})` : "#e6e4dd";
  ctx.fillRect(0, 0, W, H);
  const perFrame = Math.max(1, Math.ceil(gh / 54));
  let row = 0;
  const step = () => {
    if (run !== plate.run) return;
    const next = Math.min(gh, row + perFrame);
    ctx.drawImage(off, 0, row, gw, next - row, ox, oy + row * k, gw * k, (next - row) * k);
    row = next;
    if (row < gh) {
      ctx.fillStyle = "#1b1b1b";
      ctx.fillRect(0, oy + row * k, W, Math.max(2, Math.round(dpr * 2)));
      requestAnimationFrame(step);
    } else {
      // 배율이 정수가 아니면 줄 경계에 수신 막대 자국이 남는다. 다 받으면 한 번에 다시 그린다.
      ctx.drawImage(off, ox, oy, gw * k, gh * k);
    }
  };
  requestAnimationFrame(step);
}

// 판에 원고를 놓는 자리. 사진은 판 절반 해상도로 디더해 두 배로 그린다(점 하나가 기기 픽셀 2×2).
// 도트 원고는 창 크기에 맞춰 판 안에 통째로 들어가는 배율로 키워 가운데에 놓는다
// (2026-09-23 사용자 결정). 잘리는 곳이 없고 남는 자리는 종이다. 배율은 정수가 아닐 수 있다.
function plateLayout(W, H) {
  const src = plate.frames[plate.frame - 1][0];
  if (!isPixelArt(src)) return { gw: Math.ceil(W / 2), gh: Math.ceil(H / 2), k: 2, ox: 0, oy: 0, pixel: false };
  const gw = src.naturalWidth;
  const gh = src.naturalHeight;
  const k = Math.min(W / gw, H / gh);
  return { gw, gh, k, ox: Math.round((W - gw * k) / 2), oy: Math.round((H - gh * k) / 2), pixel: true };
}

// 그림을 다 읽은 뒤, 지금 장면에 걸린 원고 목록이 달라졌으면 다시 받는다. 목록이 같으면
// 식구 카운트다운 중이라도 지금 프레임을 그대로 둔다.
function refreshArt() {
  const frames = framesFor(plate.scene, plate.variant);
  const same = plate.frames && frames.length === plate.frames.length && frames.every(([src], i) => src === plate.frames[i][0]);
  if (same) return;
  setFrames(frames);
  paintPlate(true);
}

// art/<stem>.png|jpg|webp 중 먼저 있는 것을 읽는다.
function loadArt(stem, exts = ["png", "jpg", "webp"]) {
  const names = exts.map((ext) => `${stem}.${ext}`);
  return new Promise((resolve) => {
    const next = () => {
      const name = names.shift();
      if (!name) return resolve(null);
      const img = new Image();
      img.onload = () => resolve({ img, name: `art/${name}` });
      img.onerror = next;
      img.src = `art/${name}`;
    };
    next();
  });
}

// data URL로 읽으면 file://에서도 캔버스가 오염되지 않는다. 고른 사진은 지금 장면의 그림이 된다.
function readPlateFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    plate.note.textContent = `그림 파일만 받습니다 · ${file.name}`;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // 식구 장면에서 올린 사진은 art.sikgu에 들어가서, sikgu-1~4가 있으면 다음 식구 장면부터는
      // 그 넉 장이 앞선다. 지금 장면을 바로 바꿔 보는 디버그 도구라 그대로 둔다.
      art[plate.scene] = { img, name: file.name };
      setFrames([[img, file.name, plate.scene]]);
      paintPlate(true);
    };
    img.onerror = () => (plate.note.textContent = `읽지 못한 파일 · ${file.name}`);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// 도트 식구는 디더하지 않고 화면을 덮는 정수 배율에 맞춘 원본 해상도 캔버스로 넘긴다.
// 화면 비율만큼 잘라 두면 scare가 화면 크기로 늘일 때 배율이 정수에 가깝게 유지된다.
function scarePixels(src) {
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth * dpr;
  const H = innerHeight * dpr;
  const k = Math.max(1, Math.round(Math.max(W / src.naturalWidth, H / src.naturalHeight)));
  const off = document.createElement("canvas");
  off.width = Math.ceil(W / k);
  off.height = Math.ceil(H / k);
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = `rgb(${INK.join(",")})`;
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(src, Math.floor((off.width - src.naturalWidth) / 2), Math.floor((off.height - src.naturalHeight) / 2));
  const img = ctx.getImageData(0, 0, off.width, off.height);
  const blank = new Uint32Array(new Uint8ClampedArray([...PAPER, 255]).buffer)[0];
  scarBits(new Uint32Array(img.data.buffer), off.width, off.height, Math.random, blank);
  ctx.putImageData(img, 0, 0);
  return off;
}

// 식구 사진을 화면 전체 크기로 디더해 점프스케어에 넘긴다. 점 하나가 기기 픽셀 4×4라 거칠다.
async function scareIn() {
  const dpr = window.devicePixelRatio || 1;
  const gw = Math.ceil((innerWidth * dpr) / 4);
  const gh = Math.ceil((innerHeight * dpr) / 4);
  const src = sourceFor("sikgu")[0];
  if (isPixelArt(src)) {
    await scare({ sheet: $(".sheet--rx"), image: scarePixels(src), target: plate.canvas.getBoundingClientRect() });
    return;
  }
  let bits;
  try {
    bits = ditherBits(src, gw, gh);
  } catch {
    bits = ditherBits(SIKGU, gw, gh);
  }
  scarBits(bits, gw, gh, Math.random); // 한 번 쓰고 버리는 그림이라 매번 새 자리면 된다
  await scare({ sheet: $(".sheet--rx"), image: bitsCanvas(bits, gw, gh), target: plate.canvas.getBoundingClientRect() });
}

/* ---------- 쪽 ---------- */

const DERANGE_FROM = 9; // 집이 온통 틀려지는 쪽부터 독백이 가끔 더듬는다

// 글이 정해진 높이를 넘으면 글자만 반 픽셀씩 줄인다.
function fitPage(body) {
  body.style.fontSize = "";
  let size = parseFloat(getComputedStyle(body).fontSize);
  while (body.scrollHeight > body.clientHeight + 1 && size > 13) {
    size -= 0.5;
    body.style.fontSize = `${size}px`;
  }
}

function printIn(el, delay) {
  el.classList.remove("print-line");
  void el.offsetWidth;
  el.style.setProperty("--d", `${delay}ms`);
  el.classList.add("print-line");
}

// 깨진 조각을 문단에 옮긴다. 찍히는 모양이 바뀐 조각만 <span class="g-bold·g-mirror·g-fade·g-ghost">로 감싸고 나머지는 글자 그대로다.
function paintGarble(p, pieces) {
  p.replaceChildren(
    ...pieces.map((s) => {
      if (!s.fx) return document.createTextNode(s.t);
      const span = document.createElement("span");
      span.className = `g-${s.fx}`;
      span.textContent = s.t;
      return span;
    })
  );
}

function choiceButton(choice, i) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "choice";
  b.dataset.i = i;
  b.innerHTML =
    '<span class="choice-box" aria-hidden="true"><svg viewBox="0 0 36 34"><path d="M6 17 L14 26 L31 4"/></svg></span><span class="choice-text"></span>';
  b.querySelector(".choice-text").textContent = fill(choice.text);
  return b;
}

function renderCells(n) {
  const cells = $(".js-cells");
  cells.replaceChildren(
    ...Array.from({ length: n }, () => {
      const c = document.createElement("span");
      c.className = "cell";
      return c;
    })
  );
}

function idleDeadline(n) {
  clearInterval(state.timer);
  state.limit = n;
  const dl = $(".js-deadline");
  dl.classList.remove("is-frozen");
  dl.classList.add("is-idle");
  renderCells(n);
  $(".js-secs").textContent = n;
}

// 끝 장에서는 응답한 순간의 칸과 남은 초를 그대로 둔다.
function freezeDeadline() {
  clearInterval(state.timer);
  const dl = $(".js-deadline");
  dl.classList.remove("is-idle");
  dl.classList.add("is-frozen");
}

// 새 사본이 들어갈 집을 받는다. ?seed=로 열면 사본 번호까지 같을 때 같은 집이 나온다.
function startCopy() {
  state.heads = [];
  state.rng = makeRng(SEED + state.clone);
  state.house = makeHouse(HOUSE, state.rng);
  state.run = newRun();
}

function show(animatePlate = true) {
  if (state.run.over) return renderEnd(state.run.over);
  renderSheet(pageOf(HOUSE, state.house, state.run, state.rng), animatePlate);
}

// 쪽은 덩이 하나씩 찍힌다. 덩이 사이에는 화살표 버튼만 있고, 이 동안에는 시간이 가지 않는다.
function renderSheet(sheet, animatePlate = true) {
  const token = ++state.turn;
  state.sheet = sheet;
  state.shown = 0;
  state.place = sheet.place;
  if (DEBUG) window.__sheet = sheet;
  setAll(".js-place", state.place);
  setAll(".js-page", state.page);
  setAll(".js-clock", clock());
  miscopy();
  logHead();
  idleDeadline(sheet.deadline || DEADLINE);
  setScene(sheet.scene, animatePlate, Boolean(sheet.mirror), sheet.variant || null);
  bgm.mood(sheet.special === "sikgu" ? "sikgu" : "house", state.page);
  bleed($(".sheet--rx"), state.page);
  // 독백이 더듬는 덩이. 식구 앞에서는 두 덩이, 아주 깊은 쪽에서는 가끔 한 덩이다. 칩이 잘라 먹을 덩이는 고르지 않는다.
  const shaken = sheet.special === "sikgu" ? 2 : state.page >= DERANGE_FROM && Math.random() < 0.5 ? 1 : 0;
  const pick = shuffle(Math.random, [...sheet.chunks.keys()].slice(0, sheet.cut)).slice(0, shaken);
  state.moods = sheet.chunks.map((_, i) => (pick.includes(i) ? 1 : 0));
  $(".js-page-body").replaceChildren();
  const act = $(".act");
  act.classList.remove("is-end");
  act.classList.add("is-reading");
  $(".js-end").hidden = true;
  $(".js-choices").disabled = true;
  $(".js-choice-list").replaceChildren();
  $(".js-more").hidden = false;
  showChunk(token);
}

function showChunk(token) {
  const body = $(".js-page-body");
  const p = document.createElement("p");
  paintGarble(p, garble(fill(state.sheet.chunks[state.shown]), Math.random, state.moods[state.shown]));
  body.append(p);
  const shot = state.sheet.shots && state.sheet.shots[state.shown];
  if (shot) showShot(shot);
  state.shown += 1;
  fitPage(body);
  markMore();
  printIn(p, 0);
  const more = $(".js-more");
  more.disabled = true;
  later(token, T.line, () => {
    more.disabled = false;
    if (state.keyboard) more.focus({ preventScroll: true });
  });
}

// 화살표가 지금 무엇을 하는 단추인지 대체 텍스트로 밝힌다. 덩이가 남았으면 한 걸음 더 들여다보는 것이고,
// 복도에서는 문을 여는 것이고, 다 봤으면 칩이 끼어든다. 버튼 안에 보이는 글자는 두지 않는다(2026-09-22 사용자 결정).
// 이름은 집 안을 걷는 사람 쪽 동사로 쓴다. 본부 쪽 동사를 쓰면 보고서를 넘겨 보는 사람이 된다.
function markMore() {
  const sheet = state.sheet;
  if (!sheet) return;
  const label = state.shown < sheet.cut ? "더 들여다본다" : sheet.choices.length ? "다 둘러봤다" : "문을 열고 들어간다";
  $(".js-more").setAttribute("aria-label", label);
}

// 화살표. 덩이가 남았으면 다음 덩이를, 다 봤으면 칩이 끼어든다.
// 칩이 일찍 끼어드는 쪽(cut이 덩이 수보다 작다)에서는 남은 덩이를 끝내 보지 못한다.
function more() {
  const sheet = state.sheet;
  if (!sheet || $(".js-more").hidden || $(".js-more").disabled) return;
  if (state.shown < sheet.cut) return showChunk(state.turn);
  if (!sheet.choices.length) return enter();
  chipIn();
}

// 복도(1쪽)에는 선택지가 없다. 화살표를 누르면 다음 장이 집 안이다.
// 버튼을 먼저 감춰 두 번째 누름이 헛돌게 한다(renderSheet가 다음 쪽에서 다시 보인다).
function enter() {
  $(".js-more").hidden = true;
  state.run = enterHouse(state.house, state.run);
  turnTo(state.run.page);
}

// 칩이 끼어들어 선택지 넷이 찍히고, 그때부터 기한을 잰다. 글은 그대로 남아 다시 볼 수 있다.
function chipIn() {
  const token = state.turn;
  const sheet = state.sheet;
  // 고를 때는 방 전체를 본다. 클로즈업을 보고 있었으면 방 사진을 다시 받는다.
  setScene(sheet.scene, true, Boolean(sheet.mirror), sheet.variant || null);
  $(".act").classList.remove("is-reading");
  $(".js-more").hidden = true;
  const field = $(".js-choices");
  field.classList.add("is-waiting");
  field.classList.remove("is-locked");
  const buttons = state.sheet.choices.map(choiceButton);
  $(".js-choice-list").replaceChildren(...buttons);
  buttons.forEach((b, i) => printIn(b, Math.floor(i / 2) * T.line));
  later(token, 2 * T.line, startDeadline);
}

// 화살표를 Enter로 연타하다 첫 선택지를 잘못 누르지 않게, 키보드 포커스는 선택지 묶음에만 둔다.
function startDeadline() {
  const field = $(".js-choices");
  field.disabled = false;
  field.classList.remove("is-waiting");
  $(".js-deadline").classList.remove("is-idle");
  state.left = state.limit;
  state.open = true;
  if (state.keyboard) $(".js-choice-list").focus({ preventScroll: true });
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.left -= 1;
    const spent = state.limit - state.left;
    stepFrame(spent); // 식구 장면만 기한에 맞춰 프레임을 바꾼다
    $$(".cell").forEach((c, i) => c.classList.toggle("is-spent", i >= state.limit - spent));
    $(".js-secs").textContent = Math.max(0, state.left);
    if (state.left <= 0) timeout();
  }, 1000);
}

// 지금 장이 위로 밀려 나가고, 다음 장이 찍혀 나온다.
function turnTo(page) {
  const token = ++state.turn;
  const turn = $(".js-turn");
  turn.classList.add("is-leaving");
  later(token, T.leave, () => {
    turn.classList.remove("is-leaving");
    state.page = page;
    show();
  });
}

function lock() {
  state.open = false;
  clearInterval(state.timer);
  const field = $(".js-choices");
  field.classList.add("is-locked");
  field.disabled = true;
}

function choose(i) {
  if (!state.open) return;
  const picked = state.sheet.choices[i];
  $$(".choice")[i].classList.add("is-checked");
  lock();
  const token = state.turn;
  later(token, T.tick, () => settle(picked));
}

function timeout() {
  if (!state.open) return;
  lock();
  settle({ text: "응답 없음", act: { type: "timeout" } });
}

// 고른 것을 풀어 일지에 남기고 다음 장으로 넘긴다. 식구가 나오면 쪽을 넘기는 대신 점프스케어가 온다.
async function settle(picked) {
  const result = resolve(HOUSE, state.house, state.run, picked);
  record(fill(result.log.text), fill(result.log.tail), result.log.dead);
  if (result.evidence) cite(result.evidence);
  state.run = result.run;
  if (result.scare && !reduced) {
    const token = ++state.turn;
    bgm.sting();
    await scareIn();
    if (token !== state.turn) return;
    state.page = state.run.page;
    return show(false);
  }
  turnTo(state.run.page);
}

// 끝 장. 죽었으면 글이 틀린 방식대로 일그러진 뒤 사망 도장과 피가 찍히고, 살아 나왔으면 수거 판정이 찍힌다.
// 어느 쪽이든 끝에 본부의 매뉴얼이 수신된다.
async function renderEnd(over) {
  const token = ++state.turn;
  state.sheet = null;
  setAll(".js-page", state.page);
  setAll(".js-clock", clock());
  freezeDeadline();
  const act = $(".act");
  act.classList.remove("is-reading");
  act.classList.add("is-end");
  $(".js-more").hidden = true;
  const end = $(".js-end");
  end.hidden = true;
  const heads = stackHead();
  const body = $(".js-page-body");
  body.replaceChildren(
    ...over.lines.map((t) => {
      const p = document.createElement("p");
      p.textContent = fill(t);
      return p;
    })
  );
  fitPage(body);
  let t = 0;
  heads.forEach((el, i) => printIn(el, i * HEAD_STEP));
  t += heads.length * HEAD_STEP;
  for (const p of body.children) {
    printIn(p, t);
    t += T.line + T.gap;
  }
  await wait(t);
  if (token !== state.turn) return;
  const dead = over.end === "dead";
  bgm.mood(dead ? "dead" : "calm");
  if (dead) {
    const sheet = $(".sheet--rx");
    await warp(over.kind, body, sheet);
    if (token !== state.turn) return;
    deathStamp(sheet, pad(state.clone), clockSec());
    splatter(sheet);
    await wait(T.arrive);
    if (token !== state.turn) return;
  }
  end.hidden = false;
  const status = $(".js-end-status");
  status.textContent = dead ? "신호 끊김" : over.item === "real" ? "생존 · 수거 확인 · 등급 B" : "생존 · 수거물은 사본";
  status.classList.toggle("is-dead", dead);
  setAll(".js-next", pad(state.clone + 1));
  [...end.children].forEach((el, i) => printIn(el, i * T.gap));
  later(token, T.line, () => {
    if (state.keyboard) $(".js-again").focus({ preventScroll: true });
  });
  later(token, T.line + 2 * T.gap, () => {
    receiveManual();
    if (!dead && over.item === "real") later(token, T.arrive, () => grade("B"));
  });
}

// 쪽이 아주 깊어지면 화면도 틀리게 베껴진다. 머리줄의 쪽 번호가 한 번 되풀이되거나 사본 번호가 하나 어긋난다.
// 분위기용이고 매뉴얼 칸의 단서가 아니다.
const MISCOPY_FROM = 10;
function miscopy() {
  const head = $(".js-head");
  head.querySelector(".js-clone").textContent = pad(state.clone);
  if (state.page < MISCOPY_FROM || Math.random() < 0.5) return;
  if (Math.random() < 0.5) head.querySelector(".js-page").textContent = state.page - 1;
  else head.querySelector(".js-clone").textContent = pad(state.clone + 1);
}

/* ---------- 머리줄 ---------- */

// 판이 도는 동안 머리줄은 한 줄이다. 끝 장에서만 그 판이 지나온 머리줄이 위로 쌓여 찍힌다.
// 쪽마다 기계가 실제로 찍은 값을 적어 두므로, miscopy가 어긋나게 찍은 쪽 번호와 사본 번호도 그대로 남는다.
const HEAD_MAX = 5;
// 쌓인 줄이 밀어내도 그림 판에 남겨 둘 높이. 높이가 빠듯한 화면(1280×720, 390×844)에서는
// 판이 원래 작아서 고정값만 두면 한 줄도 못 쌓는다. 그래서 판의 절반 남짓도 함께 바닥으로 본다.
const HEAD_FLOOR = 96;
const HEAD_SHARE = 0.55;
const HEAD_STEP = reduced ? 0 : 80;

function logHead() {
  const head = $(".js-head");
  state.heads.push({
    clock: head.querySelector(".js-clock").textContent,
    clone: head.querySelector(".js-clone").textContent,
    page: head.querySelector(".js-page").textContent,
  });
}

function headLine(rec) {
  const p = document.createElement("p");
  p.className = "fax-line fax-line--past";
  p.innerHTML =
    '<span>수신 <span class="h-clock"></span></span>' +
    '<span>발신 CHIP-<b class="h-clone"></b></span>' +
    "<span>본부 기록과</span>" +
    '<span>쪽 <b class="h-page"></b></span>';
  p.querySelector(".h-clock").textContent = rec.clock;
  p.querySelector(".h-clone").textContent = rec.clone;
  p.querySelector(".h-page").textContent = rec.page;
  return p;
}

// 끝 장에서는 매뉴얼이 곧 수신된다. 좁은 화면에서는 그때 책상 위에 전환 막대가 생겨 장이 그만큼 줄어드는데,
// 아직 오지 않은 그 높이를 미리 빼지 않으면 쌓고 난 뒤에 그림 판이 규칙보다 작아진다.
// --bar는 :root에 있고 body.is-solo가 0으로 덮는다. 그래서 :root에서 읽으면 막대가 생긴 뒤의 값이 나온다.
function barToCome() {
  if (!document.body.classList.contains("is-solo")) return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar")) || 0;
}

// 지금 살아 있는 머리줄 위에 지나온 줄을 붙이고, 붙인 줄을 돌려준다.
// 몇 줄까지 쌓을지는 그림 판이 내줄 수 있는 높이가 정한다. 좁은 화면에서는 저절로 줄어든다.
function stackHead() {
  const head = $(".fax-head");
  head.querySelectorAll(".fax-line--past").forEach((el) => el.remove());
  if (!state.heads.length) return [];
  const live = $(".js-head");
  const box = $(".plate-frame");
  const bar = barToCome();
  const frame = box.clientHeight - bar;
  const room = frame - Math.max(HEAD_FLOOR, frame * HEAD_SHARE);
  const step = live.offsetHeight + 2;
  const keep = Math.max(0, Math.min(HEAD_MAX, state.heads.length, Math.floor(room / step)));
  if (!keep) return [];
  const lines = state.heads.slice(-keep).map(headLine);
  live.before(...lines);
  // 붙여 놓고 다시 잰다. 계산과 실제 배치가 어긋나면 위에서부터, 곧 가장 오래된 줄부터 걷는다.
  while (lines.length && box.clientHeight - bar < HEAD_FLOOR) lines.shift().remove();
  lines.forEach((el, i) => {
    // 오래된 줄일수록 토너가 빠진다. 맨 위가 가장 오래된 줄이다.
    const age = lines.length === 1 ? 1 : 1 - i / (lines.length - 1);
    el.style.setProperty("--age", age.toFixed(2));
    el.dataset.gen = String(1 + Math.round(age));
  });
  return lines;
}

/* ---------- 일지 ---------- */

function record(choiceText, logText, dead) {
  const list = $(".js-log");
  const li = document.createElement("li");
  // is-held에는 CSS가 없다. 매뉴얼 장 전체를 감추는 것은 body.is-solo이고, is-held는
  // receiveManual이 나중에 찾아(873행) 매뉴얼과 함께 한 줄씩 찍어 낼 기록을 가려내는 표시일 뿐이다.
  li.className = document.body.classList.contains("is-solo") ? "entry gen-0 is-held" : "entry gen-0 is-new";
  li.innerHTML = '<p class="entry-tag"></p><p class="entry-body"></p><p class="entry-end"></p>';
  li.querySelector(".entry-tag").textContent = `${pad(state.clone)} · ${state.entry}회 · ${state.place}`;
  li.querySelector(".entry-body").textContent = [`${choiceText}.`, logText].filter(Boolean).join(" ");
  const end = li.querySelector(".entry-end");
  end.textContent = dead ? "신호 끊김" : "생존";
  end.classList.toggle("is-dead", dead);
  list.prepend(li);
  list.scrollTop = 0;

  const tx = $(".js-tx");
  tx.textContent = `송신 완료 · 본부 기록과 · ${clockSec()}`;
  tx.classList.add("is-sent");

  if (narrow.matches && $(".js-desk").dataset.show !== "manual") {
    state.unread += 1;
    paintBadge();
  }
}

// 새 사본을 받을 때만 앞선 기록이 한 세대씩 바랜다.
function ageLog() {
  $$(".js-log .entry").forEach((li) => {
    const g = [0, 1, 2, 3].find((n) => li.classList.contains(`gen-${n}`)) ?? 0;
    li.classList.remove(`gen-${g}`, "is-new");
    li.classList.add(`gen-${Math.min(3, g + 1)}`);
  });
}

// 매뉴얼 칸의 근거 열에 이번 사본 번호를 적는다. 최근 셋만 남긴다.
function cite(kind) {
  const cell = $(`.js-cite[data-kind="${kind}"]`);
  if (!cell) return;
  const nums = cell.textContent.split(" · ").filter((n) => /^\d{4}$/.test(n));
  const me = pad(state.clone);
  if (!nums.includes(me)) nums.push(me);
  cell.textContent = nums.slice(-3).join(" · ");
}

/* ---------- 매뉴얼 수신: 판이 끝나야 본부의 매뉴얼을 받는다 ---------- */

function receiveManual() {
  if (!document.body.classList.contains("is-solo")) return;
  const manual = $(".sheet--manual");
  document.body.classList.remove("is-solo");
  manual.classList.remove("is-arriving");
  void manual.offsetWidth;
  manual.classList.add("is-arriving");
  // 이번 사본의 기록이 위에서부터 한 줄씩 찍힌다
  $$(".js-log .entry.is-held").forEach((li, i) => {
    li.classList.remove("is-held");
    li.style.setProperty("--d", `${T.arrive + i * T.entry}ms`);
    li.classList.add("is-new");
  });
  $(".js-log").scrollTop = 0;
}

function sendManualBack() {
  document.body.classList.add("is-solo");
  $(".sheet--manual").classList.remove("is-arriving");
  showSheet("rx");
  state.unread = 0;
  paintBadge();
}

// 살아서 진짜를 들고 나오면 승인 칸에 B가 찍힌다. 이미 등급이 찍혀 있으면(B나 S) 그대로 둔다.
function grade(mark) {
  const cell = $(".js-approve-cell");
  if (cell.querySelector(".seal--grade")) return;
  stamp(cell, "seal--grade", mark, "-8deg");
  $(".js-verdict").textContent = "생존 수거 · 등급 B. 칸 셋을 한꺼번에 맞히면 S로 올라갑니다.";
}

// 새 사본을 받으면 앞 사본이 남긴 일그러짐, 찢김, 사망 도장, 피를 치운다.
function clearMarks() {
  const sheet = $(".sheet--rx");
  sheet.classList.remove("is-torn", "is-inverted");
  sheet.querySelectorAll(".tear, .death, .blood, .blood-splat, .fax-line--past").forEach((el) => el.remove());
  $(".js-page-body").classList.remove("is-warping");
}

function newCopy() {
  sendManualBack();
  ageLog();
  clearMarks();
  state.clone += 1;
  state.entry += 1;
  setAll(".js-clone", pad(state.clone));
  setAll(".js-copies", `${pad(FIRST_CLONE)}~${pad(state.clone)}`);
  setAll(".js-entry", state.entry);
  const tx = $(".js-tx");
  tx.textContent = "송신 대기";
  tx.classList.remove("is-sent");
  startCopy();
  plate.scene = null; // 새 사본은 같은 복도 사진도 새로 받는다. 전송 흠이 매번 다르다.
  turnTo(1);
}

/* ---------- 좁은 화면: 장 전환 ---------- */

function paintBadge() {
  const badge = $(".js-badge");
  badge.hidden = state.unread === 0;
  badge.textContent = state.unread;
  badge.closest("button").setAttribute("aria-label", state.unread ? `매뉴얼, 새 기록 ${state.unread}건` : "매뉴얼");
}

function showSheet(which) {
  $(".js-desk").dataset.show = which;
  $$(".js-switch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.show === which)));
  if (which === "manual") {
    state.unread = 0;
    paintBadge();
  }
}

/* ---------- 매뉴얼 결재 ---------- */

function stamp(cell, cls, text, r) {
  const s = document.createElement("span");
  s.className = `seal ${cls} is-landing`;
  s.style.setProperty("--r", r);
  s.textContent = text;
  cell.replaceChildren(s);
}

function submitManual() {
  const slots = $$(".js-slot");
  const verdict = $(".js-verdict");
  if (slots.some((s) => !s.value)) {
    verdict.textContent = "빈칸이 있어 결재를 올릴 수 없습니다. 미확정 칸 셋을 모두 채워 주십시오.";
    return;
  }
  const picks = Object.fromEntries(slots.map((s) => [s.dataset.key, s.value]));
  const cell = $(".js-approve-cell");
  const wrap = $(".js-slots-wrap");
  wrap.querySelector(".big-reject")?.remove();

  if (Object.entries(ANSWER).every(([k, v]) => picks[k] === v)) {
    stamp(cell, "seal--grade", "S", "-12deg");
    verdict.textContent = "승인 · 등급 S · 열람 권한 1건이 열렸습니다.";
    slots.forEach((s) => {
      const tr = s.closest("tr");
      const value = document.createElement("span");
      value.className = "fixed-value";
      value.textContent = s.selectedOptions[0].textContent;
      s.replaceWith(value);
      tr.classList.add("is-fixed");
      const st = tr.querySelector(".state");
      st.textContent = "확정";
      st.classList.add("state--fixed");
    });
    $(".js-access").classList.add("is-open");
    $(".js-access-cond").textContent = "열람 가능. 원본의 이름은 이야기 초안에서 정합니다.";
    const submit = $(".js-submit");
    submit.disabled = true;
    submit.textContent = "결재 완료";
    return;
  }

  state.rejects += 1;
  stamp(cell, "seal--reject", "반려", "7deg");
  const big = document.createElement("span");
  big.className = "big-reject is-landing";
  big.setAttribute("aria-hidden", "true");
  big.textContent = "반려";
  big.style.setProperty("--r", `${(-10 + (Math.random() * 3 - 1.5)).toFixed(1)}deg`);
  wrap.append(big);
  verdict.textContent = `반려 ${state.rejects}회 · 셋 중 틀린 칸이 있습니다.`;
}

/* ---------- 연결 ---------- */


$(".js-choice-list").addEventListener("click", (e) => {
  const b = e.target.closest(".choice");
  if (!b) return;
  state.keyboard = e.detail === 0;
  choose(Number(b.dataset.i));
});

$(".js-more").addEventListener("click", (e) => {
  state.keyboard = e.detail === 0;
  more();
});

// 화살표는 Enter나 Space로도 받는다. 다른 버튼이나 칸 위에서는 그쪽이 먼저다.
document.addEventListener("keydown", (e) => {
  if ((e.key !== "Enter" && e.key !== " ") || e.repeat) return;
  if (e.target.closest("button, select, input, label, a, [tabindex]")) return;
  const btn = $(".js-more");
  if (btn.hidden || btn.disabled) return;
  e.preventDefault();
  state.keyboard = true;
  more();
});

$(".js-again").addEventListener("click", (e) => {
  state.keyboard = e.detail === 0;
  newCopy();
});

$$(".js-switch").forEach((b) => b.addEventListener("click", () => showSheet(b.dataset.show)));

$$(".js-slot").forEach((s) => {
  s.classList.add("is-blank");
  s.addEventListener("change", () => {
    s.classList.toggle("is-blank", !s.value);
    const big = $(".js-slots-wrap .big-reject");
    if (big) {
      big.classList.remove("is-landing");
      big.classList.add("is-faded");
    }
  });
});

$(".js-submit").addEventListener("click", submitManual);

$(".js-plate-file").addEventListener("change", (e) => {
  readPlateFile(e.target.files[0]);
  e.target.value = "";
});

{
  const box = plate.box;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  let depth = 0;
  box.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth += 1;
    box.classList.add("is-dragging");
  });
  box.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  box.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) box.classList.remove("is-dragging");
  });
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    box.classList.remove("is-dragging");
    readPlateFile(e.dataTransfer.files[0]);
  });
  // 그림 판 밖에 떨어뜨려도 브라우저가 파일을 열고 떠나지 않게 한다
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

{
  let wait;
  // .act.is-reading의 min-height가 선택지 상태에서 빠지며 판이 몇 px 흔들린다. CSS 4px 안의
  // 흔들림은 무시하고, 실제 창 크기 변경에만 다시 그린다.
  new ResizeObserver(() => {
    clearTimeout(wait);
    wait = setTimeout(() => {
      const r = plate.canvas.getBoundingClientRect();
      if (Math.abs(r.width - plate.cssW) > 4 || Math.abs(r.height - plate.cssH) > 4) paintPlate(false);
    }, 150);
  }).observe(plate.canvas);
}

{
  let wait;
  window.addEventListener("resize", () => {
    clearTimeout(wait);
    wait = setTimeout(() => fitPage($(".js-page-body")), 120);
  });
}

// 배경음은 첫 조작에서 켠다. 브라우저가 그 전에는 소리를 막는다.
const sound = $(".js-sound");
const volume = $(".js-volume");
const paintSound = () => {
  const off = bgm.isMuted();
  sound.setAttribute("aria-pressed", String(!off));
  sound.textContent = off ? "소리 끔" : "소리";
  const pct = Math.round(bgm.volume() * 100);
  volume.value = String(pct);
  volume.style.setProperty("--fill", `${pct}%`);
  $(".js-volume-value").textContent = off ? "—" : String(pct);
};
// 밀대를 움직이면 크기를 바꾸고, 꺼져 있었으면 켠다.
volume.addEventListener("input", () => {
  bgm.setVolume(Number(volume.value) / 100);
  if (bgm.isMuted()) bgm.setMuted(false);
  else bgm.start();
  paintSound();
});
sound.addEventListener("click", (e) => {
  e.stopPropagation();
  bgm.setMuted(!bgm.isMuted());
  paintSound();
});
paintSound();
const wake = () => {
  bgm.start();
  removeEventListener("pointerdown", wake, true);
  removeEventListener("keydown", wake, true);
};
addEventListener("pointerdown", wake, true);
addEventListener("keydown", wake, true);

renderCells(DEADLINE);
startCopy();
// 그림은 장면마다 art/에서 찾는다. 없으면 임시 그림으로 시작하고, 찾으면 그 사진으로 다시 받는다.
const loads = [
  ...Object.entries(ART_FILES).map(([key, stem]) => loadArt(stem).then((found) => [key, found])),
  ...CLOSE_FILES.map((stem) => loadArt(stem, ["png"]).then((found) => [stem, found])),
];
Promise.all(loads).then((found) => {
  Object.assign(art, Object.fromEntries(found));
  refreshArt();
});
// 장면은 그림을 기다리지 않는다. 글자 크기를 재야 하니 글꼴만 기다린다.
document.fonts.ready.then(() => show());
