#!/usr/bin/env python3
"""MarchinZ SG 解析: YouTube のショウ動画から「音量」と「テンポ」の時系列を作る。

使い方（YouTube に届く端末＝Mac などで実行）:
    python3 tools/sg/analyze_show.py "https://youtu.be/72jaX1-e55U"
    python3 tools/sg/analyze_show.py --audio show.wav --id 72jaX1-e55U   # 手元の音声から

出力: tools/sg/data/<動画ID>.json（ページ /tools/sg/ が読む）
必要なもの: ffmpeg、numpy、（URL指定時のみ）yt-dlp

音量 = 0.1秒ごとの RMS を dBFS（0 が最大、-60 まで）。
テンポ = 発音の強さ（スペクトルフラックス）の自己相関から、8秒の窓を1秒ずつずらして BPM を推定。
         リズムが読めない区間（静か・拍手・持続音）は null にして線を切る。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import numpy as np

SR = 22050
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")

DB_HOP = 0.1          # 音量の刻み（秒）
DB_FLOOR = -60.0
T_HOP = 1.0           # テンポの刻み（秒）
T_WIN = 8.0           # テンポ推定の窓（秒）
BPM_MIN, BPM_MAX = 50.0, 220.0
CONF_MIN = 0.18       # これ未満の窓は「テンポ不明」
SILENT_DB = -55.0     # 前後1秒の音量がこれ未満なら「テンポ不明」（静寂・演奏前後）


def video_id_from(url):
    m = re.search(r"(?:youtu\.be/|v=|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    raise SystemExit(f"動画IDを読み取れません: {url}")


def fetch_audio(url, workdir):
    out = os.path.join(workdir, "audio.%(ext)s")
    cmd = ["yt-dlp", "-f", "bestaudio/best", "-o", out, "--no-playlist",
           "--print-json", "--no-simulate", url]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit("yt-dlp に失敗しました:\n" + res.stderr[-2000:])
    meta = json.loads(res.stdout.strip().splitlines()[-1])
    files = [f for f in os.listdir(workdir) if f.startswith("audio.")]
    if not files:
        raise SystemExit("音声ファイルが見つかりません")
    return os.path.join(workdir, files[0]), meta


def decode(path):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def loudness(y):
    n = int(SR * DB_HOP)
    frames = len(y) // n
    y = y[: frames * n].reshape(frames, n)
    rms = np.sqrt(np.mean(y * y, axis=1)) + 1e-12
    db = 20 * np.log10(rms * np.sqrt(2))          # 正弦波の最大振幅を 0 dBFS に揃える
    db = np.clip(db, DB_FLOOR, 0.0)
    k = 3                                          # 0.3秒の移動平均で細かい揺れを抑える
    db = np.convolve(db, np.ones(k) / k, mode="same")
    return [round(float(v), 1) for v in db]


def onset_envelope(y, n_fft=2048, hop=256):
    win = np.hanning(n_fft)
    frames = 1 + (len(y) - n_fft) // hop
    if frames < 2:
        return np.zeros(1), SR / hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(y[idx] * win, axis=1))
    spec = np.log1p(100 * spec)
    flux = np.maximum(0.0, np.diff(spec, axis=0)).sum(axis=1)
    flux = np.concatenate([[0.0], flux])
    # 局所平均を引いて「立ち上がり」だけ残す
    k = 16
    flux = np.maximum(0.0, flux - np.convolve(flux, np.ones(k) / k, mode="same"))
    return flux, SR / hop


def tempo_track(y, duration, db):
    env, fps = onset_envelope(y)
    win = int(T_WIN * fps)
    lag_min = int(fps * 60 / BPM_MAX)
    lag_max = int(fps * 60 / BPM_MIN)
    lags = np.arange(lag_min, lag_max + 1)
    bpms_of_lag = 60.0 * fps / lags
    # 120 BPM 付近をやや好む事前分布（倍・半分テンポの取り違えを減らす）
    prior = np.exp(-0.5 * (np.log2(bpms_of_lag / 120.0) / 0.9) ** 2)
    out = []
    t = 0.0
    while t <= duration:
        c = int(t * fps)
        a, b = max(0, c - win // 2), min(len(env), c + win // 2)
        seg = env[a:b]
        bpm = None
        near = db[max(0, int((t - 1) / DB_HOP)): int((t + 1) / DB_HOP) + 1]
        quiet = bool(near) and max(near) < SILENT_DB
        if not quiet and len(seg) > lag_max * 2 and seg.std() > 1e-9:
            seg = seg - seg.mean()
            ac = np.correlate(seg, seg, mode="full")[len(seg) - 1:]
            if ac[0] > 0:
                ac = ac / ac[0]
                score = ac[lags] * prior
                i = int(np.argmax(score))
                if ac[lags[i]] >= CONF_MIN:
                    # 放物線補間で lag を細かく
                    if 0 < i < len(lags) - 1:
                        y0, y1, y2 = ac[lags[i - 1]], ac[lags[i]], ac[lags[i + 1]]
                        d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2)) if (y0 - 2 * y1 + y2) != 0 else 0
                        lag = lags[i] + float(np.clip(d, -0.5, 0.5))
                    else:
                        lag = float(lags[i])
                    bpm = 60.0 * fps / lag
        out.append(bpm)
        t += T_HOP
    return smooth_tempo(out)


def smooth_tempo(vals):
    """5点の中央値で外れ値（倍テンポの一瞬の取り違え）を抑える。null は null のまま。"""
    res = []
    for i, v in enumerate(vals):
        if v is None:
            res.append(None)
            continue
        win = [x for x in vals[max(0, i - 2): i + 3] if x is not None]
        res.append(round(float(np.median(win)), 1))
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url", nargs="?", help="YouTube の URL か動画ID")
    ap.add_argument("--audio", help="手元の音声・動画ファイル（URL の代わり）")
    ap.add_argument("--id", help="--audio 使用時の動画ID")
    ap.add_argument("--out", help="出力先（既定 tools/sg/data/<ID>.json）")
    args = ap.parse_args()

    title = ""
    with tempfile.TemporaryDirectory() as td:
        if args.audio:
            vid = video_id_from(args.id) if args.id else os.path.splitext(os.path.basename(args.audio))[0]
            path = args.audio
        elif args.url:
            vid = video_id_from(args.url)
            path, meta = fetch_audio(f"https://www.youtube.com/watch?v={vid}", td)
            title = meta.get("title", "")
        else:
            ap.error("URL か --audio を指定してください")
        y = decode(path)

    duration = len(y) / SR
    db = loudness(y)
    tempo = tempo_track(y, duration, db)
    valid = [v for v in tempo if v is not None]
    data = {
        "videoId": vid,
        "title": title,
        "duration": round(duration, 2),
        "loudness": {"hop": DB_HOP, "unit": "dBFS", "floor": DB_FLOOR, "values": db},
        "tempo": {"hop": T_HOP, "window": T_WIN, "unit": "BPM",
                  "median": round(float(np.median(valid)), 1) if valid else None,
                  "values": tempo},
        "analyzedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "analyzer": "tools/sg/analyze_show.py v1",
    }
    out = os.path.abspath(args.out or os.path.join(DATA_DIR, f"{vid}.json"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"書き出し: {out}  長さ {duration:.1f}秒 / テンポ中央値 {data['tempo']['median']} BPM"
          f" / テンポ判定できた区間 {len(valid)}/{len(tempo)}")


if __name__ == "__main__":
    sys.exit(main())
