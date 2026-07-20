"use strict";

/* File.slice().arrayBuffer() の共通入口。
   2〜3GB の素材を3本同時に開くと、macOS Chrome では読み取りが一時的に
   失敗して NotReadableError になることがある(実素材テストで発生)。
   多くは再試行で通るので、間隔を空けて数回まで読み直す。
   それでも駄目なときは、何が起きたか分かる日本語にして投げ直す。 */
MC.readSlice = async (file, start, end) => {
  const TRIES = 4;
  let last = null;
  for (let i = 0; i < TRIES; i++) {
    try {
      return await file.slice(start, end).arrayBuffer();
    } catch (e) {
      last = e;
      MC.log(`読み直し ${i + 1}/${TRIES}: ${file.name} @${start}〜${end} (${e.name || "?"}: ${e.message || e})`);
      if (i === TRIES - 1) break;
      // 並行読みのぶつかりが原因のことが多いため、待ってから開け直す
      await new Promise(r => setTimeout(r, 150 * (i + 1)));
    }
  }
  const err = new Error(
    `ファイルを読み込めませんでした（${file.name}）。\n` +
    `メモリ不足で起きることが多いエラーです。他のタブ（特に別の書き出し）や` +
    `使っていないアプリを閉じて、もう一度お試しください。\n` +
    `ファイルを移動・変名した場合は、ページを再読み込みして選び直してください。`);
  err.cause = last;
  throw err;
};

/* ============ mp4box.js ラッパ: MP4/MOVのデマックス ============
   1インスタンス=1回の抽出用途で使う(状態を単純に保つ)。

   カメラ・編集ソフト(DaVinci Resolve等)のMOVには2つの地雷があり、どちらも
   タブごと落ちる。ここで両方を吸収する:
   ① moovがファイル末尾にある(fastStartなし)
      → 先頭から順に食わせると数GBのmdatを読むことになる。
        トップレベルのボックスを自前で歩き、moovだけを読んで食わせる。
   ② 音声がリニアPCM(lpcm等)だと「1サンプル=1フレーム」で記録され、
      20分素材でサンプル数が5,000万を超える。mp4boxは全サンプルを
      オブジェクト配列に展開するため、そのままではメモリで死ぬ。
      → moovからPCM音声トラックを切除してからmp4boxへ食わせ、
        音声はチャンク表だけの自前リーダー(this.pcm)で生読みする。
        生PCMはデコーダ不要なのでこれで完結する。 */

