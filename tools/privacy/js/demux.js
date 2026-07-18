"use strict";
/* ============ mp4box.js ラッパ: MP4/MOVのデマックス ============
   1インスタンス=1回の抽出用途で使う(状態を単純に保つ)。
   moov探索は appendBuffer の戻り値(次に読むべき位置)を尊重して mdat をスキップ。 */

MZ.MP4Source = class {
  constructor(file) { this.file = file; this.info = null; this.mp4 = null; }

  async init() {
    const mp4 = this.mp4 = MP4Box.createFile();
    let readyResolve;
    const ready = new Promise(r => { readyResolve = r; });
    mp4.onReady = info => { this.info = info; readyResolve(); };
    mp4.onError = e => console.warn("[MZ] mp4box:", e);
    const CH = 4 << 20;
    let pos = 0;
    while (!this.info && pos < this.file.size) {
      const ab = await this.file.slice(pos, Math.min(pos + CH, this.file.size)).arrayBuffer();
      ab.fileStart = pos;
      const next = mp4.appendBuffer(ab);
      pos = (typeof next === "number" && next > pos) ? next : pos + ab.byteLength;
    }
    if (!this.info) throw new Error("MP4/MOVとして解析できません: " + this.file.name);
    return this.info;
  }

  videoTrack() { return (this.info.videoTracks || [])[0] || null; }
  audioTrack() { return (this.info.audioTracks || [])[0] || null; }
  sampleEntry(trackId) {
    return this.mp4.getTrackById(trackId).mdia.minf.stbl.stsd.entries[0];
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
      if (esds) description = MZ.MP4Source.findTag5(esds.esd);
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
      const r = MZ.MP4Source.findTag5(d);
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
      const ab = await this.file.slice(pos, Math.min(pos + CH, this.file.size)).arrayBuffer();
      ab.fileStart = pos;
      mp4.appendBuffer(ab);
      pos += ab.byteLength;
    }
  }
};
