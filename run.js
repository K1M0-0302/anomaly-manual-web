// 잘못 베낀 집 한 판의 진행. 화면을 모른다.
// pageOf는 지금 상태로 쪽 하나(덩이, 선택지, 기한)를 만들고, resolve는 고른 것을 풀어 다음 상태를 돌려준다.
// 상태는 고치지 않고 새로 만든다. house.js의 함수(isWrong, pickOne, shuffle, KINDS)를 전역에서 쓴다.

const DEADLINE = 12;
const SIKGU_DEADLINE = 5;
const CUT_FROM = 6; // 이 쪽부터 칩이 가끔 덩이를 다 보기 전에 끼어든다.

// 현관문이 어떻게 베껴졌는지(normal, flip, extra)와 고른 방식(use, flip, extra)에 따른 결과.
const DOOR = {
  normal: { use: "exit", flip: "stay", extra: "exit" },
  flip: { use: "dead", flip: "exit", extra: "dead" },
  extra: { use: "sikgu", flip: "sikgu", extra: "exit" },
};

const put = (text, vars) => text.replace(/\{(start|spot|item|say)\}/g, (_, k) => vars[k]);
const thingOf = (data, id) => data.things.find((t) => t.id === id);
const targetOf = (data, house) => data.targets.find((t) => t.id === house.target.id);
const choice = (text, act, safe) => ({ text, act, safe });

function newRun() {
  return { page: 1, room: null, intro: true, fresh: true, held: null, used: [], lead: null, sikgu: null, over: null };
}

// 복도(1쪽)에서 화살표를 누르면 집 안 첫 쪽으로 넘어간다.
function enterHouse(house, run) {
  return { ...run, page: run.page + 1, room: house.start, intro: false, fresh: true };
}

function pageOf(data, house, run, rng) {
  if (run.intro) return introPage(data, house);
  if (run.sikgu) return sikguPage(data, house, run, rng);
  if (run.room === "hall" && run.held) return doorPage(data, house, run, rng);
  return roomPage(data, house, run, rng);
}

function introPage(data, house) {
  const chunks = data.intro.map((line) => put(line, { start: data.rooms[house.start].name }));
  return { scene: "door", place: "복도", chunks, cut: chunks.length, choices: [], deadline: 0 };
}

function thingsHere(data, house, run) {
  return data.things.filter((t) => t.room === run.room && (!t.space || isWrong(house, t.id, run.page)));
}

// 그림 판은 방마다 그 방 사진을 건다. 뒤집힘 장소 변이가 나타난 방이면 같은 사진을 좌우로 뒤집어 건다.
function mirrored(data, house, run) {
  return data.things.some((t) => t.room === run.room && t.space && t.kind === "flip" && isWrong(house, t.id, run.page));
}

// 물건 걸음의 클로즈업. 장소 변이(space)는 방 자체가 바뀌는 것이라 클로즈업이 없다.
function thingShot(house, run, t) {
  return t.space ? null : { kind: "thing", id: t.id, wrong: isWrong(house, t.id, run.page) };
}

// 방 사진의 변형. 하나가 더 있는 장소 변이(안방의 없던 방문)가 나타난 방이면 그 물건 id를 준다.
// 화면은 <방>-<id> 사진이 있으면 그것을 건다. 뒤집힘 변이는 mirror가 맡는다.
function variantOf(data, house, run) {
  const t = data.things.find((t) => t.room === run.room && t.space && t.kind === "extra" && isWrong(house, t.id, run.page));
  return t ? t.id : null;
}

function copyHere(house, run) {
  if (run.held) return null;
  if (house.target.real === run.room) return "real";
  if (house.target.fake === run.room) return "fake";
  return null;
}

function copyLine(data, house, which) {
  const t = targetOf(data, house);
  const room = which === "real" ? house.target.real : house.target.fake;
  const text = which === "real" ? t.see : t.fake[house.target.fakeKind];
  return put(text, { spot: data.spots[room] });
}

function opening(data, run, roomId) {
  const room = data.rooms[roomId];
  return [run.lead, run.fresh ? room.enter : room.again].filter(Boolean).join(" ");
}

function murmur(data, run, rng) {
  const odds = run.page >= CUT_FROM ? 0.6 : 0.3;
  return rng() < odds ? pickOne(rng, data.murmurs) : null;
}

