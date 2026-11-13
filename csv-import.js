/* CSV 解析与数据集构建（供页面导入功能使用，无 DOM 依赖） */
(function (root) {
  'use strict';

  function decodeBytes(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var text = '';
    try {
      text = new TextDecoder('utf-8').decode(bytes);
    } catch (e) { /* 忽略 */ }

    if (!text || text.indexOf('\uFFFD') !== -1) {
      var fallbacks = ['gb18030', 'gbk'];
      for (var i = 0; i < fallbacks.length; i++) {
        if (text && text.indexOf('\uFFFD') === -1) break;
        try {
          var alt = new TextDecoder(fallbacks[i]).decode(bytes);
          if (alt.indexOf('\uFFFD') === -1) text = alt;
        } catch (e) { /* 该编码不支持则跳过 */ }
      }
    }
    return text.replace(/^\uFEFF/, '');
  }

  function detectDelimiter(text) {
    var firstLine = text.slice(0, 2000).split(/\r?\n/)[0] || '';
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQuotes = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) {
        counts[ch]++;
      }
    }
    var best = ',';
    if (counts[';'] > counts[best]) best = ';';
    if (counts['\t'] > counts[best]) best = '\t';
    return best;
  }

  function parseCsv(text, delimiter) {
    var sep = delimiter || ',';
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    });
  }

  function buildDataset(text, source) {
    if (!text || !text.trim()) throw new Error('文件内容为空');

    var rows = parseCsv(text, detectDelimiter(text));
    if (rows.length < 2) throw new Error('CSV 至少需要表头行和一行数据');

    var headers = rows[0].map(function (h, i) {
      var name = String(h == null ? '' : h).trim();
      return name || ('列' + (i + 1));
    });

    var snIndex = -1;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].toUpperCase() === 'SN') {
        snIndex = i;
        break;
      }
    }
    if (snIndex === -1) throw new Error('CSV 缺少 SN 列（表头需包含 SN）');
    headers[snIndex] = 'SN';

    var unique = {};
    var order = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var sn = String(row[snIndex] == null ? '' : row[snIndex]).trim();
      if (!sn) continue;

      var record = { SN: sn };
      for (var c = 0; c < headers.length; c++) {
        if (c === snIndex) continue;
        record[headers[c]] = String(row[c] == null ? '' : row[c]).trim();
      }
      if (!(sn in unique)) order.push(sn);
      unique[sn] = record;
    }

    if (!order.length) throw new Error('CSV 中没有可用的 SN 数据行');

    return {
      generatedAt: new Date().toISOString(),
      source: source || 'CSV 导入',
      columns: headers,
      records: order.map(function (sn) { return unique[sn]; })
    };
  }

  root.SNCsv = {
    decodeBytes: decodeBytes,
    detectDelimiter: detectDelimiter,
    parseCsv: parseCsv,
    buildDataset: buildDataset
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
