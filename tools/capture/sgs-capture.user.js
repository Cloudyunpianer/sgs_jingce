// ==UserScript==
// @name         三国杀精测 · 后台数据抓取小窗
// @namespace    https://github.com/Cloudyunpianer/sgs_jingce
// @version      1.0.0
// @description  抓取三国杀一将成名后台 JSON 数据，经本地接收端落盘并 git 自动提交。配套 sgs_jingce 精测工具。
// @author       sgs_jingce
// @match        *://x.sanguosha.com/*
// @match        *://*.sanguosha.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * ============================================================================
 * 使用前必读
 * ----------------------------------------------------------------------------
 * 1) 先在「本地接收端」跑起来：双击项目 tools/capture/start-server.bat
 *    它会生成 tools/capture/config.json，里面有一串 token。
 * 2) 把那串 token 填到下面 SERVER.token（留空时首次打开小窗会弹框让你填，
 *    并记住到浏览器本地，推荐这种方式，不必改脚本）。
 * 3) CAPTURE.urlPatterns 用来识别「哪些接口才是要抓的活动数据」。
 *    现在是可配置占位：命中任一关键字即抓取；留空数组则抓所有 JSON 响应。
 *    等你给出真实接口地址 / 样例后，把关键字换成真实接口路径即可。
 * 4) 抓到的数据在小窗里预览，点「发送选中」经本地接收端落盘 + git commit。
 *    打开「自动发送」后，命中规则的数据抓到即发，无需手点。
 *
 * 注意：页面是 https，本地服务是 http，普通 fetch 会被混合内容拦截，
 *      所以这里必须用 GM_xmlhttpRequest（已 @grant / @connect）。
 * ============================================================================
 */