// 덩이는 탐사 한 걸음이다. 첫 덩이가 방을 둘러보는 걸음이고, 그다음 덩이마다 물건 하나에 다가간다.
// 손을 대는 것은 덩이가 아니라 선택지다. 잡음은 따로 마지막 덩이가 되고, 칩이 일찍 끼어들면
// 그 덩이만 잘린다. 그래서 잘릴 수 있는 덩이에는 단서가 없다.
// 걸음이 넷을 넘으면 남은 물건은 마지막 걸음에서 한꺼번에 본다. 덩이 1~4개 제약을 지키는 자리이고,
// 덩이 수가 그 방의 물건 수를 그대로 알려 주지 않게 막는 자리이기도 하다.
// shots는 걸음마다 판에 받을 클로즈업이다(null이면 방 사진 그대로). 걸음을 합치면 합친 덩이는
// 처음 물건의 클로즈업을 받는다. 잡음 덩이는 판을 바꾸지 않는다.
function pack(rng, pieces, noise, page, shots = []) {
  const most = noise ? 3 : 4;
  const chunks = [pieces[0]];
  const out = [shots[0] || null];
  pieces.slice(1).forEach((piece, i) => {
    if (chunks.length < most) {
      chunks.push(piece);
      out.push(shots[i + 1] || null);
    } else chunks[chunks.length - 1] += ` ${piece}`;
  });
  if (!noise) return { chunks, cut: chunks.length, shots: out };
  chunks.push(noise);
  out.push(null);
  const early = page >= CUT_FROM && rng() < 0.5;
  return { chunks, cut: early ? chunks.length - 1 : chunks.length, shots: out };
}

const moveChoice = (data, to) => choice(`${data.rooms[to].toward} 간다`, { type: "move", to }, true);
const useChoice = (house, run, t) => choice(t.use, { type: "use", thing: t.id }, !isWrong(house, t.id, run.page));
const answerChoice = (t) => choice(t.answer, { type: "answer", thing: t.id }, true);

function takeChoice(data, house, which) {
  const room = which === "real" ? house.target.real : house.target.fake;
  return choice(put(targetOf(data, house).take, { spot: data.spots[room] }), { type: "take", which }, true);
}

function roomPage(data, house, run, rng) {
  const here = thingsHere(data, house, run);
  const clues = here.map((t) => (isWrong(house, t.id, run.page) ? t.odd : t.see));
  const shots = [null, ...here.map((t) => thingShot(house, run, t))];
  const copy = copyHere(house, run);
  if (copy) {
    clues.push(copyLine(data, house, copy));
    shots.push({ kind: "target", id: house.target.id, fake: copy === "fake" });
  }
  const { chunks, cut, shots: packed } = pack(rng, [opening(data, run, run.room), ...clues], murmur(data, run, rng), run.page, shots);
  return {
    scene: run.room,
    variant: variantOf(data, house, run),
    shots: packed,
    mirror: mirrored(data, house, run),
    place: data.rooms[run.room].name,
    chunks,
    cut,
    choices: roomChoices(data, house, run, rng, here, copy),
    deadline: DEADLINE,
  };
}

// 선택지 넷. 틀린 물건은 습관대로 쓰는 함정을 늘 내놓고 대응은 가끔만 내놓는다.
// 제대로인 물건은 쓰기나 대응 중 하나를 내놓아서, 대응이 보인다고 틀린 물건이라는 뜻이 되지 않게 한다.
// 남는 자리는 다른 방으로 가는 길로 채운다. 넷 중 하나는 늘 살 길이다.
function roomChoices(data, house, run, rng, here, copy) {
  const picks = [];
  const add = (c) => {
    if (picks.length < 4 && !picks.some((p) => p.text === c.text)) picks.push(c);
  };
  if (run.held && run.room !== "hall") add(moveChoice(data, "hall"));
  if (copy) add(takeChoice(data, house, copy));
  for (const t of shuffle(rng, here.filter((t) => !run.used.includes(t.id)))) {
    if (isWrong(house, t.id, run.page)) {
      add(useChoice(house, run, t));
      if (rng() < 0.7) add(answerChoice(t));
    } else if (rng() < 0.6) add(useChoice(house, run, t));
    else add(answerChoice(t));
  }
  const blocked = here.filter((t) => t.to).map((t) => t.to);
  const exits = Object.keys(data.rooms).filter((r) => r !== run.room && !blocked.includes(r));
  for (const r of shuffle(rng, exits)) add(moveChoice(data, r));
  // 안전하지 않은 선택지는 use뿐이다(useChoice의 safe = !isWrong, move·answer·take는 늘 safe).
  // 그 불변식이 깨지면 lastIndexOf가 -1을 돌려주고 다음 줄이 던진다.
  if (!picks.some((p) => p.safe)) {
    const last = picks.map((p) => p.act.type).lastIndexOf("use");
    picks[last] = answerChoice(thingOf(data, picks[last].act.thing));
  }
  return shuffle(rng, picks);
}

function sikguPage(data, house, run, rng) {
  const s = data.sikgu;
  const looks = shuffle(rng, KINDS).map((k) => house.sikgu[k]);
  looks[2] = `${looks[2]} ${put(s.speak, { say: pickOne(rng, s.says) })}`;
  const chunks = [[run.lead, s.intro].filter(Boolean).join(" "), ...looks];
  const choices = shuffle(rng, [
    choice(pickOne(rng, s.choices.stay), { type: "sikgu", how: "stay" }, true),
    ...KINDS.map((k) => choice(pickOne(rng, s.choices[k]), { type: "sikgu", how: k }, false)),
  ]);
  return {
    scene: "sikgu",
    place: data.rooms[run.room].name,
    chunks,
    cut: chunks.length,
    choices,
    deadline: SIKGU_DEADLINE,
    special: "sikgu",
  };
}

