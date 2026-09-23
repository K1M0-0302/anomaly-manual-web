// 깨지는 글. 목소리와 흔들리는 독백이 팩스 용지에 깨져 찍힌다. 세 자리가 저마다 다르게 깨진다.
// 식구의 말(⟪ ⟫)은 띄어쓰기부터 틀리게 베껴 낱말 안에 빈칸이 끼고, 이 집이 틀리게 베낀 세 방식대로 음절이 깨진다.
// 하나 더는 음절이 한 번 더 찍히거나 두 번 겹쳐 굵게 찍히고, 뒤집힘은 음절이 좌우로 뒤집혀 찍히고, 빠짐은 음절이 거의 빠진 채 흐리게 찍힌다.
// 없는 사람이 부르는 소리(⟦ ⟧)는 말은 멀쩡한데 조금 어긋나게 두 번 겹쳐 찍힌다.
// 독백은 식구 앞이나 아주 깊은 쪽에서 한 군데 더듬는다("문, 문이").
// 글자를 더하거나 찍히는 모양만 바꾸고 빼지 않는다. 끼어든 조각(noise)을 걷어 내면 원래 글이 그대로 남아서 단서가 지워지지 않는다.
// house.js의 pickOne, shuffle을 전역에서 쓴다.

const VOICE = /⟪([^⟫]*)⟫|⟦([^⟧]*)⟧/g;
const SYLLABLE = /[가-힣]/;

// 조각 하나. fx는 찍히는 모양(bold 겹쳐 굵게, mirror 뒤집힘, fade 빠짐, ghost 어긋나게 겹침, 없으면 그대로)이고 noise는 끼어든 글자다.
const piece = (t, fx = "", noise = false) => ({ t, fx, noise });

// 모음에 세로획이 있는 음절(가, 너, 이, 와 등). 우, 음처럼 가로 모음만 있는 음절은 좌우로 뒤집어도 티가 잘 안 난다.
function sideways(c) {
  return ![8, 12, 13, 17, 18].includes(Math.floor((c.charCodeAt(0) - 0xac00) / 28) % 21);
}

// 식구의 말. 낱말 안 음절 사이에 빈칸을 하나 끼우고, 남은 몫만큼 세 방식을 겹치지 않게 하나씩 준다.
// 짧은 말도 두 군데는 깨진다. 뒤집을 음절은 되도록 세로획이 있는 것으로 고른다.
function copyWrong(text, rng) {
  const chars = [...text];
  const syllables = chars.map((c, i) => (SYLLABLE.test(c) ? i : -1)).filter((i) => i >= 0);
  const hits = Math.min(syllables.length, Math.max(2, Math.round(syllables.length / 4)));
  const joins = syllables.filter((i) => i > 0 && SYLLABLE.test(chars[i - 1]));
  const gap = joins.length ? pickOne(rng, joins) : -1;
  const ways = shuffle(rng, ["extra", "flip", "sense"]);
  let free = shuffle(rng, syllables);
  const way = {};
  for (let n = 0; n < hits - (gap >= 0 ? 1 : 0); n++) {
    const w = ways[n % ways.length];
    const i = (w === "flip" ? free.find((k) => sideways(chars[k])) : undefined) ?? free[0];
    way[i] = w === "extra" ? pickOne(rng, ["double", "bold"]) : w;
    free = free.filter((k) => k !== i);
  }
  const out = [];
  chars.forEach((c, i) => {
    if (i === gap) out.push(piece(" ", "", true));
    const fx = way[i] === "flip" ? "mirror" : way[i] === "sense" ? "fade" : way[i] === "bold" ? "bold" : "";
    out.push(piece(c, fx));
    if (way[i] === "double") out.push(piece(c, "", true));
  });
  return out;
}

// 독백이 더듬는다. 낱말 첫 음절 하나를 쉼표와 함께 한 번 앞질러 찍는다. 더듬을 낱말이 없으면 null.
function stutter(text, rng) {
  const chars = [...text];
  const starts = chars
    .map((c, i) => (SYLLABLE.test(c) && (i === 0 || /\s/.test(chars[i - 1])) ? i : -1))
    .filter((i) => i >= 0);
  if (!starts.length) return null;
  const at = pickOne(rng, starts);
  return [piece(chars.slice(0, at).join("")), piece(`${chars[at]}, `, "", true), piece(chars.slice(at).join(""))];
}

// 덩이 하나를 조각 배열로 만든다. 목소리는 따옴표로 감싸고, 독백은 mood가 1이면 한 덩이에서 딱 한 군데 더듬는다.
function garble(text, rng, mood) {
  const out = [];
  const push = (p) => {
    if (!p.t) return;
    const last = out[out.length - 1];
    if (last && last.fx === p.fx && last.noise === p.noise && p.fx !== "mirror") last.t += p.t;
    else out.push({ ...p });
  };
  let left = mood;
  const narrate = (part) => {
    const shaken = left ? stutter(part, rng) : null;
    if (shaken) left = 0;
    (shaken || [piece(part)]).forEach(push);
  };
  let from = 0;
  for (const m of text.matchAll(VOICE)) {
    narrate(text.slice(from, m.index));
    push(piece("“"));
    (m[1] !== undefined ? copyWrong(m[1], rng) : [piece(m[2], "ghost")]).forEach(push);
    push(piece("”"));
    from = m.index + m[0].length;
  }
  narrate(text.slice(from));
  return out;
}

// 끼어든 조각을 걷어 낸 글. 목소리 표시는 따옴표가 된다.
function plainOf(pieces) {
  return pieces.filter((p) => !p.noise).map((p) => p.t).join("");
}

if (typeof module !== "undefined") module.exports = { VOICE, sideways, copyWrong, stutter, garble, plainOf };
