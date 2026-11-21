// ==UserScript==
// @name         三国杀精测 · 后台数据抓取小窗
// @namespace    https://github.com/Cloudyunpianer/sgs_jingce
// @version      1.1.0
// @description  抓取三国杀一将成名后台 JSON 数据，悬浮小窗预览，一键复制或下载。配套 sgs_jingce 精测工具。
// @author       sgs_jingce
// @match        *://x.sanguosha.com/*
// @match        *://*.sanguosha.com/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 * 1) 装 Tampermonkey / Violentmonkey，把本脚本拖进浏览器安装。
 * 2) 打开三国杀官网 https://x.sanguosha.com/ 的活动后台页面，右上角出现小窗。
 * 3) 脚本 hook 页面所有 fetch / XHR，命中 CAPTURE.urlPatterns 的 JSON 响应
 *    会列进小窗。点一条看预览，再点「复制 JSON」或「下载 JSON」导出。
 * 4) 「全部下载」把所有抓到的 payload 打包成一个 JSON 文件。
 *
 * 本脚本只在浏览器里抓包和导出，不写磁盘、不连本地服务、不碰 git。
 * 抓下来的数据你可以自己放进项目的 samples/ 再导入精测工具。
 * ============================================================================
 */

(function () {
  'use strict';

  // ----------------------------- 配置区 -------------------------------------
  var CAPTURE = {
    // URL 命中任一关键字就抓取（不区分大小写）。留空数组 [] 则抓所有 JSON。
    // TODO: 换成真实活动接口路径，例如 '/api/activity/detail'、'getActivityConfig'
    urlPatterns: [
      'activity',
      'news',
      'event',
      'config'
    ],
    minSize: 200,        // 响应体小于该字节数忽略（过滤心跳/空响应）
    maxKeep: 50          // 小窗最多保留多少条抓取记录
  };
  // --------------------------------------------------------------------------

  var captured = [];
  var selected = -1;
  var seq = 0;

  function urlHit(url) {
    if (!CAPTURE.urlPatterns.length) return true;
    var u = String(url || '').toLowerCase();
    return CAPTURE.urlPatterns.some(function (p) { return u.indexOf(String(p).toLowerCase()) >= 0; });
  }

  function prettyBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function guessActivity(url) {
    var m = String(url).match(/(20\d{6})[_-]?(\d+)[_-]?(\d+)/);
    return m ? m[1] + '_' + m[2] + '_' + m[3] : '';
  }

  // --------------------------- 抓取入口 -------------------------------------
  function ingest(url, text, method) {
    try {
      if (!text || text.length < CAPTURE.minSize) return;
      if (!urlHit(url)) return;
      var payload;
      try { payload = JSON.parse(text); }
      catch (e) { return; } // 非 JSON 直接忽略

      var item = {
        id: ++seq,
        url: String(url),
        method: method || 'GET',
        size: text.length,
        time: new Date(),
        payload: payload,
        text: text,
        preview: text.length > 8000 ? text.slice(0, 8000) + '\n…（预览已截断，复制/下载为完整数据）' : text,
        activity: guessActivity(url)
      };
      captured.unshift(item);
      if (captured.length > CAPTURE.maxKeep) captured.length = CAPTURE.maxKeep;
      selected = 0;
      render();
      log('抓到 #' + item.id + ' ' + item.method + ' ' + prettyBytes(item.size));
    } catch (e) {
      log('抓取处理异常：' + e.message);
    }
  }

  // hook XMLHttpRequest
  (function hookXHR() {
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__sgsUrl = url;
      this.__sgsMethod = method;
      return open.apply(this, arguments);
    };
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      this.addEventListener('load', function () {
        try {
          var ct = self.getResponseHeader('content-type') || '';
          if (ct.indexOf('json') < 0) return;
          ingest(self.__sgsUrl, self.responseText, self.__sgsMethod);
        } catch (e) { /* 跨域响应读不到 content-type，忽略 */ }
      });
      return send.apply(this, arguments);
    };
  })();

  // hook fetch
  (function hookFetch() {
    var orig = window.fetch;
    if (typeof orig !== 'function') return;
    window.fetch = function (input, init) {
      var p = orig.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url);
        p.then(function (resp) {
          try {
            var ct = (resp.headers && resp.headers.get('content-type')) || '';
            if (ct.indexOf('json') < 0) return;
            resp.clone().text().then(function (t) {
              ingest(url, t, (init && init.method) || 'GET');
            });
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      return p;
    };
  })();

  // --------------------------- 导出 -----------------------------------------
  function copyItem(item) {
    try {
      var text = JSON.stringify(item.payload, null, 2);
      GM_setClipboard(text, 'text');
      log('✓ #' + item.id + ' 已复制到剪贴板（' + prettyBytes(text.length) + '）');
    } catch (e) {
      log('✗ 复制失败：' + e.message + '（可改用下载）');
    }
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      log('✗ 下载失败：' + e.message);
      return false;
    }
  }

  function fname(item) {
    var d = item.time;
    var p = function (n) { return String(n).padStart(2, '0'); };
    var base = (item.activity || ('抓取_' + item.id)).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    return base + '_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }

  function downloadItem(item) {
    if (download(fname(item), JSON.stringify(item.payload, null, 2))) {
      log('✓ #' + item.id + ' 已下载 ' + fname(item));
    }
  }

  function downloadAll() {
    if (!captured.length) { log('没有抓到数据'); return; }
    var all = captured.map(function (it) {
      return {
        _meta: { source: it.url, method: it.method, time: it.time.toISOString(), activity: it.activity },
        payload: it.payload
      };
    });
    var d = new Date();
    var name = 'sgs_capture_all_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.json';
    if (download(name, JSON.stringify(all, null, 2))) {
      log('✓ 已下载全部 ' + captured.length + ' 条 → ' + name);
    }
  }

  // --------------------------- 小窗 UI --------------------------------------
  var PANEL_ID = 'sgs-capture-panel';
  var logs = [];

  function log(msg) {
    var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift('[' + t + '] ' + msg);
    if (logs.length > 30) logs.length = 30;
    var box = document.getElementById('sgs-cap-logs');
    if (box) box.textContent = logs.join('\n');
  }

  GM_addStyle([
    '#' + PANEL_ID + '{position:fixed;top:80px;right:16px;width:440px;max-height:82vh;z-index:2147483647;',
    'background:#1f2024;color:#e8e8ea;border:1px solid #3a3b40;border-radius:10px;',
    'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);',
    'display:flex;flex-direction:column;overflow:hidden;}',
    '#' + PANEL_ID + ' *{box-sizing:border-box;}',
    '#sgs-cap-head{padding:9px 12px;background:#2a2b31;cursor:move;user-select:none;display:flex;align-items:center;gap:8px;border-bottom:1px solid #3a3b40;}',
    '#sgs-cap-head b{font-weight:600;font-size:13px;flex:1;}',
    '#sgs-cap-min,#sgs-cap-close{background:#3a3b40;border:0;color:#e8e8ea;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px;}',
    '#sgs-cap-body{padding:10px 12px;overflow:auto;}',
    '#' + PANEL_ID + '.min #sgs-cap-body{display:none;}',
    '.sgs-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}',
    '.sgs-btn{background:#3a5bd9;border:0;color:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;}',
    '.sgs-btn:disabled{background:#44454c;color:#888;cursor:default;}',
    '.sgs-btn.ghost{background:#3a3b40;}',
    '#sgs-cap-list{max-height:170px;overflow:auto;border:1px solid #3a3b40;border-radius:6px;margin-bottom:8px;}',
    '.sgs-item{padding:6px 8px;border-bottom:1px solid #303136;cursor:pointer;display:flex;gap:6px;align-items:center;}',
    '.sgs-item:last-child{border-bottom:0;}',
    '.sgs-item.sel{background:#2f3550;}',
    '.sgs-item .id{color:#8fa7ff;font-family:monospace;width:26px;}',
    '.sgs-item .u{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9cad0;}',
    '.sgs-item .sz{font-size:11px;color:#9a9ba0;font-family:monospace;}',
    '#sgs-cap-prev{width:100%;height:130px;background:#16171a;color:#b9d4b0;border:1px solid #3a3b40;border-radius:6px;',
    'padding:7px;font:11px/1.45 monospace;resize:vertical;margin-bottom:8px;}',
    '#sgs-cap-logs{width:100%;height:60px;background:#16171a;color:#9a9ba0;border:1px solid #3a3b40;border-radius:6px;',
    'padding:6px;font:11px/1.45 monospace;overflow:auto;white-space:pre-wrap;word-break:break-all;}',
    '.sgs-hint{color:#8a8b90;font-size:11px;margin:4px 0 8px;}'
  ].join(''));

  function buildPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    var p = document.createElement('div');
    p.id = PANEL_ID;
    p.innerHTML =
      '<div id="sgs-cap-head">' +
        '<b>三国杀精测 · 抓取小窗</b>' +
        '<button id="sgs-cap-min">—</button>' +
        '<button id="sgs-cap-close">×</button>' +
      '</div>' +
      '<div id="sgs-cap-body">' +
        '<div class="sgs-hint">打开活动后台页面即自动监听，命中的 JSON 会列在下面。点一条预览，再复制或下载。</div>' +
        '<div class="sgs-row">' +
          '<button class="sgs-btn" id="sgs-cap-copy">复制选中</button>' +
          '<button class="sgs-btn" id="sgs-cap-dl">下载选中</button>' +
          '<button class="sgs-btn ghost" id="sgs-cap-dlall">全部下载</button>' +
          '<button class="sgs-btn ghost" id="sgs-cap-clear">清空</button>' +
        '</div>' +
        '<div class="sgs-hint" id="sgs-cap-count">尚未抓到数据</div>' +
        '<div id="sgs-cap-list"></div>' +
        '<textarea id="sgs-cap-prev" readonly></textarea>' +
        '<div id="sgs-cap-logs"></div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(p);

    document.getElementById('sgs-cap-copy').addEventListener('click', function () {
      var it = captured[selected];
      if (it) copyItem(it); else log('没有选中的数据');
    });
    document.getElementById('sgs-cap-dl').addEventListener('click', function () {
      var it = captured[selected];
      if (it) downloadItem(it); else log('没有选中的数据');
    });
    document.getElementById('sgs-cap-dlall').addEventListener('click', downloadAll);
    document.getElementById('sgs-cap-clear').addEventListener('click', function () {
      captured = []; selected = -1; render(); log('已清空');
    });
    document.getElementById('sgs-cap-min').addEventListener('click', function () {
      p.classList.toggle('min');
    });
    document.getElementById('sgs-cap-close').addEventListener('click', function () {
      p.style.display = 'none';
    });
    makeDraggable(p, document.getElementById('sgs-cap-head'));
    render();
  }

  function makeDraggable(panel, handle) {
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = panel.offsetLeft; oy = panel.offsetTop;
      panel.style.right = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      panel.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
  }

  function render() {
    var list = document.getElementById('sgs-cap-list');
    var cnt = document.getElementById('sgs-cap-count');
    var prev = document.getElementById('sgs-cap-prev');
    if (!list) return;
    cnt.textContent = captured.length ? ('共 ' + captured.length + ' 条（最多保留 ' + CAPTURE.maxKeep + ' 条）') : '尚未抓到数据 — 打开活动后台页面后自动监听';
    list.innerHTML = '';
    captured.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'sgs-item' + (i === selected ? ' sel' : '');
      d.innerHTML = '<span class="id">#' + it.id + '</span>' +
                    '<span class="u" title="' + it.url.replace(/"/g, '&quot;') + '">' + it.method + ' ' + it.url + '</span>' +
                    '<span class="sz">' + prettyBytes(it.size) + '</span>';
      d.addEventListener('click', function () {
        selected = i;
        prev.value = it.preview;
        render();
      });
      list.appendChild(d);
    });
    var cur = captured[selected];
    if (cur) prev.value = cur.preview;
    ['sgs-cap-copy', 'sgs-cap-dl'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = !cur;
    });
    var allBtn = document.getElementById('sgs-cap-dlall');
    if (allBtn) allBtn.disabled = !captured.length;
  }

  GM_registerMenuCommand('三国杀精测：显示小窗', function () {
    var p = document.getElementById(PANEL_ID);
    if (p) p.style.display = '';
  });

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildPanel);
    } else {
      buildPanel();
    }
  }
  init();
})();
