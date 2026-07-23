"use strict";
/* ============ 書き出しファイルの書き込みワーカー(2026-07-23) ============
   iOS Safari は OPFS にメインスレッドから書けない(createWritable が無い)。
   書けるのは **Worker 内の createSyncAccessHandle** だけ。
   だから muxer の出力チャンクをこのWorkerへ送り、同期ハンドルで任意位置に書く。
   読み取り(getFile)はメインスレッドでも動くので、完成後はメイン側で取り出す。

   これが「iOSでOPFSを本当に効かせる」ための要。以前は createWritable 前提で
   実装しており、iOSでは opfsSupported()=false となりメモリ方式へ落ちていた
   (=8分ショウが端末メモリ上限で書き出せなかった)。

   プロトコル(メイン → worker):
     {type:"open", dir, name}        → OPFSファイルを作り同期ハンドルを開く
     {type:"write", data, position}  → handle.write(data, {at:position})  ※dataはtransfer
     {type:"finalize"}               → flush + close(ファイル確定)
     {type:"abort"}                  → close(書きかけは呼び出し側が削除)
   (worker → メイン):
     {type:"opened"} / {type:"written", bytes} / {type:"finalized", size}
     / {type:"error", op, message} */

let handle = null;
let written = 0;

/* 起動できたことをメインへ知らせる。メインの initWriter はこれを待ってから
   使い始める(以前は待たずに使い、読み込み失敗時に永遠に待つ穴があった) */
self.postMessage({ type: "ready" });

async function open(dir, name) {
  if (handle) { try { handle.close(); } catch (_) {} handle = null; }   // 前回の残りを閉じる
  const root = await navigator.storage.getDirectory();
  const d = await root.getDirectoryHandle(dir, { create: true });
  let fh = await d.getFileHandle(name, { create: true });
  handle = await fh.createSyncAccessHandle();
  try {
    handle.truncate(0);
  } catch (err) {
    /* 一部のSafariで truncate が投げることがある → ファイルを作り直して代替 */
    try { handle.close(); } catch (_) {}
    handle = null;
    await d.removeEntry(name).catch(() => {});
    fh = await d.getFileHandle(name, { create: true });
    handle = await fh.createSyncAccessHandle();
  }
  written = 0;
}

self.onmessage = async e => {
  const m = e.data || {};
  try {
    if (m.type === "open") {
      await open(m.dir, m.name);
      self.postMessage({ type: "opened" });
    } else if (m.type === "write") {
      if (!handle) throw new Error("not opened");
      const view = new Uint8Array(m.data);
      const n = handle.write(view, { at: m.position });   // 任意位置に同期書き込み
      written = Math.max(written, m.position + n);
      self.postMessage({ type: "written", bytes: n });
    } else if (m.type === "finalize") {
      if (!handle) throw new Error("not opened");
      handle.flush();
      const size = handle.getSize();
      handle.close();
      handle = null;
      self.postMessage({ type: "finalized", size });
    } else if (m.type === "abort") {
      if (handle) { try { handle.close(); } catch (_) {} handle = null; }
      self.postMessage({ type: "aborted" });
    }
  } catch (err) {
    if (handle) { try { handle.close(); } catch (_) {} handle = null; }
    self.postMessage({ type: "error", op: m.type, message: String((err && err.message) || err) });
  }
};
