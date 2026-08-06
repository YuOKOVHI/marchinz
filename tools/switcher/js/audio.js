"use strict";
/* ============ 音声抽出(8kHzモノラル)+音質統計 ============ */

/* MAX_SEC は入口の天井より広く取る(2026-08-05: maxSourceSec は PC15分)。
   30分のままだと、40分の回しっぱなし(PCなら入口を通る)の後半10分を
   salute/beats/sections が一切見ず、演奏が後半にあると検出が静かに外れる */
MC.audio = { SR: 8000, MAX_SEC: 2400 };

/* 線形補間のストリーミングリサンプラ(チャンクをまたいで連続) */
MC.audio.LinearResampler = class {
  constructor(fromRate, toRate) {
    this.ratio = fromRate / toRate;
    this.pos = 0;        // 入力系列上の小数位置(グローバル)
    this.consumed = 0;   // これまでに捨てた入力サンプル数
    this.carry = null;   // 前チャンク末尾1サンプル
  }
  push(chunk) {
    const src = this.carry != null ? (() => {
      const a = new Float32Array(chunk.length + 1);
      a[0] = this.carry; a.set(chunk, 1);
      return a;
    })() : chunk;
    const base = this.consumed - (this.carry != null ? 1 : 0);  // srcの先頭のグローバル位置
    const out = [];
    while (this.pos + 1 < base + src.length) {
      const rel = this.pos - base;
      const i = Math.floor(rel), f = rel - i;
      out.push(src[i] * (1 - f) + src[i + 1] * f);
      this.pos += this.ratio;
    }
    this.carry = src[src.length - 1];
    this.consumed = base + src.length;
    return Float32Array.from(out);
  }
};

/* クリップの音声を8kHzモノラルFloat32Arrayで取得(clip.audio8k にキャッシュ)。
   startSec で「途中からの窓抽出」ができる(2026-07-24 窓同期)。
   - clip.audio8kStart    … 実際の開始秒(AACはフレーム境界で要求とズレるため実測値)
   - clip.audio8kReqStart … 要求した開始秒(キャッシュ判定のキー)
   - clip.audio8kReqSpan  … 要求した長さ(秒)
   窓→全尺のように条件が変わったら再抽出して上書きする。上書き時は
   窓データ由来の解析キャッシュ(beatsData/sections)を必ず捨てる */
MC.audio.extract8k = async (clip, maxSec = MC.audio.MAX_SEC, onProg = null, startSec = 0) => {
  if (clip.audio8k &&
      (clip.audio8kReqStart || 0) === startSec &&
      (clip.audio8kReqSpan || 0) >= Math.min(maxSec, Math.max(0, (clip.duration || maxSec) - startSec))) {
    return clip.audio8k;
  }
  let r = null, err1 = null;
  try {
    r = await MC.audio.viaRawPcm(clip, maxSec, onProg, startSec);   // リニアPCM(Resolve等のMOV)は生読みが最速・最軽量
    if (!r) r = await MC.audio.viaWebCodecs(clip, maxSec, onProg, startSec);
  } catch (e) {
    /* ★ 中断(onProg が false を返した)はフォールバックしない(2026-08-06 レビューP1)。
       ここで viaDecodeAudioData へ流れると「やめたのに別の方式で全部やり直す」
       最悪の逆効果になる */
    if (e && e.mzCancel) throw e;
    err1 = e;
    console.warn("[MC] WebCodecs音声抽出失敗→decodeAudioDataへ:", e.message);
    try { r = await MC.audio.viaDecodeAudioData(clip, maxSec, startSec); }
    catch (e2) {
      clip.hasAudio = false;
      throw new Error(`音声を抽出できません(${clip.name}): ${err1.message} / ${e2.message}`);
    }
  }
  if (r.pcm.length < MC.audio.SR) { clip.hasAudio = false; throw new Error(`音声が短すぎます(1秒未満): ${clip.name}`); }
  clip.hasAudio = true;
  clip.audio8k = r.pcm;
  clip.audio8kStart = r.start;
  clip.audio8kReqStart = startSec;
  clip.audio8kReqSpan = maxSec;
  clip.beatsData = null;   // 旧窓データ由来の解析を残さない(静かな汚染防止)
  clip.sections = null;
  clip.stats = MC.audio.stats(r.pcm);
  return r.pcm;
};

/* 同期用の窓: 3分超は「真ん中3分」だけ読む(2026-07-24 優さん指示)。
   短い素材は窓化の得がないので全体 */