(function () {
  'use strict';

  // ----------------------------- 配置区 -------------------------------------
  var SERVER = {
    url: 'http://127.0.0.1:17890',
    token: '' // 留空 -> 首次打开弹框输入并记住
  };

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
    autoSend: false,     // 抓到即发送（可在小窗里切换，会记住）
    maxKeep: 50          // 小窗最多保留多少条抓取记录
  };
  // --------------------------------------------------------------------------

  var TOKEN_KEY = 'sgs_capture_token';
  var AUTO_KEY = 'sgs_capture_auto';
  var captured = [];
  var selected = -1;
  var seq = 0;

  function getToken() {
    if (SERVER.token) return SERVER.token;
    var saved = GM_getValue(TOKEN_KEY, '');
    if (saved) return saved;
    var input = window.prompt('请输入本地接收端的 token（见 tools/capture/config.json）：', '');
    if (input && input.trim()) {
      GM_setValue(TOKEN_KEY, input.trim());
      return input.trim();
    }
    return '';
  }

  function autoSendOn() {
    var v = GM_getValue(AUTO_KEY, CAPTURE.autoSend ? '1' : '0');
    return v === '1';
  }
  function setAutoSend(on) { GM_setValue(AUTO_KEY, on ? '1' : '0'); }

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
        preview: text.length > 4000 ? text.slice(0, 4000) + '\n…（已截断）' : text,
        activity: guessActivity(url),
        sent: false,
        lastResult: null
      };
      captured.unshift(item);
      if (captured.length > CAPTURE.maxKeep) captured.length = CAPTURE.maxKeep;
      selected = 0;
      render();
      log('抓到 #' + item.id + ' ' + item.method + ' ' + prettyBytes(item.size));

      if (autoSendOn()) sendItem(item);
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

  // --------------------------- 发送到本地 -----------------------------------
  function sendItem(item) {
    var token = getToken();
    if (!token) { log('未填 token，无法发送'); return; }
    var body = {
      token: token,
      source: item.url,
      activity: item.activity || '',
      title: item.activity || ('抓取_' + item.id),
      capturedAt: item.time.toISOString(),
      payload: item.payload
    };
    item.sent = 'sending';
    render();
    try {
      GM_xmlhttpRequest({
        method: 'POST',
        url: SERVER.url + '/ingest',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(body),
        timeout: 15000,
        onload: function (res) {
          var r = {};
          try { r = JSON.parse(res.responseText); } catch (e) { r = { ok: false, error: res.responseText }; }
          if (res.status === 200 && r.ok) {
            item.sent = true;
            item.lastResult = r;
            log('✓ #' + item.id + (r.duplicate ? ' 重复跳过' : ' 已落盘') + (r.commitHash ? ' commit ' + r.commitHash : ''));
          } else {
            item.sent = false;
            item.lastResult = r;
            log('✗ #' + item.id + ' ' + (r.error || ('HTTP ' + res.status)));
          }
          render();
        },
        onerror: function () {
          item.sent = false;
          item.lastResult = { error: '连不上本地接收端，确认 start-server.bat 已启动' };
          log('✗ #' + item.id + ' 连接失败');
          render();
        },
        ontimeout: function () {
          item.sent = false;
          item.lastResult = { error: '发送超时' };
          log('✗ #' + item.id + ' 超时');
          render();
        }
      });
    } catch (e) {
      item.sent = false;
      item.lastResult = { error: e.message };
      log('发送异常：' + e.message);
      render();
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
    '#' + PANEL_ID + '{position:fixed;top:80px;right:16px;width:420px;max-height:80vh;z-index:2147483647;',
    'background:#1f2024;color:#e8e8ea;border:1px solid #3a3b40;border-radius:10px;',
    'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);',
    'display:flex;flex-direction:column;overflow:hidden;}',
    '#' + PANEL_ID + ' *{box-sizing:border-box;}',
    '#sgs-cap-head{padding:9px 12px;background:#2a2b31;cursor:move;user-select:none;display:flex;align-items:center;gap:8px;border-bottom:1px solid #3a3b40;}',
    '#sgs-cap-head b{font-weight:600;font-size:13px;flex:1;}',
    '#sgs-cap-head .dot{width:8px;height:8px;border-radius:50%;background:#e24b4a;}',
    '#sgs-cap-head .dot.on{background:#3fbf7f;}',
    '#sgs-cap-min,#sgs-cap-close{background:#3a3b40;border:0;color:#e8e8ea;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px;}',
    '#sgs-cap-body{padding:10px 12px;overflow:auto;}',
    '#sgs-cap-panel.min #sgs-cap-body{display:none;}',
    '.sgs-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}',
    '.sgs-row label{color:#a9aab0;}',
    '#sgs-cap-token{flex:1;min-width:120px;background:#2a2b31;border:1px solid #44454c;color:#e8e8ea;border-radius:5px;padding:4px 7px;font:12px monospace;}',
    '.sgs-btn{background:#3a5bd9;border:0;color:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;}',
    '.sgs-btn:disabled{background:#44454c;color:#888;cursor:default;}',
    '.sgs-btn.ghost{background:#3a3b40;}',
    '#sgs-cap-list{max-height:180px;overflow:auto;border:1px solid #3a3b40;border-radius:6px;margin-bottom:8px;}',
    '.sgs-item{padding:6px 8px;border-bottom:1px solid #303136;cursor:pointer;display:flex;gap:6px;align-items:center;}',
    '.sgs-item:last-child{border-bottom:0;}',
    '.sgs-item.sel{background:#2f3550;}',
    '.sgs-item .id{color:#8fa7ff;font-family:monospace;width:26px;}',
    '.sgs-item .u{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9cad0;}',
    '.sgs-item .st{font-size:11px;padding:1px 6px;border-radius:8px;background:#3a3b40;color:#bbb;}',
    '.sgs-item .st.ok{background:#1e5b3b;color:#9ff0c4;}',
    '.sgs-item .st.sending{background:#5a4a1e;color:#f0d99f;}',
    '.sgs-item .st.err{background:#5a2424;color:#f0a0a0;}',
    '#sgs-cap-prev{width:100%;height:110px;background:#16171a;color:#b9d4b0;border:1px solid #3a3b40;border-radius:6px;',
    'padding:7px;font:11px/1.45 monospace;resize:vertical;margin-bottom:8px;}',
    '#sgs-cap-logs{width:100%;height:70px;background:#16171a;color:#9a9ba0;border:1px solid #3a3b40;border-radius:6px;',
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
        '<span class="dot" id="sgs-cap-dot"></span>' +
        '<b>三国杀精测 · 抓取小窗</b>' +
        '<button id="sgs-cap-min">—</button>' +
        '<button id="sgs-cap-close">×</button>' +
      '</div>' +
      '<div id="sgs-cap-body">' +
        '<div class="sgs-row"><label>活动名</label><input id="sgs-cap-title" placeholder="自动识别或手填"></div>' +
        '<div class="sgs-row">' +
          '<input id="sgs-cap-token" placeholder="本地接收端 token">' +
          '<button class="sgs-btn ghost" id="sgs-cap-save">保存</button>' +
        '</div>' +
        '<div class="sgs-row">' +
          '<label><input type="checkbox" id="sgs-cap-auto"> 自动发送</label>' +
          '<button class="sgs-btn" id="sgs-cap-send">发送选中</button>' +
          '<button class="sgs-btn ghost" id="sgs-cap-sendall">全部发送</button>' +
          '<button class="sgs-btn ghost" id="sgs-cap-clear">清空</button>' +
        '</div>' +
        '<div class="sgs-hint" id="sgs-cap-count">尚未抓到数据</div>' +
        '<div id="sgs-cap-list"></div>' +
        '<textarea id="sgs-cap-prev" readonly></textarea>' +
        '<div id="sgs-cap-logs"></div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(p);

    var tokenInput = document.getElementById('sgs-cap-token');
    tokenInput.value = getToken();
    document.getElementById('sgs-cap-auto').checked = autoSendOn();
    document.getElementById('sgs-cap-save').addEventListener('click', function () {
      var v = tokenInput.value.trim();
      if (v) { GM_setValue(TOKEN_KEY, v); SERVER.token = v; log('token 已保存'); }
    });
    document.getElementById('sgs-cap-auto').addEventListener('change', function (e) {
      setAutoSend(e.target.checked);
      log('自动发送：' + (e.target.checked ? '开' : '关'));
    });
    document.getElementById('sgs-cap-send').addEventListener('click', function () {
      var it = captured[selected];
      if (it) sendItem(it); else log('没有选中的数据');
    });
    document.getElementById('sgs-cap-sendall').addEventListener('click', function () {
      captured.forEach(function (it) { if (!it.sent) sendItem(it); });
    });
    document.getElementById('sgs-cap-clear').addEventListener('click', function () {
      captured = []; selected = -1; render(); log('已清空');
    });
    document.getElementById('sgs-cap-min').addEventListener('click', function () {
      p.classList.toggle('min');
    });
    document.getElementById('sgs-cap-close').addEventListener('click', function () {
      p.style.display = 'none';
    });
    document.getElementById('sgs-cap-title').addEventListener('input', function (e) {
      if (captured[selected]) captured[selected].activity = e.target.value.trim();
    });
    makeDraggable(p, document.getElementById('sgs-cap-head'));
    checkHealth();
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

  function checkHealth() {
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url: SERVER.url + '/health',
        timeout: 4000,
        onload: function (res) {
          var ok = res.status === 200;
          var dot = document.getElementById('sgs-cap-dot');
          if (dot) dot.classList.toggle('on', ok);
          log(ok ? '接收端已连接' : '接收端返回 ' + res.status);
        },
        onerror: function () {
          var dot = document.getElementById('sgs-cap-dot');
          if (dot) dot.classList.remove('on');
          log('接收端未启动？双击 start-server.bat');
        }
      });
    } catch (e) { log('健康检测失败：' + e.message); }
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
      var st = it.sent === true ? 'ok' : (it.sent === 'sending' ? 'sending' : (it.sent === false && it.lastResult ? 'err' : ''));
      var stTxt = it.sent === true ? (it.lastResult && it.lastResult.duplicate ? '重复' : (it.lastResult && it.lastResult.commitHash ? it.lastResult.commitHash : '已存')) :
                  (it.sent === 'sending' ? '发送中' : (st ? '失败' : '待发'));
      d.innerHTML = '<span class="id">#' + it.id + '</span>' +
                    '<span class="u" title="' + it.url.replace(/"/g, '&quot;') + '">' + it.method + ' ' + prettyBytes(it.size) + ' ' + it.url + '</span>' +
                    '<span class="st ' + st + '">' + stTxt + '</span>';
      d.addEventListener('click', function () {
        selected = i;
        prev.value = it.preview;
        var ti = document.getElementById('sgs-cap-title');
        if (ti) ti.value = it.activity || '';
        render();
      });
      list.appendChild(d);
    });
    var cur = captured[selected];
    if (cur) prev.value = cur.preview;
    var sendBtn = document.getElementById('sgs-cap-send');
    if (sendBtn) sendBtn.disabled = !cur;
  }

  GM_registerMenuCommand('三国杀精测：重置 token', function () {
    GM_setValue(TOKEN_KEY, '');
    SERVER.token = '';
    log('token 已清除，下次发送会重新询问');
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
