// 배경음. 음원 파일 없이 Web Audio로 그 자리에서 만든다(2026-09-23 사용자 결정).
// 낮은 드론, 방 울림 같은 걸러진 잡음, 가끔 멀리서 긁히는 현 같은 음, 금속성 울림.
// 음은 정해진 선율이 아니라 매번 무작위로 고른다. 브라우저는 사용자 조작 전에는 소리를 막으므로
// 첫 클릭이나 키 입력에서 시작한다.
//
// 분위기(mood):
//   house  집 안. 드론과 가끔 긁는 음.
//   sikgu  식구가 다가온다. 불협 음이 촘촘해지고 박동이 붙는다.
//   dead   끊김. 소리가 물속처럼 먹먹해지고, 심장 박동이 점점 느려지다 멎고, 삐- 하는 긴 신호음이 남는다(death()).
//          먹먹해지는 것은 배경음뿐이고, 박동과 신호음은 귀 안에서 나는 소리라 또렷하다.
//   calm   살아 나왔다. 드론만 옅게.

const bgm = (() => {
  const KEY = "copied-house-sound";
  const VOL_KEY = "copied-house-volume";
  const FULL = 0.9; // 음량 100%일 때 최종 출력
  let muted = false;
  let volume = 0.7; // 0~1. 오른쪽 위 밀대가 정한다.
  try {
    muted = localStorage.getItem(KEY) === "off";
    const v = parseFloat(localStorage.getItem(VOL_KEY));
    if (v >= 0 && v <= 1) volume = v;
  } catch {}

  let ctx = null;
  let master = null; // 배경음 전체. muffle을 거친다.
  let muffle = null; // 사망 때 닫히는 저역 통과 필터
  let bus = null; // 최종 출력. 소리 끄기는 여기서 한다.
  let dying = []; // 사망 시퀀스가 예약한 소리. 새 사본이 오면 멈춘다.
  let parts = null;
  let mood = "house";
  let depth = 1;
  let timer = null;

  const BASE = 55; // A1. 드론의 뿌리.
  // 긁는 음은 뿌리에서 반음·삼온음·단9도처럼 불편한 간격만 쓴다.
  const RATIOS = [1, 16 / 15, 45 / 32, 3 / 2, 8 / 5, 15 / 8, 2, 32 / 15, 45 / 16];

  function noiseBuffer(seconds) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // 갈색 잡음에 가깝게
      d[i] = last * 3.5;
    }
    return buf;
  }

  // 짧은 잔향. 감쇠하는 잡음을 임펄스로 쓴다.
  function reverb(seconds) {
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
    conv.buffer = buf;
    return conv;
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(ctx.destination);
    muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.7;
    muffle.connect(bus);
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(muffle);

    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const verb = reverb(4.5);
    verb.connect(wet).connect(master);

    // 드론: 살짝 어긋난 두 삼각파와 한 옥타브 아래 사인. 느린 LFO가 필터를 연다 닫는다.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 700;
    droneFilter.Q.value = 2;
    droneFilter.connect(droneGain);
    droneGain.connect(master);
    droneGain.connect(verb);
    // 뿌리(55Hz)만으로는 노트북·폰 스피커에서 거의 안 들린다(에너지 95%가 100Hz 아래였다, 2026-09-24 실측).
    // 그래서 두 옥타브 위(220Hz)와 그 위 삼온음 쪽에 몸통을 둔다. 뿌리는 헤드폰용 바닥으로만 깐다.
    [[BASE, "triangle", 0.18], [BASE * 2, "triangle", 0.22], [BASE * 4, "sawtooth", 0.16], [BASE * 4.012, "sawtooth", 0.16], [BASE * 4 * 45 / 32, "triangle", 0.07], [BASE * 8, "sine", 0.04]].forEach(([f, type, level]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(droneFilter);
      o.start();
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 320;
    lfo.connect(lfoAmt).connect(droneFilter.frequency);
    lfo.start();

    // 방 울림: 갈색 잡음을 좁은 대역으로 걸러 공기 흐르는 소리처럼.
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(6);
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 900;
    airFilter.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    air.connect(airFilter).connect(airGain);
    airGain.connect(master);
    airGain.connect(verb);
    air.start();

    // 박동: 식구 장면에서만 올라온다. 낮은 사인을 짧게 친다.
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0;
    pulseGain.connect(master);

    parts = { verb, droneGain, droneFilter, airGain, pulseGain };
  }

  const LEVELS = {
    house: { drone: 0.30, air: 0.30, pulse: 0, cutoff: 700, every: [3, 7] },
    sikgu: { drone: 0.36, air: 0.40, pulse: 0.5, cutoff: 1200, every: [1.2, 2.6] },
    dead: { drone: 0.34, air: 0.36, pulse: 0, cutoff: 700, every: null },
    calm: { drone: 0.18, air: 0.16, pulse: 0, cutoff: 500, every: [8, 14] },
  };

  function ramp(param, value, seconds) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  function apply(seconds) {
    if (!ctx) return;
    const L = LEVELS[mood];
    // 깊은 쪽일수록 드론이 조금씩 무거워진다.
    const deeper = mood === "house" ? Math.min(0.1, (depth - 1) * 0.008) : 0;
    ramp(parts.droneGain.gain, L.drone + deeper, seconds);
    ramp(parts.airGain.gain, L.air, seconds);
    ramp(parts.pulseGain.gain, L.pulse, seconds);
    ramp(parts.droneFilter.frequency, L.cutoff + deeper * 900, seconds);
    schedule();
  }

  // 멀리서 긁히는 현 같은 음 하나. 톱니파를 대역 통과시켜 천천히 부풀었다 사라진다.
  function scrape() {
    const L = LEVELS[mood];
    const now = ctx.currentTime;
    const r = RATIOS[Math.floor(Math.random() * RATIOS.length)];
    const f = BASE * 4 * r * (Math.random() < 0.3 ? 2 : 1);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, now);
    o.frequency.linearRampToValueAtTime(f * (1 + (Math.random() - 0.5) * 0.012), now + 6);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f * 1.5;
    bp.Q.value = 6;
    const g = ctx.createGain();
    const peak = mood === "sikgu" ? 0.09 : 0.06;
    const rise = mood === "sikgu" ? 0.6 : 2.5;
    const hold = mood === "sikgu" ? 1.2 : 3.5;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + rise);
    g.gain.linearRampToValueAtTime(0, now + rise + hold);
    o.connect(bp).connect(g);
    g.connect(parts.verb);
    g.connect(master);
    o.start(now);
    o.stop(now + rise + hold + 0.1);
    // 가끔 금속성 울림을 곁들인다.
    if (Math.random() < (L.pulse ? 0.35 : 0.18)) ping(now + rise * Math.random());
  }

  function ping(at) {
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modAmt = ctx.createGain();
    const f = 600 + Math.random() * 900;
    car.frequency.value = f;
    mod.frequency.value = f * 1.41;
    modAmt.gain.value = f * 0.9;
    mod.connect(modAmt).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.025, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 3);
    car.connect(g).connect(parts.verb);
    car.start(at);
    mod.start(at);
    car.stop(at + 3.1);
    mod.stop(at + 3.1);
  }

  function beat() {
    const now = ctx.currentTime;
    [0, 0.22].forEach((dt, i) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(62, now + dt);
      o.frequency.exponentialRampToValueAtTime(38, now + dt + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now + dt);
      g.gain.linearRampToValueAtTime(i ? 0.55 : 0.8, now + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dt + 0.25);
      o.connect(g).connect(parts.pulseGain);
      o.start(now + dt);
      o.stop(now + dt + 0.3);
    });
  }

  function schedule() {
    clearTimeout(timer);
    const L = LEVELS[mood];
    if (!L.every || !ctx) return;
    const [lo, hi] = L.every;
    timer = setTimeout(() => {
      if (ctx.state === "running") {
        scrape();
        if (L.pulse) beat();
      }
      schedule();
    }, (lo + Math.random() * (hi - lo)) * 1000);
  }

  function start() {
    if (muted) return;
    if (!ctx) build();
    if (ctx.state === "suspended") ctx.resume();
    ramp(bus.gain, FULL * volume, 1.5);
    apply(3);
  }

  function setMood(next, pageDepth = depth) {
    const changed = next !== mood;
    mood = next;
    depth = pageDepth;
    if (!ctx || muted) return;
    if (next === "dead") {
      if (changed) death();
      return;
    }
    if (changed) revive();
    apply(changed ? 2.5 : 4);
  }

  // 사망: 먹먹해짐(0~2.5초) → 박동(1.2초부터, 점점 느리고 약하게) → 삐-(박동이 멎은 뒤 4초).
  function death() {
    clearTimeout(timer);
    const now = ctx.currentTime;
    apply(0.6); // 드론은 조금 부푼 채로 먹먹해진다
    muffle.frequency.cancelScheduledValues(now);
    muffle.frequency.setValueAtTime(muffle.frequency.value, now);
    muffle.frequency.exponentialRampToValueAtTime(180, now + 2.5);
    muffle.Q.setValueAtTime(4, now); // 막힌 공간의 웅웅거림

    let at = now + 1.2;
    let gap = 0.72; // 첫 박동 간격(약 83bpm)
    let level = 1;
    while (gap < 2.3) {
      heartbeat(at, level);
      at += gap;
      gap *= 1.3; // 첫 박동부터 눈에 띄게 늘어진다
      level *= 0.82;
    }
    // 마지막 박동 다음 박동이 올 자리에서 배경이 꺼지고 신호음이 울린다.
    master.gain.setValueAtTime(1, now);
    master.gain.linearRampToValueAtTime(0.5, at - gap);
    master.gain.linearRampToValueAtTime(0, at);
    flatline(at + 0.3, 4);
  }

  // 쿵-쿵. 낮은 사인이 아래로 떨어지는 두 번. 둘째는 조금 약하다.
  function heartbeat(at, level) {
    [[0, 1], [0.19, 0.62]].forEach(([dt, k]) => {
      const t = at + dt;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 140;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.95 * level * k, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(lp).connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.32);
      dying.push(o);
    });
  }

  // 삐-. 심전도 모니터의 평탄 신호처럼 1kHz 사인이 길게 울리고 천천히 사라진다.
  function flatline(at, hold) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.09, at + 0.02);
    g.gain.setValueAtTime(0.09, at + hold);
    g.gain.linearRampToValueAtTime(0, at + hold + 1.5);
    o.connect(g).connect(bus);
    o.start(at);
    o.stop(at + hold + 1.6);
    dying.push(o);
  }

  // 새 사본: 예약된 사망 소리를 멈추고 먹먹함을 푼다.
  function revive() {
    const now = ctx.currentTime;
    dying.forEach((o) => { try { o.stop(); } catch {} });
    dying = [];
    muffle.frequency.cancelScheduledValues(now);
    muffle.frequency.setValueAtTime(muffle.frequency.value, now);
    muffle.frequency.exponentialRampToValueAtTime(20000, now + 1.5);
    muffle.Q.setValueAtTime(0.7, now);
    ramp(master.gain, 1, 1.5);
  }

  // 점프스케어 순간: 짧게 치솟는 불협 덩어리.
  function sting() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    [1, 16 / 15, 45 / 32, 15 / 8].forEach((r) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = BASE * 8 * r;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.07, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
      o.connect(g);
      g.connect(master);
      g.connect(parts.verb);
      o.start(now);
      o.stop(now + 1.7);
    });
  }

  function setMuted(off) {
    muted = off;
    try { localStorage.setItem(KEY, off ? "off" : "on"); } catch {}
    if (off) {
      clearTimeout(timer);
      if (ctx) ramp(bus.gain, 0, 0.4);
    } else {
      start();
    }
  }

  // 밀대를 끄는 동안 바로 따라오도록 짧게 옮긴다.
  function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOL_KEY, String(volume)); } catch {}
    if (ctx && !muted) ramp(bus.gain, FULL * volume, 0.08);
  }

  return { start, mood: setMood, sting, setMuted, isMuted: () => muted, setVolume, volume: () => volume };
})();
