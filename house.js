// 잘못 베낀 집의 무작위 배치. 판마다 시작하는 방, 어느 물건이 몇 쪽부터 틀리는지,
// 채취물과 가짜의 자리, 현관문, 식구의 생김새가 바뀐다.
// 틀린 방식 셋과 대응 셋의 짝은 content.js에 고정돼 있고 여기서 바꾸지 않는다.

const KINDS = ["sense", "flip", "extra"];
const FIRST_WRONG = 2; // 1쪽은 복도다. 집 안 첫 쪽인 2쪽에 틀린 물건이 하나쯤 섞인다.
const FULL_BY = 9; // 집 안 8번째 쪽(9쪽)이면 모든 물건이 틀려 있다.
const SPACE_FROM = 5; // 장소 변이는 5쪽부터 9쪽 사이에 하나씩 나타난다.

// 시드가 같으면 같은 판이 나온다(mulberry32).
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOne(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function shuffle(rng, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeHouse(data, rng) {
  const inside = Object.keys(data.rooms).filter((r) => r !== "hall");
  const start = pickOne(rng, inside);

  // 평범한 물건은 섞은 순서대로 2쪽부터 9쪽까지 고르게 틀려진다.
  const wrongFrom = {};
  const plain = shuffle(rng, data.things.filter((t) => !t.space));
  const span = FULL_BY - FIRST_WRONG + 1;
  plain.forEach((t, i) => {
    wrongFrom[t.id] = FIRST_WRONG + Math.floor(((i + 0.5) * span) / plain.length);
  });
  for (const t of data.things.filter((t) => t.space)) {
    wrongFrom[t.id] = SPACE_FROM + Math.floor(rng() * (FULL_BY - SPACE_FROM + 1));
  }

  const target = pickOne(rng, data.targets);
  const [real, fake] = shuffle(rng, Object.keys(data.spots));
  const fakeKind = pickOne(rng, ["sense", "flip"]);
  const door = rng() < 0.4 ? "normal" : pickOne(rng, ["flip", "extra"]);
  const sikgu = {};
  for (const k of KINDS) sikgu[k] = pickOne(rng, data.sikgu.looks[k]);

  return { start, wrongFrom, target: { id: target.id, real, fake, fakeKind }, door, sikgu };
}

function isWrong(house, id, page) {
  return page >= house.wrongFrom[id];
}

if (typeof module !== "undefined") {
  module.exports = { KINDS, FIRST_WRONG, FULL_BY, makeRng, pickOne, shuffle, makeHouse, isWrong };
}
