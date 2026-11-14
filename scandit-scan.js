/*
 * Scandit Web SDK 扫码封装（ES Module）
 * 说明：Scandit 解码引擎为闭源商业组件，通过官方 npm/CDN 包加载，需要绑定 license key。
 * 无 key 或加载失败时，上层会回退到内置开源解码。
 */

var KEY_STORAGE = 'snLookup.scanditKey.v1';

var CDN = {
  libraryLocation: 'https://cdn.jsdelivr.net/npm/@scandit/web-datacapture-barcode@8/sdc-lib/'
};

var mods = null;
var loading = null;
var context = null;
var view = null;
var barcodeCapture = null;
var running = false;
var handlers = {};

function getKey() {
  try { return (localStorage.getItem(KEY_STORAGE) || '').trim(); } catch (e) { return ''; }
}

function setKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (e) { /* 忽略 */ }
}

function loadMods() {
  if (mods) return Promise.resolve(mods);
  if (!loading) {
    loading = Promise.all([
      import('@scandit/web-datacapture-core'),
      import('@scandit/web-datacapture-barcode')
    ]).then(function (list) {
      mods = { core: list[0], barcode: list[1] };
      return mods;
    });
  }
  return loading;
}

function ensureContext() {
  if (context) return Promise.resolve(context);
  return loadMods().then(function () {
    return mods.core.DataCaptureContext.forLicenseKey(getKey(), {
      libraryLocation: CDN.libraryLocation,
      moduleLoaders: [mods.barcode.barcodeCaptureLoader()]
    });
  }).then(function (ctx) {
    context = ctx;
    return ctx;
  });
}

function buildCapture() {
  var barcode = mods.barcode;
  var settings = new barcode.BarcodeCaptureSettings();
  settings.enableSymbologies([
    barcode.Symbology.DataMatrix,
    barcode.Symbology.QR,
    barcode.Symbology.Code128,
    barcode.Symbology.Code39,
    barcode.Symbology.EAN13UPCA
  ]);

  /* 关键：开启 DPM（激光点阵）模式 + 反色支持 */
  var dm = settings.settingsForSymbology(barcode.Symbology.DataMatrix);
  dm.setExtensionEnabled('direct_part_marking_mode', true);
  dm.isColorInvertedEnabled = true;

  settings.codeDuplicateFilter = 0;

  return barcode.BarcodeCapture.forContext(context, settings).then(function (capture) {
    capture.addListener({
      didScan: function (mode, session) {
        var code = session.newlyRecognizedBarcode;
        if (!code || !code.data) return;
        if (handlers.onScan) handlers.onScan(String(code.data));
      }
    });
    barcodeCapture = capture;
    return capture;
  });
}

function start(opts) {
  handlers = opts || {};
  var core, barcode;

  return ensureContext()
    .then(function () {
      core = mods.core;
      barcode = mods.barcode;
      return barcodeCapture ? barcodeCapture : buildCapture();
    })
    .then(function () {
      if (!view) {
        return core.DataCaptureView.forContext(context).then(function (v) { view = v; });
      }
    })
    .then(function () {
      if (handlers.container) view.connectToElement(handlers.container);
      var camera = core.Camera.pickBestGuess();
      return camera.applySettings(barcode.BarcodeCapture.recommendedCameraSettings)
        .then(function () { return context.setFrameSource(camera); });
    })
    .then(function () {
      return barcodeCapture.setEnabled(true);
    })
    .then(function () {
      return context.frameSource.switchToDesiredState(core.FrameSourceState.On);
    })
    .then(function () {
      running = true;
    });
}

function stop() {
  if (!running && !context) return Promise.resolve();
  running = false;
  var core = mods && mods.core;
  var tasks = [];
  if (barcodeCapture) {
    tasks.push(barcodeCapture.setEnabled(false).catch(function () {}));
  }
  if (context && context.frameSource && core) {
    tasks.push(context.frameSource.switchToDesiredState(core.FrameSourceState.Off).catch(function () {}));
  }
  return Promise.all(tasks);
}

var api = {
  getKey: getKey,
  setKey: setKey,
  hasKey: function () { return !!getKey(); },
  isReady: function () { return !!mods; },
  start: start,
  stop: stop
};

window.SNScandit = api;

try {
  window.dispatchEvent(new CustomEvent('snscanditready'));
} catch (e) { /* 忽略 */ }

export default api;
