"use strict";
/* ============ 音声抽出(8kHzモノラル)+音質統計 ============ */

/* MAX_SEC は入口の天井(limits.js maxSourceSec: PC40分)と揃える(2026-07-31)。
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
    if (onProg && (tick++ & 7) === 0) onProg(Math.min(1, total / target));
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
    if (onProg) onProg(Math.min(1, decodedSec / Math.max(1, Math.min(maxSec, clip.duration || maxSec))));
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

/* 音質統計: 有音部分の代表RMSとクリッピング率 */
MC.audio.stats = pcm => {
  const win = MC.audio.SR / 2;  // 0.5秒窓
  const rmsList = [], allList = [];
  let clipped = 0, peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    if (a > 0.985) clipped++;
  }
  for (let o = 0; o + win <= pcm.length; o += win) {
    let s = 0;
    for (let i = o; i < o + win; i++) s += pcm[i] * pcm[i];
    const r = Math.sqrt(s / win);
    allList.push(r);                 // 雑音の高さを測るので静かな窓も残す
    if (r > 0.004) rmsList.push(r);  // 代表音量からはほぼ無音の窓を除外
  }
  rmsList.sort((a, b) => a - b);
  allList.sort((a, b) => a - b);
  const rms = rmsList.length ? rmsList[Math.floor(rmsList.length / 2)] : 0;
  /* ★ 雑音の高さ(2026-08-01)。静かな窓の代表値を見る ─ 演奏の合間に
     残っている風・空調・客席のざわつきがここに出る。
     いちばん静かな1窓だと、たまたま無音の瞬間を拾って0になるので下から1割 */
  const noise = allList.length ? allList[Math.floor(allList.length * 0.1)] : 0;
  return { rms, clipRatio: clipped / pcm.length, peak, noise };
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
    /* 割れているものは、どれだけ雑音が少なくても採らない(重い減点) */
    const broken = Math.min(1, (s.clipRatio || 0) * 400) * 40;
    /* 天井に貼りついている=これから割れる。割れの一歩手前も避ける */
    const hot = (s.peak || 0) > 0.995 ? 12 : 0;
    return snr - broken - hot;
  };
  return cands.reduce((best, c) => (score(c) > score(best) ? c : best), cands[0]);
};

/* ============ ③ 音をきれいにする(2026-08-01 優さん指示) ============
   おまかせで書き出すとき、選んだ音にこの順で手を入れる。
     ① 低い唸りを落とす      … 風・空調・足音・机の振動
     ② 測った雑音より下を沈める … 演奏の合間のざわつき。切らずに沈める
     ③ ピークを天井の少し下へ  … 大きさは人が決めなくていい
     ④ 超えた分は角を丸める    … 新しい音割れを作らない
   窓をまたいで状態が続くので、書き出し1回につき1つ作って使い回すこと。 */
MC.audio.Polish = class {
  constructor(stats, sr) {
    const s = stats || {};
    /* ★ ゲインの根拠を「ピーク」から「音の平均の高さ」へ替えた
       (2026-08-01 レビュー 重大)。
       stats は 8kHz へ間引いた信号から測っている(MC.audio.SR = 8000)。
       シンバルやスネアの打点は 48kHz では1〜2サンプルの尖りなので、
       6分の1に間引く線形補間ではその点をほぼ拾えない。
       実測ピーク 0.9 の素材が 8k では 0.35 に見え、0.891/0.35 = ×2.55 を
       48kHz の原信号に掛けると真のピークは 2.3 ─ 打点のたびに
       天井へ張りついて**平らに潰れる**。「割れを直す」つもりの処理が
       打楽器を潰す、といういちばん困る壊れ方だった。
       平均の高さ(RMS)は間引きに強い。こちらを根拠にし、上げ幅も控えめにする。
       ピークの面倒は、下の本物のリミッタが実際の 48kHz サンプルを見て見る */
    this.measured = !!(s.rms > 0);
    /* 測れていない素材は素通し。既定値で走らせて黙って持ち上げない */
    const TARGET = 0.10;                       // 約 -20dBFS。放送より控えめ
    this.gain = this.measured
      ? Math.max(1, Math.min(2.5, TARGET / Math.max(s.rms, 1e-4))) : 1;
    /* 沈める境目。★ 単位を合わせる(2026-08-01 レビュー 中)。
       noise は0.5秒窓のRMSなので、比べる側も**RMSの包絡**にする。
       前はピーク包絡と比べていたため、同じ音でも1.5〜3倍ずれて
       「雑音より下を沈める」がほとんど発火していなかった */
    this.thr = Math.max(1e-4, (s.noise || 0) * 2.5);
    const rc = 1 / (2 * Math.PI * 70);      // 70Hz以下を落とす
    this.a = rc / (rc + 1 / sr);
    this.hp = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    /* 沈める判断とリミッタは左右で**まとめて**決める。
       別々にすると、片側だけ下がって音の位置が動く */
    this.env2 = 0;      // RMSの二乗の包絡
    this.red = 1;       // いまの下げ量(1=下げていない)
    this.sr = sr;
    this.CEIL = 0.97;   // 天井。整数へ落とすときの余裕を残す
  }

  /* 左右まとめて整える。buf の oL/oR から n サンプルずつ、その場で書き換える */
  runStereo(buf, oL, oR, n) {
    const a = this.a, g = this.gain, thr2 = this.thr * this.thr, CEIL = this.CEIL;
    const hL = this.hp[0], hR = this.hp[1];
    /* 包絡の時定数。sr に対して実時間で決める(端末やSRが変わってもぶれない) */
    const ATK = 1 - Math.exp(-1 / (0.005 * this.sr));   // 5ms
    const REL = 1 - Math.exp(-1 / (0.200 * this.sr));   // 200ms
    const LA  = 1 - Math.exp(-1 / (0.001 * this.sr));   // リミッタは1msで掴む
    const LR  = 1 - Math.exp(-1 / (0.150 * this.sr));   // 戻りは150ms
    for (let i = 0; i < n; i++) {
      // ① 低い唸り(風・空調・足音)を落とす
      const xl = buf[oL + i], xr = buf[oR + i];
      const yl = a * (hL.y + xl - hL.x); hL.x = xl; hL.y = yl;
      const yr = a * (hR.y + xr - hR.x); hR.x = xr; hR.y = yr;
      // ② 測った雑音より下を沈める(単位はRMS同士で比べる)
      const p = (yl * yl + yr * yr) * 0.5;
      this.env2 += (p > this.env2 ? ATK : REL) * (p - this.env2);
      let k = 1;
      if (this.env2 < thr2) { const r = this.env2 / thr2; k = r; }   // r=(env/thr)^2
      // ③ 音の高さをそろえる
      let vl = yl * k * g, vr = yr * k * g;
      /* ④ 天井を超えそうなら「潰す」のではなく「下げる」。
         これが本物のリミッタ。角を丸めるだけだと、見込みを外したとき
         打点が軒並みフラットトップになる */
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
