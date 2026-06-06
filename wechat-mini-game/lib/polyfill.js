// Three.js 微信小程序 polyfills —— 在 require('three') 之前执行

var _g = typeof global !== 'undefined' ? global : (typeof GameGlobal !== 'undefined' ? GameGlobal : {});

// ---- window ----
if (typeof _g.window === 'undefined') _g.window = _g;

// ---- performance ----
if (typeof _g.performance === 'undefined') {
  _g.performance = { now: function () { return Date.now(); } };
}

// ---- requestAnimationFrame ----
if (typeof _g.requestAnimationFrame === 'undefined') {
  _g.requestAnimationFrame = function (cb) { return setTimeout(cb, 16); };
  _g.cancelAnimationFrame = function (id) { clearTimeout(id); };
}

// ---- navigator ----
if (typeof _g.navigator === 'undefined') {
  _g.navigator = {
    userAgent: 'wechat-miniprogram',
    platform: 'wechat',
    vendor: '',
    appVersion: '',
  };
}

// ---- document (minimal but complete enough for Three.js) ----
if (typeof _g.document === 'undefined') {
  _g.document = {
    createElementNS: function (ns, tag) {
      if (tag === 'canvas' || tag === 'img') return wx.createOffscreenCanvas({ type: '2d' });
      if (tag === 'video') return { addEventListener: function () {}, removeEventListener: function () {} };
      return {};
    },
    createElement: function (tag) {
      if (tag === 'canvas') return wx.createOffscreenCanvas({ type: '2d' });
      if (tag === 'img') {
        try { var img = wx.createImage ? wx.createImage() : {}; img.addEventListener = function () {}; img.removeEventListener = function () {}; return img; }
        catch (e) { return { addEventListener: function () {}, removeEventListener: function () {} }; }
      }
      if (tag === 'video') return { addEventListener: function () {}, removeEventListener: function () {} };
      if (tag === 'a') return { href: '', download: '', click: function () {} };
      return {};
    },
    createTextNode: function () { return {}; },
    documentElement: { style: {} },
    head: { appendChild: function () {}, removeChild: function () {} },
    body: { appendChild: function () {}, removeChild: function () {} },
    addEventListener: function () {},
    removeEventListener: function () {},
    createEvent: function () { return { initMouseEvent: function () {} }; },
  };
}

// ---- HTMLCanvasElement ----
if (typeof _g.HTMLCanvasElement === 'undefined') {
  _g.HTMLCanvasElement = function () {};
}
// Three.js 检查 canvas instanceof HTMLCanvasElement，这里让 wx canvas 通过检查
Object.defineProperty(_g.HTMLCanvasElement, Symbol.hasInstance, {
  value: function (instance) {
    return instance && typeof instance.getContext === 'function' && typeof instance.width === 'number';
  }
});

// ---- Image constructor ----
if (typeof _g.Image === 'undefined') {
  _g.Image = function () {
    try {
      var img = wx.createImage ? wx.createImage() : {};
      img.addEventListener = function (evt, cb) { if (evt === 'load') setTimeout(cb, 0); };
      img.removeEventListener = function () {};
      return img;
    } catch (e) {
      return { addEventListener: function () {}, removeEventListener: function () {} };
    }
  };
}

// ---- URL ----
if (typeof _g.URL === 'undefined') {
  _g.URL = { createObjectURL: function () { return ''; }, revokeObjectURL: function () {} };
}

// ---- Blob ----
if (typeof _g.Blob === 'undefined') {
  _g.Blob = function () {};
}

// ---- console shim (in case) ----
if (typeof _g.console === 'undefined') {
  _g.console = { log: function () {}, warn: function () {}, error: function () {} };
}

// ---- screen ----
if (typeof _g.screen === 'undefined') {
  _g.screen = { width: 375, height: 667, availWidth: 375, availHeight: 667 };
}

// ========== export helpers ==========

function patchCanvasForThree(canvas) {
  if (!canvas || canvas.__threePatched) return canvas;
  canvas.__threePatched = true;
  if (!canvas.style) canvas.style = {};
  if (!canvas.dataset) canvas.dataset = {};
  if (!canvas.addEventListener) canvas.addEventListener = function () {};
  if (!canvas.removeEventListener) canvas.removeEventListener = function () {};
  if (!canvas.clientWidth) Object.defineProperty(canvas, 'clientWidth', { get: function () { return this.width; } });
  if (!canvas.clientHeight) Object.defineProperty(canvas, 'clientHeight', { get: function () { return this.height; } });
  if (!canvas.parentElement) canvas.parentElement = { clientWidth: canvas.width || 375, clientHeight: canvas.height || 667 };
  return canvas;
}

function patchImageForThree(img) {
  if (!img || img.__threePatched) return img;
  img.__threePatched = true;
  if (!img.addEventListener) img.addEventListener = function (evt, cb) { if (evt === 'load') setTimeout(cb, 0); };
  if (!img.removeEventListener) img.removeEventListener = function () {};
  return img;
}

module.exports = { patchCanvasForThree, patchImageForThree };