MC.audio.WIN_SEC = 180;
MC.audio.midWindow = clip => {
  const d = clip.duration || 0;
  if (d <= MC.audio.WIN_SEC + 30) return { start: 0, span: MC.audio.MAX_SEC };
  return { start: (d - MC.audio.WIN_SEC) / 2, span: MC.audio.WIN_SEC };
};

/* リニアPCM(lpcm/sowt等)の生読み: デコーダ不要。チャンクを順に読み
   モノラル化→8kHzへ。PCMトラックが無いファイルでは null を返す。
   startSec 指定時はそこから読む(跨ぎチャンクの頭は捨ててフレーム精度で揃える) */
MC.audio.viaRawPcm = async (clip, maxSec, onProg = null, startSec = 0) => {
  const src = new MZ_MP4.MP4Source(clip.file);
  await src.init();
  if (!src.pcm) return null;
  const resampler = new MC.audio.LinearResampler(src.pcm.rate, MC.audio.SR);
  const outChunks = [];
  let total = 0;
  const maxFrames = maxSec * MC.audio.SR;
  /* 進捗の分母は「実際に読む長さ」。maxSec(上限30分)で割ると、8分音声が
     27%で完了して見えるため。duration が無ければ上限で近似(2026-07-23) */
  const target = Math.min(maxFrames,
    Math.max(1, Math.round(((clip.duration || maxSec) - startSec) * MC.audio.SR)));
  /* 窓の開始フレーム(ソースのレート基準)。pcmChunks は跨ぎチャンクを
     丸ごと返すので、最初のチャンクで頭を捨てて startSec 始まりに揃える */
  const startFrameReq = Math.max(0, Math.floor(startSec * src.pcm.rate));
  const actualStart = startFrameReq / src.pcm.rate;
  let tick = 0;
  for await (const c of src.pcmChunks(startSec)) {
    let chans = src.pcmToFloat(c.data, c.frames);
    const skip = startFrameReq - c.startFrame;
    if (skip > 0) chans = chans.map(a => a.subarray(skip));
    const mono = chans[0];
    for (let ch = 1; ch < chans.length; ch++) {
      const a = chans[ch];
      for (let i = 0; i < mono.length; i++) mono[i] += a[i];
    }
    if (chans.length > 1) for (let i = 0; i < mono.length; i++) mono[i] /= chans.length;
    const out = resampler.push(mono);
    if (out.length) { outChunks.push(out); total += out.length; }
    if (onProg && (tick++ & 7) === 0) {
      /* onProg が false を返したら中断(2026-08-06 レビューP1「やめるの死角」)。
         音の抽出は10分素材で数分かかり、ここに中断点が無いと「やめる」を
         押しても段が終わるまで「やめています…」のまま動かない */
      if (onProg(Math.min(1, total / target)) === false) {
        const e = new Error("やめました"); e.mzCancel = true; throw e;
      }
    }
    if (total >= maxFrames) break;
    await MC.yield();   // 20分素材でもUIを固めない
  }
  if (onProg) onProg(1);
  const pcm = new Float32Array(Math.min(total, maxFrames));
  let o = 0;
  for (const a of outChunks) {
    const n = Math.min(a.length, pcm.length - o);
    if (n <= 0) break;
    pcm.set(a.subarray(0, n), o); o += n;
  }
  return { pcm, start: actualStart };
};

/* 主経路: mp4boxデマックス + AudioDecoder(大きいファイルでもメモリ軽量)。
   startSec 指定時はそこからデコード。AACはフレーム境界が要求秒に一致しないため、
   最初に出てきた AudioData の実タイムスタンプを開始秒として返す(同期精度を守る) */
/* onProg(0..1) を受け取る(2026-08-01)。iPhoneのMOVはこの経路を通ることが多く、
   長尺だと数分かかるのに、進捗を出せる作りなのに渡していなかった */
