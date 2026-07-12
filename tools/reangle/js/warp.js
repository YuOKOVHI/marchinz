"use strict";
/* ============ WebGLワープレンダラ ============
   フルスクリーン4頂点+フラグメントシェーダの逆マッピングで透視補正。
   出力画素の正規化座標に uH(mat3) をかけてソーステクスチャを参照する。
   iOS Safari 16 でも確実な WebGL1 を使う。 */

RA.WarpRenderer = class {
  /* canvas: HTMLCanvasElement | OffscreenCanvas
     opts.preserve: 書き出し用(VideoFrame生成のため描画バッファ保持) */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const attrs = {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserve,
    };
    const gl = this.gl = canvas.getContext("webgl", attrs)
      || canvas.getContext("experimental-webgl", attrs);
    if (!gl) throw new Error("WebGLを利用できません");

    const vs = `
      attribute vec2 aPos;
      varying vec2 vUV;
      void main() {
        vUV = aPos;
        gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
      }`;
    const fs = `
      precision highp float;
      varying vec2 vUV;
      uniform mat3 uH;
      uniform sampler2D uTex;
      void main() {
        vec3 p = uH * vec3(vUV, 1.0);
        vec2 uv = p.xy / p.z;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        } else {
          gl_FragColor = texture2D(uTex, uv);
        }
      }`;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error("シェーダ: " + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = this.prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error("シェーダリンク: " + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uH = gl.getUniformLocation(prog, "uH");
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);

    const tex = this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this._staging = null;   // texImage2D(VideoFrame)非対応環境用の2D中継
  }

  setSize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  /* video / VideoFrame / canvas をテクスチャへ。VideoFrame直アップロードに
     失敗する環境は2D canvas経由へ自動フォールバック */
  upload(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (e) {
      const w = source.displayWidth || source.videoWidth || source.width;
      const h = source.displayHeight || source.videoHeight || source.height;
      if (!this._staging || this._staging.width !== w || this._staging.height !== h) {
        this._staging = typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement("canvas"), { width: w, height: h });
        this._stagingCtx = this._staging.getContext("2d");
      }
      this._stagingCtx.drawImage(source, 0, 0, w, h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._staging);
    }
  }

  /* M: 行優先mat3(RA.H形式)。列優先に転置して渡す */
  render(M) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix3fv(this.uH, false, new Float32Array([
      M[0], M[3], M[6],
      M[1], M[4], M[7],
      M[2], M[5], M[8],
    ]));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }
};