function doorPage(data, house, run, rng) {
  const d = data.door;
  const look = house.door === "normal" ? d.see : d.odd[house.door];
  const { chunks, cut } = pack(rng, [opening(data, run, "hall"), look], murmur(data, run, rng), run.page);
  const safe = (how) => ["exit", "stay"].includes(DOOR[house.door][how]);
  const back = pickOne(rng, Object.keys(data.rooms).filter((r) => r !== "hall"));
  const choices = shuffle(rng, [
    choice(d.use, { type: "door", how: "use" }, safe("use")),
    choice(d.answer.flip, { type: "door", how: "flip" }, safe("flip")),
    choice(d.answer.extra, { type: "door", how: "extra" }, safe("extra")),
    moveChoice(data, back),
  ]);
  return { scene: "hall", mirror: mirrored(data, house, run), place: data.rooms.hall.name, chunks, cut, choices, deadline: DEADLINE };
}

// 고른 것을 푼다. 돌려주는 것:
// run 다음 상태, log 칩 일지 한 줄({ text, tail, dead }), evidence 매뉴얼 칸의 근거가 된 방식, scare 식구가 나왔는지.
function resolve(data, house, run, picked) {
  const act = picked.act;
  const next = { ...run, page: run.page + 1, fresh: false, lead: null, sikgu: null };
  const out = (tail, more = {}) => ({
    run: next,
    log: { text: picked.text, tail, dead: Boolean(next.over && next.over.end === "dead") },
    evidence: null,
    scare: false,
    ...more,
  });
  const die = (kind, first) => {
    next.over = { end: "dead", kind, lines: [first, ...data.death[kind].lines].filter(Boolean) };
  };

  if (act.type === "timeout") {
    die("timeout", null);
    return out(data.death.timeout.log);
  }
  if (act.type === "move") {
    Object.assign(next, { room: act.to, used: [], fresh: true });
    return out("");
  }
  if (act.type === "take") {
    Object.assign(next, { held: act.which, lead: targetOf(data, house).took });
    return out("수거 기록.");
  }
  if (act.type === "use" || act.type === "answer") {
    const t = thingOf(data, act.thing);
    const wrong = isWrong(house, t.id, run.page);
    next.used = [...run.used, t.id];
    if (act.type === "answer") {
      if (t.to) Object.assign(next, { room: t.to, used: [], fresh: true });
      next.lead = data.answered[t.kind][wrong ? "wrong" : "normal"];
      return out(wrong ? `표시 기록: ${t.mark}.` : "표시 없음.", { evidence: wrong ? t.kind : null });
    }
    if (!wrong) {
      // space:true인 물건(장소 변이)은 fine이 없다. 지금은 thingsHere가 그 물건을 틀렸을 때만
      // 내놓아서(43행) 여기 !wrong 갈래에 닿지 않지만, 그 필터를 손대면 "undefined"가 찍힌다.
      next.lead = `${t.did} ${t.fine}`;
      return out("이상 없음.");
    }
    if (t.kind === "extra") {
      Object.assign(next, { sikgu: { back: run.room }, lead: t.did });
      return out("식구 출현.", { evidence: "extra", scare: true });
    }
    die(t.kind, t.did);
    return out(data.death[t.kind].log, { evidence: t.kind });
  }
  if (act.type === "sikgu") {
    next.room = run.sikgu.back;
    if (act.how === "stay") {
      next.lead = data.sikgu.back;
      return out("식구 출현, 생존.", { evidence: "extra" });
    }
    die(act.how, data.sikgu.did[act.how]);
    return out(data.death[act.how].log, { evidence: act.how });
  }
  if (act.type === "door") {
    const d = data.door;
    const result = DOOR[house.door][act.how];
    if (result === "stay") {
      next.lead = d.stay;
      return out("열리지 않음.");
    }
    if (result === "sikgu") {
      Object.assign(next, { sikgu: { back: "hall" }, lead: d.look });
      return out("식구 출현.", { evidence: "extra", scare: true });
    }
    if (result === "dead") {
      die("flip", d.did);
      return out(data.death.flip.log, { evidence: "flip" });
    }
    const item = targetOf(data, house).name;
    next.over = { end: "alive", item: run.held, lines: data.exit[run.held].map((l) => put(l, { item })) };
    return out(run.held === "real" ? "수거물 확인, 생존." : "수거물은 사본.", {
      evidence: house.door === "normal" ? null : house.door,
    });
  }
  throw new Error(`모르는 선택: ${act.type}`);
}

if (typeof module !== "undefined") {
  module.exports = { DEADLINE, SIKGU_DEADLINE, CUT_FROM, DOOR, newRun, enterHouse, pageOf, resolve };
}