MC.audio.viaWebCodecs = async (clip, maxSec, onProg = null, startSec = 0) => {
  const src = new MZ_MP4.MP4Source(clip.file);
  await src.init();
  const at = src.audioTrack();
  if (!at) throw new Error("音声トラックがありません");
  const cfg = src.audioDecoderConfig();
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error(`音声コーデック非対応: ${cfg.codec}`);

  const outChunks = [];
  let decodedSec = 0, error = null;
  let resampler = null;
  let firstTs = null;   // 実際の開始秒(最初のデコード済みフレームのタイムスタンプ)
  const decoder = new AudioDecoder({
    output: ad => {
      try {
        if (firstTs == null) firstTs = ad.timestamp / 1e6;
        const frames = ad.numberOfFrames, ch = ad.numberOfChannels;
        if (!resampler) resampler = new MC.audio.LinearResampler(ad.sampleRate, MC.audio.SR);
        // モノラルミックスダウン
        const mono = new Float32Array(frames);
        const buf = new Float32Array(frames);
        for (let c = 0; c < ch; c++) {
          ad.copyTo(buf, { planeIndex: c, format: "f32-planar" });
          for (let i = 0; i < frames; i++) mono[i] += buf[i] / ch;
        }
        const out = resampler.push(mono);
        if (out.length) outChunks.push(out);
        decodedSec += frames / ad.sampleRate;
      } finally { ad.close(); }
    },
    error: e => { error = e; },
  });
  decoder.configure(cfg);
  for await (const s of src.samples(at.id, startSec)) {
    if (error) break;
    decoder.decode(new EncodedAudioChunk({
      type: s.is_sync ? "key" : "delta",
      timestamp: Math.round(s.cts * 1e6 / s.timescale),
      duration: Math.round(s.duration * 1e6 / s.timescale),
      data: s.data,
    }));
    if (onProg) {
      if (onProg(Math.min(1, decodedSec / Math.max(1, Math.min(maxSec, clip.duration || maxSec)))) === false) {
        try { decoder.close(); } catch (_) {}
        const e = new Error("やめました"); e.mzCancel = true; throw e;
      }
    }
    if (decodedSec >= maxSec) break;
    if (decoder.decodeQueueSize > 32) await MC.waitDequeue(decoder);
  }
  if (onProg) onProg(1);
  if (!error) await decoder.flush().catch(() => {});
  try { decoder.close(); } catch (e) {}
  if (error) throw error;
  // 連結
  const total = outChunks.reduce((s, a) => s + a.length, 0);
  const pcm = new Float32Array(Math.min(total, maxSec * MC.audio.SR));
  let o = 0;
  for (const a of outChunks) {
    const n = Math.min(a.length, pcm.length - o);
    if (n <= 0) break;
    pcm.set(a.subarray(0, n), o); o += n;
  }
  return { pcm, start: firstTs != null ? firstTs : startSec };
};

/* 代替経路: decodeAudioData(ファイル全読み込みなのでサイズ制限あり。iPhoneはメモリが厳しいため控えめに) */
MC.audio.viaDecodeAudioData = async (clip, maxSec, startSec = 0) => {
  const limit = MC.isIOS ? 3e8 : 1.2e9;
  if (clip.size > limit) throw new Error(`ファイルが大きすぎます(${Math.round(limit / 1e8) / 10}GB超)`);
  const ab = await clip.file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, MC.audio.SR, MC.audio.SR);  // 8kHzへ自動リサンプル
  const buf = await ctx.decodeAudioData(ab);
  const d = buf.getChannelData(0);
  const s0 = Math.min(d.length, Math.max(0, Math.floor(startSec * MC.audio.SR)));
  const n = Math.min(d.length - s0, maxSec * MC.audio.SR);
  return { pcm: Float32Array.from(d.subarray(s0, s0 + n)), start: s0 / MC.audio.SR };
};

/* 音質統計: 有音部分の代表RMS・クリッピング率・貼りつき率・低域比率。
   ★ 全部を8kHzモノラルの1パスで測る(2026-08-02 専門家パネル合意)。
     追加コストは1サンプルあたり LPF1段+比較数回の O(n) のみ
     (旧実装は「全サンプル」「窓ごと」の2ループだったのを1つに畳んだ)。 */