MC.MP4Source = class {
  constructor(file) { this.file = file; this.info = null; this.mp4 = null; this.pcm = null; }

  /* ---- 低レベル: バイト読み ---- */
  async _read(start, end) {
    return new DataView(await MC.readSlice(this.file, start, Math.min(end, this.file.size)));
  }

  /* トップレベルのボックス一覧(ヘッダだけを飛び石で読む。mdatの中身は読まない) */
  async _scanTopBoxes() {
    const out = [];
    let pos = 0;
    while (pos < this.file.size - 8 && out.length < 64) {
      const dv = await this._read(pos, pos + 16);
      if (dv.byteLength < 8) break;
      let size = dv.getUint32(0);
      const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
      if (size === 1) {
        if (dv.byteLength < 16) break;
        size = Number(dv.getBigUint64(8));
      } else if (size === 0) {
        size = this.file.size - pos;
      }
      if (size < 8) break;
      out.push({ type, start: pos, size });
      pos += size;
    }
    return out;
  }

  /* バッファ内の子ボックスを列挙 */
  static *_children(dv, start, end) {
    let pos = start;
    while (pos < end - 8) {
      let size = dv.getUint32(pos);
      const type = String.fromCharCode(
        dv.getUint8(pos + 4), dv.getUint8(pos + 5), dv.getUint8(pos + 6), dv.getUint8(pos + 7));
      let body = pos + 8;
      if (size === 1) { size = Number(dv.getBigUint64(pos + 8)); body = pos + 16; }
      else if (size === 0) { size = end - pos; }
      if (size < 8) return;
      yield { type, start: pos, size, body };
      pos += size;
    }
  }

  /* trakボックスから種別(vide/soun/tmcd)とstblの各表位置を取り出す */
  static _parseTrak(dv, trak) {
    const t = { kind: null, stsd: null, stts: null, stsc: null, stsz: null, stco: null, co64: null };
    const dive = (start, end) => {
      for (const b of MC.MP4Source._children(dv, start, end)) {
        if (b.type === "mdia" || b.type === "minf" || b.type === "stbl") {
          dive(b.body, b.start + b.size);
        } else if (b.type === "hdlr" && !t.kind) {
          t.kind = String.fromCharCode(
            dv.getUint8(b.body + 8), dv.getUint8(b.body + 9),
            dv.getUint8(b.body + 10), dv.getUint8(b.body + 11));
        } else if (["stsd", "stts", "stsc", "stsz", "stco", "co64"].includes(b.type)) {
          t[b.type] = b;
        }
      }
    };
    dive(trak.body, trak.start + trak.size);
    return t;
  }

  /* PCM系サウンドエントリの実フォーマット(QuickTime lpcm version2の配置に対応)。
     PCMでなければ null(AAC等は従来どおりmp4boxに任せる) */
  static _parsePcmEntry(dv, stsd) {
    const p = stsd.body + 8;   // stsd: ver/flags(4)+entry_count(4) → 先頭エントリ
    const fourcc = String.fromCharCode(
      dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    const PCM_DEFAULT = {
      sowt: { bits: 16, float: false, be: false },
      twos: { bits: 16, float: false, be: true },
      in24: { bits: 24, float: false, be: true },
      in32: { bits: 32, float: false, be: true },
      fl32: { bits: 32, float: true, be: true },
      fl64: { bits: 64, float: true, be: true },
      lpcm: null,   // version2のフラグから読む
    };
    if (!(fourcc in PCM_DEFAULT)) return null;
    const base = p + 8 + 8;    // boxヘッダ8 + reserved6+dref_index2
    const version = dv.getUint16(base);
    let fmt;
    if (version === 2) {
      // v2レイアウト(sizeOfStructOnlyを含む):
      //   rate(f64)@+24 ch(u32)@+32 constBitsPerChannel(u32)@+40 formatFlags(u32)@+44
      // (実ファイルのバイト列で検算済み: Resolve書き出しMOV = 48000Hz/2ch/24bit/flags 0xc)
      const flags = dv.getUint32(base + 44);
      fmt = {
        fourcc,
        rate: dv.getFloat64(base + 24),
        ch: dv.getUint32(base + 32),
        bits: dv.getUint32(base + 40),
        float: !!(flags & 1),
        be: !!(flags & 2),
        nonInterleaved: !!(flags & 32),
      };
    } else {
      // v0/v1: ch(u16)@+8 bits(u16)@+10 rate(16.16固定小数)@+16
      const d = PCM_DEFAULT[fourcc] || { bits: dv.getUint16(base + 10), float: false, be: true };
      fmt = {
        fourcc,
        rate: dv.getUint32(base + 16) >>> 16,
        ch: dv.getUint16(base + 8),
        bits: d.bits, float: d.float, be: d.be,
        nonInterleaved: false,
      };
    }
    if (!(fmt.rate > 0) || !(fmt.ch > 0) || !(fmt.bits > 0)) return null;
    return fmt;
  }

  /* PCMトラックのチャンク表(位置とフレーム数)を組み立てる */
  static _buildPcmChunks(dv, trak, fmt) {
    const totalFrames = dv.getUint32(trak.stsz.body + 8);   // sample_size固定→countが総フレーム
    const co = trak.co64 || trak.stco;
    const co64 = !!trak.co64;
    const nChunks = dv.getUint32(co.body + 4);
    const nStsc = dv.getUint32(trak.stsc.body + 4);
    const stsc = [];
    for (let i = 0; i < nStsc; i++) {
      const o = trak.stsc.body + 8 + i * 12;
      stsc.push({ first: dv.getUint32(o), spc: dv.getUint32(o + 4) });
    }
    const chunks = [];
    let frameBase = 0, si = 0;
    for (let c = 1; c <= nChunks; c++) {
      while (si + 1 < stsc.length && stsc[si + 1].first <= c) si++;
      const frames = stsc[si].spc;
      const offset = co64
        ? Number(dv.getBigUint64(co.body + 8 + (c - 1) * 8))
        : dv.getUint32(co.body + 8 + (c - 1) * 4);
      chunks.push({ offset, frames, startFrame: frameBase });
      frameBase += frames;
    }
    return { chunks, totalFrames: Math.min(totalFrames || frameBase, frameBase) };
  }

  async init() {
    const mp4 = this.mp4 = MP4Box.createFile();
    let readyResolve;
    const ready = new Promise(r => { readyResolve = r; });
    mp4.onReady = info => { this.info = info; readyResolve(); };
    mp4.onError = e => console.warn("[MC] mp4box:", e);

    const layout = await this._scanTopBoxes();
    const moovBox = layout.find(b => b.type === "moov");
    if (moovBox && moovBox.size < (64 << 20)) {
      // moovを直接読む(先頭でも末尾でも、mdatは一切読まない)
      const dv = await this._read(moovBox.start, moovBox.start + moovBox.size);
      let feed = dv.buffer;
      const cut = [];
      for (const b of MC.MP4Source._children(dv, 8, moovBox.size)) {
        if (b.type !== "trak") continue;
        const info = MC.MP4Source._parseTrak(dv, b);
        if (info.kind !== "soun" || !info.stsd || !info.stsz || !info.stsc || !(info.stco || info.co64)) continue;
        const fmt = MC.MP4Source._parsePcmEntry(dv, info.stsd);
        if (!fmt) continue;
        const table = MC.MP4Source._buildPcmChunks(dv, info, fmt);
        this.pcm = {
          rate: fmt.rate, ch: fmt.ch, bits: fmt.bits,
          float: fmt.float, be: fmt.be, nonInterleaved: fmt.nonInterleaved,
          bytesPerFrame: (fmt.bits / 8) * fmt.ch,
          totalFrames: table.totalFrames,
          duration: table.totalFrames / fmt.rate,
          chunks: table.chunks,
        };
        cut.push(b);
        if (window.MC && MC.log) MC.log(
          `PCM音声を自前リーダーで扱います: ${fmt.fourcc} ${fmt.rate}Hz ${fmt.ch}ch ${fmt.bits}bit frames=${table.totalFrames}`);
      }
      if (cut.length) {
        // moovからPCMのtrakを切除した新バッファを作り、moovヘッダのサイズを更新
        const src = new Uint8Array(dv.buffer);
        const keep = [];
        let pos = 0;
        for (const c of cut.sort((a, b2) => a.start - b2.start)) {
          keep.push(src.subarray(pos, c.start));
          pos = c.start + c.size;
        }
        keep.push(src.subarray(pos));
        const total = keep.reduce((a, k) => a + k.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const k of keep) { out.set(k, o); o += k.length; }
        new DataView(out.buffer).setUint32(0, total);
        feed = out.buffer;
      }
      // ファイル順に食わせる。mdatは「ヘッダだけ」を渡すと、mp4boxが
      // incomplete box として末尾まで正規にスキップしてくれる(中身は読まない)。
      // これでバッファの連続性が保たれ、末尾のmoovまでパーサが到達する
      for (const b of layout) {
        let ab;
        if (b.type === "moov") {
          ab = feed;
        } else if (b.type === "mdat" || b.size > (8 << 20)) {
          ab = await MC.readSlice(this.file, b.start, b.start + 16);
        } else {
          ab = await MC.readSlice(this.file, b.start, b.start + b.size);
        }
        ab.fileStart = b.start;
        mp4.appendBuffer(ab);
        if (this.info) break;
      }
      mp4.flush();
    } else {
      // moovが見つからない/異常に大きい: 従来どおり先頭から(mdatは戻り値でスキップ)
      const CH = 4 << 20;
      let pos = 0;
      while (!this.info && pos < this.file.size) {
        const ab = await MC.readSlice(this.file, pos, Math.min(pos + CH, this.file.size));
        ab.fileStart = pos;
        const next = mp4.appendBuffer(ab);
        pos = (typeof next === "number" && next > pos) ? next : pos + ab.byteLength;
      }
    }
    if (!this.info) await Promise.race([ready, new Promise(r => setTimeout(r, 3000))]);
    if (!this.info) throw new Error("MP4/MOVとして解析できません: " + this.file.name);
    return this.info;
  }

  videoTrack() { return (this.info.videoTracks || [])[0] || null; }
  audioTrack() { return (this.info.audioTracks || [])[0] || null; }
  sampleEntry(trackId) {
    return this.mp4.getTrackById(trackId).mdia.minf.stbl.stsd.entries[0];
  }

  /* ---- PCM音声の生読み: fromSec以降をチャンク単位で返す async generator ---- */
  async *pcmChunks(fromSec = 0) {
    if (!this.pcm) return;
    const startFrame = Math.max(0, Math.floor(fromSec * this.pcm.rate));
    for (const c of this.pcm.chunks) {
      if (c.startFrame + c.frames <= startFrame) continue;
      const bytes = c.frames * this.pcm.bytesPerFrame;
      const ab = await MC.readSlice(this.file, c.offset, c.offset + bytes);
      yield { data: new Uint8Array(ab), startFrame: c.startFrame, frames: c.frames };
    }
  }

  /* PCMチャンク1個をチャンネル別Float32へ(16/24/32bit整数・float・BE/LE対応) */
  pcmToFloat(bytes, frames) {
    const f = this.pcm;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bp = f.bits / 8;
    const n = Math.min(frames, Math.floor(bytes.byteLength / (bp * f.ch)));
    const chans = [];
    for (let c = 0; c < f.ch; c++) chans.push(new Float32Array(n));
    const le = !f.be;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < f.ch; c++) {
        const off = (f.nonInterleaved ? (c * n + i) : (i * f.ch + c)) * bp;
        let v;
        if (f.float) v = f.bits === 64 ? dv.getFloat64(off, le) : dv.getFloat32(off, le);
        else if (f.bits === 16) v = dv.getInt16(off, le) / 32768;
        else if (f.bits === 24) {
          const b0 = dv.getUint8(off), b1 = dv.getUint8(off + 1), b2 = dv.getUint8(off + 2);
          let x = le ? ((b2 << 16) | (b1 << 8) | b0) : ((b0 << 16) | (b1 << 8) | b2);
          if (x & 0x800000) x -= 0x1000000;
          v = x / 8388608;
        } else if (f.bits === 32) v = dv.getInt32(off, le) / 2147483648;
        else if (f.bits === 8) v = (dv.getUint8(off) - 128) / 128;
        else v = 0;
        chans[c][i] = v;
      }
    }
    return chans;
  }

  /* tkhd行列から回転角(0/90/180/270)。<video>は自動適用するがVideoDecoderは適用しない */
  rotationOf(track) {
    const m = track.matrix;
    if (!m) return 0;
    const a = m[0] / 65536, b = m[1] / 65536;
    const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI);
    return ((deg % 360) + 360) % 360;
  }

  videoDecoderConfig() {
    const t = this.videoTrack();
    if (!t) return null;
    const entry = this.sampleEntry(t.id);
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    let description;
    if (box) {
      const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(ds);
      description = new Uint8Array(ds.buffer, 8);  // 先頭8バイトのボックスヘッダを除く
    }
    return { codec: t.codec, codedWidth: t.video.width, codedHeight: t.video.height, description };
  }

  audioDecoderConfig() {
    const t = this.audioTrack();
    if (!t) return null;
    let description;
    try {
      const esds = this.sampleEntry(t.id).esds;
      if (esds) description = MC.MP4Source.findTag5(esds.esd);
    } catch (e) { /* esds無し(PCM等)はdescription無しで試す */ }
    const sampleRate = t.audio.sample_rate || t.audio.samplerate;
    const numberOfChannels = t.audio.channel_count;
    let codec = t.codec;
    // MOV(QuickTime)はesdsが深い階層にあり codec が "mp4a" としか分からないことがある。
    // カメラ収録の実体はほぼAAC-LCなので補正し、無いASC(2バイト)も自前で組む
    if (/^mp4a(?!\.)/.test(codec)) codec = "mp4a.40.2";
    if (/^mp4a\.40/.test(codec) && !description) {
      const FREQ = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const fi = FREQ.indexOf(sampleRate);
      if (fi >= 0 && numberOfChannels >= 1 && numberOfChannels <= 7) {
        const bits = (2 << 11) | (fi << 7) | (numberOfChannels << 3);  // AAC-LC + freq + ch
        description = new Uint8Array([bits >> 8, bits & 0xff]);
      }
    }
    if (codec === "sowt") codec = "pcm-s16";   // QuickTimeの16bit LE PCM
    return {
      codec,
      sampleRate,
      numberOfChannels,
      description: description || undefined,
    };
  }

  /* エディットリストによるメディア先頭スキップ(秒)。AACプライミング等 */
  editOffsetSec(track) {
    try {
      const e = (track.edits || []).find(x => x.media_rate_integer === 1 && x.media_time > 0);
      if (!e) return 0;
      const mts = this.mp4.getTrackById(track.id).mdia.mdhd.timescale;
      return e.media_time / mts;
    } catch (err) { return 0; }
  }

  /* esdsからDecoderSpecificInfo(tag 0x05 = AudioSpecificConfig)を再帰探索 */
  static findTag5(desc) {
    if (!desc) return null;
    if (desc.tag === 5 && desc.data) return desc.data;
    for (const d of (desc.descs || [])) {
      const r = MC.MP4Source.findTag5(d);
      if (r) return r;
    }
    return null;
  }

  /* fromSec以降のサンプルを順に返す async generator(直前のRAPから始まる)。
     圧縮サンプルのみ保持するのでメモリは軽い。 */
  async *samples(trackId, fromSec = 0) {
    const mp4 = this.mp4;
    const queue = [];
    mp4.onSamples = (id, user, arr) => {
      // release前に必要フィールドを退避(releaseUsedSamplesはsample.dataを解放する)
      for (const s of arr) {
        queue.push({
          data: s.data, is_sync: s.is_sync,
          cts: s.cts, duration: s.duration, timescale: s.timescale, number: s.number,
        });
      }
      if (arr.length) {
        try { mp4.releaseUsedSamples(id, arr[arr.length - 1].number); } catch (e) {}
      }
    };
    mp4.setExtractionOptions(trackId, null, { nbSamples: 64 });
    let pos = 0;
    if (fromSec > 0) {
      try {
        const sk = mp4.seek(fromSec, true);
        pos = sk && sk.offset ? sk.offset : 0;
      } catch (e) { pos = 0; }
    }
    mp4.start();
    const CH = 4 << 20;
    let eof = false;
    while (true) {
      while (queue.length) yield queue.shift();
      if (eof) break;
      if (pos >= this.file.size) {
        mp4.flush();
        eof = true;
        continue;
      }
      const ab = await MC.readSlice(this.file, pos, Math.min(pos + CH, this.file.size));
      ab.fileStart = pos;
      mp4.appendBuffer(ab);
      pos += ab.byteLength;
    }
  }
};
