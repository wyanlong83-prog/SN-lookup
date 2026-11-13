(function () {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var video = el('video');
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  var STORAGE_KEY = 'snLookup.dataset.v1';

  var state = {
    records: [],
    columns: [],
    bySn: new Map(),
    scanning: false,
    stream: null,
    rafId: 0,
    lastDecode: 0,
    audioCtx: null,
    zxingReader: null,
    zxingHints: null
  };

  var COLOR_MAP = {
    '灰色': '#9ca3af',
    '黑色': '#111827',
    '白色': '#ffffff',
    '银色': '#cbd5e1',
    '绿色': '#16a34a',
    '红色': '#dc2626',
    '蓝色': '#2563eb',
    '黄色': '#eab308',
    '粉色': '#ec4899',
    '紫色': '#7c3aed',
    '橙色': '#f97316',
    '棕色': '#92400e',
    '金色': '#d4af37'
  };

  /* ---------------- 数据 ---------------- */

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function normalizeDataset(json) {
    var records = Array.isArray(json && json.records) ? json.records : [];
    var columns = Array.isArray(json && json.columns) && json.columns.length
      ? json.columns
      : Object.keys(records[0] || { SN: '' });
    return {
      generatedAt: json && json.generatedAt,
      source: json && json.source,
      columns: columns,
      records: records
    };
  }

  function readStoredDataset() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = normalizeDataset(JSON.parse(raw));
      return data.records.length ? data : null;
    } catch (e) {
      return null;
    }
  }

  function saveDataset(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      throw new Error('本地存储空间不足，导入失败（数据量过大）');
    }
  }

  function applyDataset(data, imported) {
    state.records = data.records;
    state.columns = data.columns;
    state.bySn = new Map();
    state.records.forEach(function (r) {
      var sn = String(r.SN == null ? '' : r.SN).trim();
      if (sn) state.bySn.set(sn.toUpperCase(), r);
    });

    var status = el('dataStatus');
    var parts = ['共 ' + state.records.length + ' 条 SN'];
    parts.push(imported ? '本地导入' : '内置数据');
    var time = formatTime(data.generatedAt);
    if (time) parts.push('更新于 ' + time);
    status.textContent = parts.join(' · ');
    status.classList.remove('error');
    el('restoreBtn').hidden = !imported;
  }

  function loadBuiltin() {
    var status = el('dataStatus');
    return fetch('data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        applyDataset(normalizeDataset(json), false);
      })
      .catch(function (err) {
        status.textContent = '数据载入失败：请确认 data.json 与网页在同一目录';
        status.classList.add('error');
        el('restoreBtn').hidden = true;
        console.error(err);
      });
  }

  function loadData() {
    var stored = readStoredDataset();
    if (stored) {
      applyDataset(stored, true);
      return;
    }
    loadBuiltin();
  }

  function findRecord(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text || !state.bySn.size) return null;
    var upper = text.toUpperCase();

    var exact = state.bySn.get(upper);
    if (exact) return exact;

    var found = null;
    state.bySn.forEach(function (rec, sn) {
      if (!found && upper.indexOf(sn) !== -1) found = rec;
    });
    if (found) return found;

    var tokens = upper.match(/[A-Z0-9][A-Z0-9._-]{3,}/g) || [];
    for (var i = 0; i < tokens.length; i++) {
      var hit = state.bySn.get(tokens[i]) ||
        state.bySn.get(tokens[i].replace(/[._-]+$/, ''));
      if (hit) return hit;
    }
    return null;
  }

  /* ---------------- 结果展示 ---------------- */

  function colorDot(name) {
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = COLOR_MAP[name.trim()] || '#94a3b8';
    return dot;
  }

  function showResult(raw) {
    var rec = findRecord(raw);
    var badge = el('resultBadge');
    var fields = el('resultFields');
    var hint = el('resultHint');
    var rawBox = el('rawContent');

    fields.innerHTML = '';
    hint.hidden = true;
    rawBox.hidden = true;
    rawBox.textContent = '';

    if (rec) {
      badge.textContent = '已找到';
      badge.className = 'badge';
      el('snLabel').textContent = 'SN';
      el('resultSn').textContent = String(rec.SN == null ? raw : rec.SN);

      var cols = state.columns.length ? state.columns : Object.keys(rec);
      cols.forEach(function (col) {
        if (col === 'SN' || !(col in rec)) return;
        var dt = document.createElement('dt');
        dt.textContent = col;

        var dd = document.createElement('dd');
        var val = rec[col];
        var text = (val === null || val === undefined || val === '') ? '—' : String(val);
        if (col.indexOf('颜色') !== -1 && text !== '—') dd.appendChild(colorDot(text));
        dd.appendChild(document.createTextNode(text));

        fields.appendChild(dt);
        fields.appendChild(dd);
      });
    } else {
      badge.textContent = '未找到';
      badge.className = 'badge miss';
      el('snLabel').textContent = '扫描内容';
      el('resultSn').textContent = raw;
      hint.hidden = false;
      rawBox.hidden = false;
      rawBox.textContent = raw;
    }

    el('rescanBtn').textContent = rec ? '继续扫描' : '重新扫描';
    openSheet();
  }

  function openSheet() {
    var overlay = el('resultOverlay');
    overlay.hidden = false;
    document.body.classList.add('no-scroll');
    requestAnimationFrame(function () { overlay.classList.add('show'); });
  }

  function closeSheet(rescan) {
    var overlay = el('resultOverlay');
    overlay.classList.remove('show');
    document.body.classList.remove('no-scroll');
    setTimeout(function () { overlay.hidden = true; }, 220);
    if (rescan) setTimeout(startScan, 240);
  }

  /* ---------------- 扫码 ---------------- */

  function showError(msg) {
    var box = el('scanError');
    box.textContent = msg;
    box.hidden = false;
  }

  function hideError() {
    el('scanError').hidden = true;
  }

  function ensureAudio() {
    if (state.audioCtx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      state.audioCtx = new AC();
    } catch (e) {
      state.audioCtx = null;
    }
  }

  function beep() {
    var ac = state.audioCtx;
    if (!ac) return;
    try {
      if (ac.state === 'suspended') ac.resume();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      var t = ac.currentTime;
      osc.type = 'sine';
      osc.frequency.value = 1180;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    } catch (e) { /* ignore */ }
  }

  function startScan() {
    if (state.scanning) return;
    hideError();
    ensureAudio();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('当前环境无法调用摄像头：请使用 iPhone Safari 并通过 HTTPS 打开本页面，或直接手动输入。');
      return;
    }

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    }).then(function (stream) {
      state.stream = stream;
      el('scanIdle').hidden = true;
      el('scanActive').hidden = false;
      video.srcObject = stream;
      var playPromise = video.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});

      state.scanning = true;
      state.lastDecode = 0;
      state.rafId = requestAnimationFrame(tick);
    }).catch(function (err) {
      var name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        showError('相机权限被拒绝。请到「设置 > Safari 浏览器 > 相机」允许访问，或使用下方手动输入。');
      } else if (name === 'NotFoundError') {
        showError('未检测到可用摄像头。');
      } else if (name === 'NotReadableError') {
        showError('摄像头被其他应用占用，请关闭后重试。');
      } else {
        showError('无法启动摄像头：' + (err && err.message ? err.message : '未知错误'));
      }
    });
  }

  function stopScan() {
    state.scanning = false;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
    video.srcObject = null;
    el('scanIdle').hidden = false;
    el('scanActive').hidden = true;
  }

  function decodeWithZXing(imgData, w, h) {
    var Z = window.ZXing;
    if (!Z) return null;
    try {
      if (!state.zxingReader) {
        var hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
          Z.BarcodeFormat.QR_CODE,
          Z.BarcodeFormat.DATA_MATRIX,
          Z.BarcodeFormat.CODE_128,
          Z.BarcodeFormat.CODE_39,
          Z.BarcodeFormat.EAN_13,
          Z.BarcodeFormat.EAN_8,
          Z.BarcodeFormat.ITF,
          Z.BarcodeFormat.CODABAR,
          Z.BarcodeFormat.PDF_417
        ]);
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        state.zxingReader = new Z.MultiFormatReader();
        state.zxingHints = hints;
      }
      var gray = new Uint8ClampedArray(w * h);
      var rgba = imgData.data;
      for (var i = 0, j = 0; i < gray.length; i++, j += 4) {
        gray[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
      }
      var source = new Z.RGBLuminanceSource(gray, w, h);
      var bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
      var result = state.zxingReader.decode(bitmap, state.zxingHints);
      return result ? result.getText() : null;
    } catch (e) {
      return null;
    }
  }

  function tick(ts) {
    if (!state.scanning) return;

    if (ts - state.lastDecode >= 180 && video.readyState >= 2 && video.videoWidth) {
      state.lastDecode = ts;
      var maxW = 640;
      var scale = Math.min(1, maxW / video.videoWidth);
      var w = Math.max(1, Math.round(video.videoWidth * scale));
      var h = Math.max(1, Math.round(video.videoHeight * scale));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      var text = null;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        var img = ctx.getImageData(0, 0, w, h);
        if (typeof window.jsQR === 'function') {
          var qr = window.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
          if (qr && qr.data) text = String(qr.data);
        }
        if (!text) text = decodeWithZXing(img, w, h);
      } catch (e) { /* 忽略单帧解码异常 */ }

      if (text) {
        onScan(text);
        return;
      }
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function onScan(raw) {
    stopScan();
    beep();
    showResult(raw);
  }

  /* ---------------- 事件绑定 ---------------- */

  function manualLookup() {
    var input = el('manualInput');
    var value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    input.blur();
    showResult(value);
  }

  function setImportMsg(text, isError) {
    var box = el('importMsg');
    box.textContent = text;
    box.hidden = !text;
    box.classList.toggle('error', !!isError);
  }

  function handleCsvFile(file) {
    if (!file) return;
    Promise.resolve()
      .then(function () { return file.arrayBuffer(); })
      .then(function (buffer) {
        var text = window.SNCsv.decodeBytes(buffer);
        var data = window.SNCsv.buildDataset(text, file.name);
        saveDataset(data);
        applyDataset(data, true);
        setImportMsg('已导入 ' + data.records.length + ' 条 SN（' + file.name + '）', false);
      })
      .catch(function (err) {
        setImportMsg('导入失败：' + (err && err.message ? err.message : '未知错误'), true);
      });
  }

  function restoreBuiltin() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 忽略 */ }
    setImportMsg('已恢复为内置数据', false);
    loadBuiltin();
  }

  el('startBtn').addEventListener('click', startScan);
  el('stopBtn').addEventListener('click', stopScan);

  el('lookupBtn').addEventListener('click', manualLookup);
  el('manualInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      manualLookup();
    }
  });

  el('closeResult').addEventListener('click', function () { closeSheet(false); });
  el('rescanBtn').addEventListener('click', function () { closeSheet(true); });
  el('resultOverlay').addEventListener('click', function (e) {
    if (e.target === el('resultOverlay')) closeSheet(false);
  });

  el('importBtn').addEventListener('click', function () { el('csvFile').click(); });
  el('csvFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    handleCsvFile(file);
    e.target.value = '';
  });
  el('restoreBtn').addEventListener('click', restoreBuiltin);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state.scanning) stopScan();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  loadData();
})();