MC.audio.stats = pcm => {
  const win = MC.audio.SR / 2;  // 0.5秒窓
  const rmsList = [], winR = [], winEn = [], winLf = [];
  let clipped = 0, peak = 0;
  /* ★割れの貼りつき検知(合意①): |a|>0.92 かつ前サンプルとの差がほぼ0、が
     4サンプル以上続いたらフラットトップ(割れた波形の平らな天井)とみなす。
     clipRatio(0.985超え)だけだと、録音機のリミッタが 0.985 より下で潰した
     「数値上は割れていない割れ音」を素通ししてしまう */
  let flat = 0, run = 0, prev = 0;
  /* ★風の検知の材料(合意③): 1次LPF(遮断≈120Hz)を通した低域エネルギー。
     風のボコボコは低域に集中する。窓ごとに貯めて、あとで「静かな窓」だけの
     比率を出す(演奏中はスーザフォンやバスドラの正当な低域が混ざるため) */
  const LPA = 1 - Math.exp(-2 * Math.PI * 120 / MC.audio.SR);
  let lp = 0, s = 0, lf = 0, wCount = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i], a = Math.abs(v);
    if (a > peak) peak = a;
    if (a > 0.985) clipped++;
    if (a > 0.92 && Math.abs(v - prev) < 0.004) { run++; }
    else { if (run >= 4) flat += run; run = 0; }
    prev = v;
    lp += LPA * (v - lp);
    s += v * v; lf += lp * lp;
    if (++wCount === win) {
      const r = Math.sqrt(s / win);
      winR.push(r); winEn.push(s); winLf.push(lf);   // 雑音を測るので静かな窓も残す
      if (r > 0.004) rmsList.push(r);                // 代表音量からはほぼ無音の窓を除外
      s = 0; lf = 0; wCount = 0;
    }
  }
  if (run >= 4) flat += run;
  rmsList.sort((a, b) => a - b);
  const allList = winR.slice().sort((a, b) => a - b);
  const rms = rmsList.length ? rmsList[Math.floor(rmsList.length / 2)] : 0;
  /* ★ 雑音の高さ(合意②で改定)。「静かな窓」= 代表RMSの1/4未満の窓の中央値。
     旧実装の「下から1割」は、弱奏やソロ(演奏そのもの)の窓を雑音と誤認して
     雑音を高く見積もり、静かに演奏するカメラのSNRを不当に下げていた。
     静かな窓が1つも無い(=切れ目なく鳴っている)素材だけ旧p10へフォールバック */
  const QUIET = 0.25 * rms;
  const quiet = winR.filter(r => r < QUIET).sort((a, b) => a - b);
  const noise = quiet.length ? quiet[Math.floor(quiet.length / 2)]
    : (allList.length ? allList[Math.floor(allList.length * 0.1)] : 0);
  /* ★ 低域比率(合意③): 静かな窓だけの Σ(LPF出力²)/Σ(全体²)。
     演奏の合間まで低域が鳴り続けている=風・ハンドリングノイズ。
     静かな窓が無ければ判定不能として0(演奏の正当な低域で誤検知しない) */
  let lfSum = 0, enSum = 0;
  for (let i = 0; i < winR.length; i++) {
    if (winR[i] < QUIET) { lfSum += winLf[i]; enSum += winEn[i]; }
  }
  const lfRatio = enSum > 1e-9 ? lfSum / enSum : 0;
  return { rms, clipRatio: clipped / pcm.length, peak, noise,
           flatRun: pcm.length ? flat / pcm.length : 0, lfRatio };
};

/* カード表示用の一言判定(2026-08-02)。recommend と同じ材料から
   「音割れあり」「風の音あり」を出す。閾値は recommend の減点と揃える:
   broken=減点が満点(40)の半分以上 / wind=減点の発動条件そのもの */
MC.audio.flags = s => {
  if (!s) return { broken: false, wind: false };
  return {
    broken: Math.min(1, (s.clipRatio || 0) * 400 + (s.flatRun || 0) * 200) >= 0.5,
    wind: (s.lfRatio || 0) > 0.6,
  };
};

/* 音声トラックのおすすめ: 雑音が少なく、割れていないものを選ぶ。
   ★ 大きさでは選ばない(2026-08-01 優さん指示)。大きい音がきれいな音とは
     かぎらない ─ 近すぎるマイクは大きいが割れているし、客席のど真ん中は
     大きいが雑音まみれ。大きさは書き出しのときに自動でそろえるので、
     選ぶ基準からは外す */
MC.audio.recommend = () => {
  const cands = MC.S.clips.filter(c => c.stats);
  if (!cands.length) return null;
  const db = v => 20 * Math.log10(Math.max(v, 1e-6));
  const score = c => {
    const s = c.stats;
    if (!s.rms) return -1e9;
    /* 雑音に対して演奏がどれだけ立っているか。これが「きれいさ」の本体 */
    const snr = db(s.rms) - db(Math.max(s.noise || 0, 1e-5));
    /* 割れているものは、どれだけ雑音が少なくても採らない(重い減点)。
       ★ clipRatio(天井超え)に加えて flatRun(貼りつき)も見る(2026-08-02 合意①):
         録音機のリミッタで潰された素材は天井に届かないまま割れている */
    const broken = Math.min(1, (s.clipRatio || 0) * 400 + (s.flatRun || 0) * 200) * 40;
    /* 天井に貼りついている=これから割れる。割れの一歩手前も避ける */
    const hot = (s.peak || 0) > 0.995 ? 12 : 0;
    /* ★ 風(合意③): 演奏の合間まで低域が鳴り続けているカメラは減点。
       lfRatio は「静かな窓」だけで測っているので、演奏の正当な低域では発動しない */
    const wind = (s.lfRatio || 0) > 0.6 ? 8 : 0;
    return snr - broken - hot - wind;
  };
  return cands.reduce((best, c) => (score(c) > score(best) ? c : best), cands[0]);
};

