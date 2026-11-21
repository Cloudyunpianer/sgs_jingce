// ==UserScript==
// @name         三国杀精测 · 内嵌精测台（抓包+导入）
// @namespace    https://github.com/Cloudyunpianer/sgs_jingce
// @version      2.0.0
// @description  在三国杀官网页面内嵌完整精测程序，hook 后台 JSON，一键导入数据并精测。配套 sgs_jingce。
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
 * 这是油猴脚本的源模板，不是最终安装版。
 * 最终安装版由 tools/capture/build-embedded.js 把 embedded.html 内联进来后
 * 生成 tools/capture/sgs-jingce.user.js。改本文件后要重跑构建脚本。
 *
 * 用法：
 *  - 安装 tools/capture/sgs-jingce.user.js 到 Tampermonkey / Violentmonkey。
 *  - 打开三国杀官网活动后台页面，右上角出现小窗：下半是完整精测程序，
 *    上半是抓包工具条。hook 到的 JSON 或手动粘贴的公告文本，点「导入到精测」
 *    即通过 postMessage 发给内嵌精测程序，自动解析并出结果。
 *  - 脚本不写磁盘、不连本地服务、不碰 git。
 * ============================================================================
 */

(function () {
  'use strict';

  // 由构建脚本注入：完整精测程序的自包含 HTML（349KB）
  var EMBEDDED_HTML = __EMBEDDED_HTML__;

  // ----------------------------- 配置区 -------------------------------------
  var CAPTURE = {
    // URL 命中任一关键字就抓取（不区分大小写）。留空数组 [] 则抓所有 JSON。
    // TODO: 换成真实活动接口路径
    urlPatterns: ['activity', 'news', 'event', 'config'],
    minSize: 200,
    maxKeep: 50
  };

  /* JSON → 公告文本的转换钩子。
     默认走通用展平（见 jsonToText）。拿到真实接口样例后，可在这里写精准转换，
     例如 return payload.data.content 或把结构化字段拼成公告 md 表格。
     函数签名：function(payload, url) -> string（公告 markdown 文本）。 */
  var TRANSFORM = null;
  // --------------------------------------------------------------------------

  var captured = [];
  var selected = -1;
  var seq = 0;
  var iframe = null;

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
      try { payload = JSON.parse(text); } catch (e) { return; }
      var item = {
        id: ++seq, url: String(url), method: method || 'GET',
        size: text.length, time: new Date(), payload: payload, text: text,
        preview: text.length > 3000 ? text.slice(0, 3000) + '\n…（预览截断）' : text,
        activity: guessActivity(url)
      };
      captured.unshift(item);
      if (captured.length > CAPTURE.maxKeep) captured.length = CAPTURE.maxKeep;
      selected = 0;
      render();
      /* 抓到新数据就自动把转换后的公告文本填进文本框，用户能立刻看到/改/导入 */
      var ta = document.getElementById('sgs-jc-text');
      if (ta) ta.value = toNoticeText(item);
      log('抓到 #' + item.id + ' ' + item.method + ' ' + prettyBytes(item.size));
    } catch (e) { log('抓取处理异常：' + e.message); }
  }

  (function hookXHR() {
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__sgsUrl = url; this.__sgsMethod = method;
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
        } catch (e) {}
      });
      return send.apply(this, arguments);
    };
  })();

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
            resp.clone().text().then(function (t) { ingest(url, t, (init && init.method) || 'GET'); });
          } catch (e) {}
        });
      } catch (e) {}
      return p;
    };
  })();

  // --------------------------- JSON → 公告文本 -------------------------------
  function stripHtml(s) {
    return String(s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n');
  }
  function jsonToText(payload) {
    if (typeof payload === 'string') return stripHtml(payload);
    if (!payload || typeof payload !== 'object') return '';
    // 常见正文容器字段
    var keys = ['content', 'markdown', 'md', 'text', 'notice', 'detail', 'body', 'data', 'result'];
    for (var i = 0; i < keys.length; i++) {
      var v = payload[keys[i]];
      if (typeof v === 'string' && v.length > 100) return stripHtml(v);
      if (v && typeof v === 'object') {
        var sub = jsonToText(v);
        if (sub && sub.length > 100) return sub;
      }
    }
    // 兜底：整个对象转文本（解析大概率失败，但用户可在文本框里手动改）
    return stripHtml(JSON.stringify(payload, null, 2));
  }
  function toNoticeText(item) {
    if (TRANSFORM) {
      try { return TRANSFORM(item.payload, item.url) || ''; } catch (e) { log('TRANSFORM 出错：' + e.message); }
    }
    return jsonToText(item.payload);
  }

  // --------------------------- 导入到精测 -----------------------------------
  function importToJingce(text) {
    if (!text || !text.trim()) { log('没有可导入的文本'); return; }
    if (!iframe || !iframe.contentWindow) { log('精测程序未就绪'); return; }
    iframe.contentWindow.postMessage({ __sgsCapture: 1, type: 'import', text: text }, '*');
    log('已发送导入请求（' + prettyBytes(text.length) + '）');
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__sgsCapture !== 1 || d.type !== 'importResult') return;
    log(d.ok ? '✓ 精测已导入并刷新' : ('✗ 精测导入失败：' + (d.error || '未知错误')));
  });

  // --------------------------- 导出 -----------------------------------------
  function copyText(text) {
    try { GM_setClipboard(text, 'text'); log('✓ 已复制到剪贴板'); }
    catch (e) { log('✗ 复制失败：' + e.message); }
  }
  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      log('✓ 已下载 ' + name);
    } catch (e) { log('✗ 下载失败：' + e.message); }
  }

  // --------------------------- 小窗 UI --------------------------------------
  var PANEL_ID = 'sgs-jingce-panel';
  var logs = [];
  function log(msg) {
    var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift('[' + t + '] ' + msg);
    if (logs.length > 20) logs.length = 20;
    var box = document.getElementById('sgs-jc-logs');
    if (box) box.textContent = logs.join('\n');
  }

  GM_addStyle([
    '#' + PANEL_ID + '{position:fixed;top:40px;left:20px;width:1180px;height:800px;min-width:760px;min-height:520px;',
    'z-index:2147483647;background:#1f2024;color:#e8e8ea;border:1px solid #3a3b40;border-radius:10px;',
    'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.5);',
    'display:flex;flex-direction:column;overflow:hidden;resize:both;}',
    '#' + PANEL_ID + ' *{box-sizing:border-box;}',
    '#sgs-jc-head{padding:8px 12px;background:#2a2b31;cursor:move;user-select:none;display:flex;align-items:center;gap:8px;border-bottom:1px solid #3a3b40;flex:none;}',
    '#sgs-jc-head b{font-weight:600;font-size:13px;flex:1;}',
    '#sgs-jc-head .btn{background:#3a3b40;border:0;color:#e8e8ea;border-radius:5px;padding:2px 9px;cursor:pointer;font-size:12px;}',
    '#sgs-jc-bar{padding:8px 10px;background:#24252a;border-bottom:1px solid #3a3b40;flex:none;}',
    '#sgs-jc-bar .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}',
    '#sgs-jc-bar .btn{background:#3a5bd9;border:0;color:#fff;border-radius:5px;padding:4px 11px;cursor:pointer;font-size:12px;}',
    '#sgs-jc-bar .btn.ghost{background:#3a3b40;}',
    '#sgs-jc-bar .btn:disabled{background:#44454c;color:#888;cursor:default;}',
    '#sgs-jc-list{display:flex;gap:5px;flex-wrap:wrap;max-height:56px;overflow:auto;margin-bottom:6px;}',
    '.jc-item{padding:3px 8px;border:1px solid #44454c;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap;}',
    '.jc-item.sel{background:#2f3550;border-color:#6a78c8;}',
    '#sgs-jc-text{width:100%;height:52px;background:#16171a;color:#b9d4b0;border:1px solid #3a3b40;border-radius:6px;padding:6px;font:11px/1.4 monospace;resize:vertical;}',
    '#sgs-jc-logs{width:100%;height:34px;background:#16171a;color:#9a9ba0;border:1px solid #3a3b40;border-radius:6px;padding:4px 6px;font:11px/1.4 monospace;overflow:auto;white-space:pre-wrap;margin-top:6px;}',
    '#sgs-jc-frame-wrap{flex:1;min-height:0;background:#fff;}',
    '#sgs-jc-frame{width:100%;height:100%;border:0;}',
    '#sgs-jc-panel.min #sgs-jc-bar,#sgs-jc-panel.min #sgs-jc-frame-wrap{display:none;}'
  ].join(''));

  function buildPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    var p = document.createElement('div');
    p.id = PANEL_ID;
    p.innerHTML =
      '<div id="sgs-jc-head">' +
        '<b>三国杀精测 · 内嵌精测台</b>' +
        '<button class="btn" id="sgs-jc-min">—</button>' +
        '<button class="btn" id="sgs-jc-close">×</button>' +
      '</div>' +
      '<div id="sgs-jc-bar">' +
        '<div class="row">' +
          '<button class="btn" id="sgs-jc-import">导入选中到精测</button>' +
          '<button class="btn ghost" id="sgs-jc-importtext">导入下方文本</button>' +
          '<button class="btn ghost" id="sgs-jc-copy">复制转换文本</button>' +
          '<button class="btn ghost" id="sgs-jc-dl">下载选中JSON</button>' +
          '<button class="btn ghost" id="sgs-jc-clear">清空抓包</button>' +
        '</div>' +
        '<div id="sgs-jc-list"></div>' +
        '<textarea id="sgs-jc-text" placeholder="抓到 JSON 后这里会填好转换后的公告文本，可直接改；也可手动粘贴公告 md 再点「导入下方文本」"></textarea>' +
        '<div id="sgs-jc-logs"></div>' +
      '</div>' +
      '<div id="sgs-jc-frame-wrap"><iframe id="sgs-jc-frame" sandbox="allow-scripts allow-same-origin"></iframe></div>';
    (document.body || document.documentElement).appendChild(p);

    iframe = document.getElementById('sgs-jc-frame');
    // srcdoc 载入完整精测程序
    iframe.srcdoc = EMBEDDED_HTML;

    document.getElementById('sgs-jc-import').onclick = function () {
      var it = captured[selected];
      if (!it) { log('没有选中的抓包数据'); return; }
      var text = toNoticeText(it);
      var ta = document.getElementById('sgs-jc-text');
      if (ta) ta.value = text;
      importToJingce(text);
    };
    document.getElementById('sgs-jc-importtext').onclick = function () {
      importToJingce(document.getElementById('sgs-jc-text').value);
    };
    document.getElementById('sgs-jc-copy').onclick = function () {
      var it = captured[selected];
      copyText(it ? toNoticeText(it) : document.getElementById('sgs-jc-text').value);
    };
    document.getElementById('sgs-jc-dl').onclick = function () {
      var it = captured[selected];
      if (it) download((it.activity || ('抓取_' + it.id)) + '.json', JSON.stringify(it.payload, null, 2));
      else log('没有选中的抓包数据');
    };
    document.getElementById('sgs-jc-clear').onclick = function () {
      captured = []; selected = -1; render(); log('已清空抓包');
    };
    document.getElementById('sgs-jc-min').onclick = function () { p.classList.toggle('min'); };
    document.getElementById('sgs-jc-close').onclick = function () { p.style.display = 'none'; };
    makeDraggable(p, document.getElementById('sgs-jc-head'));
    render();
    log('就绪：精测程序已内嵌，等待抓包或手动粘贴公告');
  }

  function makeDraggable(panel, handle) {
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      ox = panel.offsetLeft; oy = panel.offsetTop;
      panel.style.left = ox + 'px'; panel.style.top = oy + 'px';
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
    var list = document.getElementById('sgs-jc-list');
    if (!list) return;
    list.innerHTML = '';
    captured.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'jc-item' + (i === selected ? ' sel' : '');
      d.textContent = '#' + it.id + ' ' + it.method + ' ' + prettyBytes(it.size);
      d.title = it.url;
      d.onclick = function () {
        selected = i;
        var ta = document.getElementById('sgs-jc-text');
        if (ta) ta.value = toNoticeText(it);
        render();
      };
      list.appendChild(d);
    });
    var impBtn = document.getElementById('sgs-jc-import');
    if (impBtn) impBtn.disabled = !captured.length;
  }

  GM_registerMenuCommand('三国杀精测：显示内嵌精测台', function () {
    var p = document.getElementById(PANEL_ID);
    if (p) p.style.display = '';
  });

  function init() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
    else buildPanel();
  }
  init();
})();
