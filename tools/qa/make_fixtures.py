#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MarchinZ 映像ツール用 合成テスト素材ジェネレータ(依存ゼロ / ffmpeg不要)

目的: 「moov が末尾にある MOV」を人工的に作り、demux.js の静かな黒抜けバグを
      自動検知できるようにする。

出力(scratchpad/mzqa/fixtures/):
  moov_tail.mp4  … ftyp + mdat + moov   ← 事故を再現する形(Resolve書き出しMOV相当)
  moov_head.mp4  … ftyp + moov + mdat   ← 対照(faststart済み)
両者はサンプル表もmdatの中身も完全に同一で、moov の位置だけが違う。
"""
import struct, os, json

NS = 30          # サンプル数
SAMPLE_SZ = 96   # 1サンプルのバイト数(ダミー)
TMCD_SZ = 4      # タイムコードトラックの1サンプル(4バイト)
TIMESCALE = 30000
SAMPLE_DUR = 1001   # 29.97fps
W, H = 320, 180


def box(t, payload):
    return struct.pack(">I", 8 + len(payload)) + t + payload


def fullbox(t, ver, flags, payload):
    return box(t, struct.pack(">B3s", ver, flags.to_bytes(3, "big")) + payload)


def ftyp():
    return box(b"ftyp", b"isom" + struct.pack(">I", 512) + b"isomiso2avc1mp41")


def mvhd(dur):
    p = struct.pack(">IIII", 0, 0, 1000, int(dur * 1000 / TIMESCALE * SAMPLE_DUR / SAMPLE_DUR))
    p = struct.pack(">IIII", 0, 0, 1000, int(NS * SAMPLE_DUR * 1000 / TIMESCALE))
    p += struct.pack(">iI", 0x00010000, 0x0100 << 16)
    p += b"\x00" * 10
    p += struct.pack(">9i", 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
    p += b"\x00" * 24
    p += struct.pack(">I", 2)   # next track id
    return fullbox(b"mvhd", 0, 0, p)


def tkhd(track_id=1):
    p = struct.pack(">IIIII", 0, 0, track_id, 0, int(NS * SAMPLE_DUR * 1000 / TIMESCALE))
    p += b"\x00" * 8
    p += struct.pack(">hhhh", 0, 0, 0, 0)
    p += struct.pack(">9i", 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
    p += struct.pack(">II", W << 16, H << 16)
    return fullbox(b"tkhd", 0, 3, p)


def mdhd():
    p = struct.pack(">IIIIHH", 0, 0, TIMESCALE, NS * SAMPLE_DUR, 0x55C4, 0)
    return fullbox(b"mdhd", 0, 0, p)


# ---- タイムコード(tmcd)トラック ----
# 実素材(DaVinci Resolve / 業務用カメラのMOV)には、映像・音声のほかに
# 「サンプルが1個だけ」のタイムコードトラックが入っている。その1サンプルは
# mdat の**いちばん先頭**に置かれる。mp4box の ISOFile.seek() は
# 全トラックのオフセットの**最小値**を返す仕様なので、この1サンプルが
# 常に最小になり、どこへシークしても「ファイル先頭から読み直せ」と答える。
# その形をここで再現する(fixtures/tmcd_tail.mp4)。
def tmcd_hdlr():
    p = struct.pack(">I", 0) + b"tmcd" + b"\x00" * 12 + b"TimeCodeHandler\x00"
    return fullbox(b"hdlr", 0, 0, p)


def tmcd_stsd():
    e = b"\x00" * 6 + struct.pack(">H", 1)                  # reserved + data_ref_index
    e += struct.pack(">IIIIBB", 0, 1, TIMESCALE, SAMPLE_DUR, 30, 0)
    return fullbox(b"stsd", 0, 0, struct.pack(">I", 1) + box(b"tmcd", e))


def tmcd_trak(sample_off):
    stbl_ = box(b"stbl",
                tmcd_stsd()
                + fullbox(b"stts", 0, 0, struct.pack(">III", 1, 1, NS * SAMPLE_DUR))
                + fullbox(b"stss", 0, 0, struct.pack(">II", 1, 1))
                + fullbox(b"stsc", 0, 0, struct.pack(">IIII", 1, 1, 1, 1))
                + fullbox(b"stsz", 0, 0, struct.pack(">II", TMCD_SZ, 1))
                + fullbox(b"stco", 0, 0, struct.pack(">II", 1, sample_off)))
    gmhd = box(b"gmhd", box(b"gmin", b"\x00" * 16))
    minf_ = box(b"minf", gmhd + dinf() + stbl_)
    mdia_ = box(b"mdia", mdhd() + tmcd_hdlr() + minf_)
    return box(b"trak", tkhd(2) + mdia_)


def hdlr():
    p = struct.pack(">I", 0) + b"vide" + b"\x00" * 12 + b"VideoHandler\x00"
    return fullbox(b"hdlr", 0, 0, p)


def avcC():
    # 実際にデコードはさせない(demux検査用)。長さは正しく、構造は仕様どおり。
    sps = bytes([0x67, 0x64, 0x00, 0x28, 0xAC, 0xD9, 0x40, 0xA0, 0x2F, 0xF9, 0x70, 0x11, 0x00, 0x00,
                 0x03, 0x00, 0x01, 0x00, 0x00, 0x03, 0x00, 0x3C, 0x0F, 0x18, 0x31, 0x96])
    pps = bytes([0x68, 0xEB, 0xEC, 0xB2, 0x2C])
    p = bytes([1, 0x64, 0x00, 0x28, 0xFF, 0xE1])
    p += struct.pack(">H", len(sps)) + sps
    p += bytes([1]) + struct.pack(">H", len(pps)) + pps
    return box(b"avcC", p)


def stsd():
    ve = b"\x00" * 6 + struct.pack(">H", 1)          # reserved + data_ref_index
    ve += struct.pack(">HHIII", 0, 0, 0, 0, 0)       # pre_defined/reserved
    ve += struct.pack(">HH", W, H)
    ve += struct.pack(">IIII", 0x00480000, 0x00480000, 0, 1)  # h/v res, reserved, frame_count
    ve += b"\x00" * 32                                # compressorname
    ve += struct.pack(">Hh", 0x0018, -1)              # depth, pre_defined
    ve += avcC()
    entry = box(b"avc1", ve)
    return fullbox(b"stsd", 0, 0, struct.pack(">I", 1) + entry)


def stts():
    return fullbox(b"stts", 0, 0, struct.pack(">III", 1, NS, SAMPLE_DUR))


def stsc():
    # 1チャンク = 1サンプル(オフセット計算が単純になる)
    return fullbox(b"stsc", 0, 0, struct.pack(">IIII", 1, 1, 1, 1))


def stsz():
    return fullbox(b"stsz", 0, 0, struct.pack(">II", SAMPLE_SZ, NS))


def stco(mdat_data_off):
    offs = [mdat_data_off + i * SAMPLE_SZ for i in range(NS)]
    return fullbox(b"stco", 0, 0, struct.pack(">I", NS) + b"".join(struct.pack(">I", o) for o in offs))


def stss():
    # 15サンプルごとにIDR(実素材に近い形。全部syncにするとseekの検証が甘くなる)
    keys = [i + 1 for i in range(NS) if i % 15 == 0]
    return fullbox(b"stss", 0, 0, struct.pack(">I", len(keys)) + b"".join(struct.pack(">I", k) for k in keys))


def stbl(mdat_data_off):
    return box(b"stbl", stsd() + stts() + stss() + stsc() + stsz() + stco(mdat_data_off))


def dinf():
    dref = fullbox(b"dref", 0, 0, struct.pack(">I", 1) + fullbox(b"url ", 0, 1, b""))
    return box(b"dinf", dref)


def minf(mdat_data_off):
    vmhd = fullbox(b"vmhd", 0, 1, struct.pack(">HHHH", 0, 0, 0, 0))
    return box(b"minf", vmhd + dinf() + stbl(mdat_data_off))


def mdia(mdat_data_off):
    return box(b"mdia", mdhd() + hdlr() + minf(mdat_data_off))


def trak(mdat_data_off):
    return box(b"trak", tkhd() + mdia(mdat_data_off))


def moov(mdat_data_off, with_tmcd=False, tmcd_off=0):
    body = mvhd(NS * SAMPLE_DUR) + trak(mdat_data_off)
    if with_tmcd:
        body += tmcd_trak(tmcd_off)
    return box(b"moov", body)


def mdat_bytes(tmcd_first=False):
    # サンプルごとに識別可能な内容を入れる(先頭4バイト = サンプル番号)
    body = b"".join(struct.pack(">I", i) + bytes([(i * 7 + j) & 0xFF for j in range(SAMPLE_SZ - 4)])
                    for i in range(NS))
    if tmcd_first:
        body = struct.pack(">I", 0xFFFFFFFF) + body   # 先頭にタイムコードの1サンプル
    return box(b"mdat", body)


def build_tmcd():
    """ftyp + mdat(tmcd 1サンプル → 映像 NS サンプル) + moov(映像 + tmcd)"""
    f = ftyp()
    md = mdat_bytes(tmcd_first=True)
    tmcd_off = len(f) + 8                 # mdat データ部の先頭 = タイムコードの1サンプル
    vid_off = tmcd_off + TMCD_SZ          # 映像サンプル0はその直後
    return f + md + moov(vid_off, with_tmcd=True, tmcd_off=tmcd_off), tmcd_off, vid_off


def build(moov_at_tail):
    f = ftyp()
    md = mdat_bytes()
    if moov_at_tail:
        mdat_data_off = len(f) + 8              # ftyp + mdatヘッダ
        return f + md + moov(mdat_data_off)
    # moov先頭: moovの長さが確定しないと offset が決まらないので2パス
    guess = len(moov(0))
    for _ in range(4):
        off = len(f) + guess + 8
        mv = moov(off)
        if len(mv) == guess:
            return f + mv + md
        guess = len(mv)
    raise RuntimeError("moov size did not converge")


if __name__ == "__main__":
    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
    os.makedirs(d, exist_ok=True)
    meta = {"samples": NS, "sampleSize": SAMPLE_SZ, "timescale": TIMESCALE,
            "sampleDuration": SAMPLE_DUR, "width": W, "height": H,
            "durationSec": NS * SAMPLE_DUR / TIMESCALE}
    for name, tail in (("moov_tail.mp4", True), ("moov_head.mp4", False)):
        b = build(tail)
        open(os.path.join(d, name), "wb").write(b)
        # 自己検証: トップレベルの並びを読み返す
        order, pos = [], 0
        while pos < len(b) - 8:
            sz = struct.unpack(">I", b[pos:pos + 4])[0]
            order.append(b[pos + 4:pos + 8].decode())
            if sz < 8:
                break
            pos += sz
        assert order == (["ftyp", "mdat", "moov"] if tail else ["ftyp", "moov", "mdat"]), order
        # stco の先頭オフセットが本当にサンプル0の先頭を指しているか実バイトで検算
        i = b.find(b"stco")
        first = struct.unpack(">I", b[i + 12:i + 16])[0]
        assert b[first:first + 4] == struct.pack(">I", 0), (name, first, b[first:first + 4])
        last = struct.unpack(">I", b[i + 12 + (NS - 1) * 4: i + 16 + (NS - 1) * 4])[0]
        assert b[last:last + 4] == struct.pack(">I", NS - 1), (name, last)
        meta[name] = {"bytes": len(b), "topLevel": order}
        print(f"{name:16s} {len(b):6d} bytes  {order}  stco[0]={first} stco[-1]={last} OK")
    # ---- タイムコードトラック入り(mp4box の全トラック最小シークを暴く) ----
    b, tmcd_off, vid_off = build_tmcd()
    open(os.path.join(d, "tmcd_tail.mp4"), "wb").write(b)
    assert b[tmcd_off:tmcd_off + 4] == struct.pack(">I", 0xFFFFFFFF), "tmcdサンプルの位置"
    assert b[vid_off:vid_off + 4] == struct.pack(">I", 0), "映像サンプル0の位置"
    i = b.rfind(b"stco")   # 後ろの stco = tmcd(1エントリ)
    assert struct.unpack(">I", b[i + 12:i + 16])[0] == tmcd_off, "tmcd stco"
    meta["tmcd_tail.mp4"] = {
        "bytes": len(b), "tmcdSampleOffset": tmcd_off, "videoSample0Offset": vid_off,
        "videoSampleOffset": [vid_off + i * SAMPLE_SZ for i in range(NS)],
    }
    print(f"tmcd_tail.mp4    {len(b):6d} bytes  tmcd@{tmcd_off} video0@{vid_off} OK")
    open(os.path.join(d, "meta.json"), "w").write(json.dumps(meta, indent=2))
    print("meta.json written")