/* ============ 音をきれいにする(2026-08-01 優さん決定で2機能に絞った) ============
   おまかせで書き出すとき、選んだ音にすることは**2つだけ**。
     ① 音量をそろえる … 測った平均の高さ(RMS)を目安に持ち上げる(上限2.5倍)。
                        下げはしない(gain の下限は1)
     ② 音割れを防ぐ   … 天井(0.97)を超えそうなら「潰す」のではなく「下げる」
                        本物のリミッタ。左右まとめて下げて音の位置を守る
   ①の根拠がピークでなくRMSなのは、stats が8kHzへ間引いた信号から測るため
   (間引きは打点の尖りを拾えない。ピーク基準だと×2.55のような過大ゲインになり、
    打楽器が天井に張りついて平らに潰れる ─ 2026-08-01 レビューで実測)。
   実際のピークの面倒は②が48kHzの実サンプルを見て見る。

   ★ 70Hzハイパスと「雑音より下を沈める」(下方エキスパンダ)は
     優さんの決定で**両方とも削除した**(2026-08-01)。
     エキスパンダは演奏の弱奏・間・語りを狙い撃ちで沈める(害>益)。
     ハイパスはスーザフォンやバスドラの最低域まで削りうる。
     雑音は「雑音の少ないカメラを選ぶ」(recommend)の仕事とする。

   状態は gain(固定) と red(リミッタの下げ量) だけ。
   red は窓をまたいで続くので、書き出し1回につき1つ作って使い回すこと。 */
MC.audio.Polish = class {
  constructor(stats, sr) {
    const s = stats || {};
    this.measured = !!(s.rms > 0);
    /* 測れていない素材は素通し。既定値で走らせて黙って持ち上げない */
    const TARGET = 0.10;                       // 約 -20dBFS。放送より控えめ
    this.gain = this.measured
      ? Math.max(1, Math.min(2.5, TARGET / Math.max(s.rms, 1e-4))) : 1;
    this.red = 1;       // いまの下げ量(1=下げていない)
    this.sr = sr;
    this.CEIL = 0.97;   // 天井。整数へ落とすときの余裕を残す
  }

  /* 左右まとめて整える。buf の oL/oR から n サンプルずつ、その場で書き換える */
  runStereo(buf, oL, oR, n) {
    /* 測れていない素材は本当に素通しにする(1サンプルも触らない)。
       画面は「音はそのまま入れます」と言う ─ 言行を一致させる */
    if (!this.measured) return;
    const g = this.gain, CEIL = this.CEIL;
    /* ゲインが1(=そろえる必要がない)なら、リミッタも仕事が無い ─
       入力は既に±1.0の中にあり、0.97超えは元の素材の音なので触らない。
       「何もしない」を明示しておくと、無音の疑いをこの関数から外せる */
    if (g === 1) return;
    const LA = 1 - Math.exp(-1 / (0.001 * this.sr));   // リミッタは1msで掴む
    const LR = 1 - Math.exp(-1 / (0.150 * this.sr));   // 戻りは150ms
    for (let i = 0; i < n; i++) {
      // ① 音量をそろえる
      let vl = buf[oL + i] * g, vr = buf[oR + i] * g;
      // ② 天井を超えそうなら「潰す」のではなく「下げる」(本物のリミッタ)
      const A = Math.max(Math.abs(vl), Math.abs(vr));
      const want = A > CEIL ? CEIL / A : 1;
      this.red += (want < this.red ? LA : LR) * (want - this.red);
      vl *= this.red; vr *= this.red;
      // 保険。ここへ来るのは立ち上がりの1〜2サンプルだけ
      if (vl > CEIL) vl = CEIL; else if (vl < -CEIL) vl = -CEIL;
      if (vr > CEIL) vr = CEIL; else if (vr < -CEIL) vr = -CEIL;
      buf[oL + i] = vl; buf[oR + i] = vr;
    }
  }
};
