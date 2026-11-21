// ==UserScript==
// @name         吾亦能善算谋划
// @namespace    https://github.com/Cloudyunpianer/sgs_jingce
// @version      2.2.0
// @description  在三国杀官网页面内嵌完整精测程序，hook 后台 JSON，一键导入本期活动并精测。配套 sgs_jingce。
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
 *  - 打开三国杀官网活动后台页面，右下角出现「⚡ 精测」小浮窗，点它才打开
 *    全屏精测台（不会自动弹出打扰浏览）。
 *  - 进入后点顶部「⚡ 一键导入本期活动」：自动挑抓到的活动 JSON 转成公告
 *    文本并导入，当场出结果。选将/计算仍在精测界面里手动操作。
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
  var panelBuilt = false;

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
      /* 抓到新数据就自动把转换后的公告文本填进文本框（若面板已建），用户能立刻看到/改 */
      var ta = document.getElementById('sgs-jc-text');
      if (ta) ta.value = toNoticeText(item);
      log('抓到 #' + item.id + ' ' + item.method + ' ' + prettyBytes(item.size));
      setStatus('抓包 ' + captured.length + ' 条 · 最新 #' + item.id);
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

  /* 公告正文体检：精测的 PARSER 只认公告里的句式/表格。
     纯配置 JSON（如 day_gifts / add_gift_config / qywx_friend_days）转成文本后
     是一堆英文 key 和数字，命中不了这些特征，导入也是空解析——与其让用户
     对着"什么都没有"的界面发懵，不如在导入前明确拦下并说明原因。 */
  function looksLikeNotice(text) {
    var t = String(text || '');
    if (t.length < 100) return { ok: false, why: '文本太短（' + t.length + ' 字），不像公告正文' };
    var patterns = [
      /单笔充值\s*\d+\s*元宝/, /累计充值\s*\d+\s*元宝/, /每日消费\s*\d+\s*元宝/,
      /累计消费\s*\d+\s*元宝/, /累计纳贤/, /可领取奖励/, /限完成\s*\d*\s*次/,
      /纳贤令/, /充值.*倍率/, /活动时间/ ,/\|[^\n]*\|[^\n]*\|/
    ];
    var hit = 0;
    patterns.forEach(function (re) { if (re.test(t)) hit++; });
    if (hit >= 2) return { ok: true, hit: hit };
    return { ok: false, why: '未检测到公告特征（充值档位/纳贤进度/奖励表格等），只有 ' + hit + ' 项弱特征' };
  }

  /* 从抓包里自动挑「最像本期活动公告」的一条：
     URL 命中活动/公告类关键字加权，其次正文越长越可能是真公告。 */
  function pickBestCapture() {
    if (!captured.length) return null;
    var best = null, bestScore = -1;
    captured.forEach(function (it) {
      var txt = '';
      try { txt = toNoticeText(it) || ''; } catch (e) {}
      var score = txt.length >= 100 ? txt.length : 0;
      if (/activity|news|notice|event|gonggao|bulletin/i.test(it.url)) score += 1000000;
      if (score > bestScore) { bestScore = score; best = it; }
    });
    return bestScore > 0 ? best : null;
  }

  // --------------------------- 导入到精测 -----------------------------------
  /* strict=true 时（一键导入抓包数据）先做公告体检，不像公告就拦下，
     避免把福利配置 JSON 导进去得到一片空白。手动粘贴只警告不拦。 */
  function importToJingce(text, strict) {
    if (!text || !text.trim()) { log('没有可导入的文本'); return false; }
    var chk = looksLikeNotice(text);
    if (!chk.ok) {
      if (strict) {
        log('✗ 已拦下：' + chk.why);
        setStatus('✗ 这段数据不是公告正文 — 请到公告详情页抓取');
        return false;
      }
      log('⚠ 提示：' + chk.why + '（仍按你的手动输入导入）');
    }
    if (!iframe || !iframe.contentWindow) { log('精测程序未就绪'); return false; }
    iframe.contentWindow.postMessage({ __sgsCapture: 1, type: 'import', text: text }, '*');
    log('已发送导入请求（' + prettyBytes(text.length) + '）');
    return true;
  }

  function oneClickImport() {
    var ta = document.getElementById('sgs-jc-text');
    var manual = (ta && ta.value || '').trim();
    // 1) 用户已在文本框粘贴公告 —— 优先用他的（手动内容只警告不拦）
    if (manual.length >= 20) {
      if (importToJingce(manual, false)) setStatus('✓ 已导入手动文本 · ' + prettyBytes(manual.length));
      return;
    }
    // 2) 否则从抓包里自动挑最合适的（严格体检）
    var it = pickBestCapture();
    if (!it) {
      log('未抓到可用的公告数据：请打开官网【活动公告详情页】刷新，让页面加载公告正文');
      setStatus('未抓到公告正文 — 请到公告详情页刷新抓取');
      openDetail(true);
      return;
    }
    var text = toNoticeText(it);
    if (ta) ta.value = text;
    selected = captured.indexOf(it);
    render();
    if (importToJingce(text, true)) setStatus('✓ 已导入 #' + it.id + ' · ' + prettyBytes(it.size));
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__sgsCapture !== 1 || d.type !== 'importResult') return;
    log(d.ok ? '✓ 精测已导入并刷新' : ('✗ 精测导入失败：' + (d.error || '未知错误')));
    setStatus(d.ok ? '✓ 本期活动已导入，开始精测吧' : ('✗ 导入失败：' + (d.error || '未知错误')));
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

  // --------------------------- 日志 / 状态 ----------------------------------
  var logs = [];
  var LAUNCHER_ID = 'sgs-jc-launcher';
  var PANEL_ID = 'sgs-jingce-panel';
  function log(msg) {
    var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift('[' + t + '] ' + msg);
    if (logs.length > 20) logs.length = 20;
    var box = document.getElementById('sgs-jc-logs');
    if (box) box.textContent = logs.join('\n');
  }
  function setStatus(msg) {
    var el = document.getElementById('sgs-jc-status');
    if (el) el.textContent = msg;
  }

  // --------------------------- 样式 -----------------------------------------
  GM_addStyle([
    /* 右下角启动浮窗：进页面只显示它，不打扰浏览 */
    '#' + LAUNCHER_ID + '{position:fixed;right:24px;bottom:24px;z-index:2147483646;',
    'background:linear-gradient(135deg,#5b7cfa,#8b5cf6);color:#fff;border:0;border-radius:999px;',
    'padding:13px 22px;font:700 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'cursor:pointer;box-shadow:0 8px 26px rgba(91,124,250,.5);transition:transform .15s,box-shadow .15s;',
    'display:flex;align-items:center;gap:8px;user-select:none;}',
    '#' + LAUNCHER_ID + ':hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(91,124,250,.62);}',

    /* 全屏面板 */
    '#' + PANEL_ID + '{position:fixed;inset:0;z-index:2147483647;background:#15161a;',
    'display:flex;flex-direction:column;overflow:hidden;color:#e8e8ea;',
    'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    '#' + PANEL_ID + ' *{box-sizing:border-box;}',
    '#' + PANEL_ID + '.hidden{display:none;}',

    /* 顶栏 */
    '#sgs-jc-head{height:54px;flex:none;display:flex;align-items:center;gap:12px;padding:0 20px;',
    'background:linear-gradient(90deg,#1c2130,#252a3c);border-bottom:1px solid #313747;}',
    '#sgs-jc-head .brand{font-size:15px;font-weight:700;color:#eef0f5;flex:1;display:flex;align-items:center;gap:9px;}',
    '#sgs-jc-head .brand .dot{width:9px;height:9px;border-radius:50%;background:#5b7cfa;box-shadow:0 0 10px #5b7cfa;}',
    '#sgs-jc-head .status{color:#9aa0b4;font-size:12px;font-weight:400;margin-left:auto;}',
    '#sgs-jc-head .btn{background:#313747;color:#c8ccd6;border:0;border-radius:7px;padding:7px 13px;cursor:pointer;font-size:12px;}',
    '#sgs-jc-head .btn:hover{background:#3d4459;}',

    /* 一键导入工具条 */
    '#sgs-jc-toolbar{flex:none;padding:11px 20px;background:#1b1c21;border-bottom:1px solid #2b2c33;',
    'display:flex;gap:14px;align-items:center;flex-wrap:wrap;}',
    '#sgs-jc-oneclick{background:linear-gradient(135deg,#5b7cfa,#8b5cf6);color:#fff;border:0;border-radius:9px;',
    'padding:11px 26px;font:700 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;',
    'box-shadow:0 4px 14px rgba(91,124,250,.35);transition:filter .15s,transform .1s;}',
    '#sgs-jc-oneclick:hover{filter:brightness(1.12);}',
    '#sgs-jc-oneclick:active{transform:scale(.98);}',
    '#sgs-jc-toolbar .hint{color:#7d8290;font-size:12px;}',

    /* 抓包详情（默认折叠） */
    '#sgs-jc-detail{flex:none;padding:10px 20px;background:#17181c;border-bottom:1px solid #2b2c33;display:none;}',
    '#sgs-jc-detail.on{display:block;}',
    '#sgs-jc-detail .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}',
    '#sgs-jc-detail .btn{background:#2e3038;color:#d5d8e0;border:1px solid #3c3e48;border-radius:7px;',
    'padding:6px 12px;cursor:pointer;font-size:12px;}',
    '#sgs-jc-detail .btn:hover{background:#3a3d47;}',
    '#sgs-jc-list{display:flex;gap:6px;flex-wrap:wrap;max-height:34px;overflow:auto;flex:1;min-width:120px;}',
    '.jc-item{padding:3px 9px;border:1px solid #3a3c46;border-radius:6px;cursor:pointer;font-size:11px;color:#aeb2bc;white-space:nowrap;}',
    '.jc-item.sel{background:#2b3358;border-color:#6a7ce0;color:#fff;}',
    '#sgs-jc-text{width:100%;height:58px;background:#101114;color:#b9d4b0;border:1px solid #3a3b40;',
    'border-radius:6px;padding:7px;font:11px/1.45 monospace;resize:vertical;}',
    '#sgs-jc-logs{width:100%;height:38px;background:#101114;color:#9a9ba0;border:1px solid #3a3b40;',
    'border-radius:6px;padding:5px 7px;font:11px/1.4 monospace;overflow:auto;white-space:pre-wrap;margin-top:6px;}',

    /* 精测 iframe 占满剩余 */
    '#sgs-jc-frame-wrap{flex:1;min-height:0;background:#fff;}',
    '#sgs-jc-frame{width:100%;height:100%;border:0;display:block;}'
  ].join(''));

  // --------------------------- 启动浮窗 / 面板 -------------------------------
  function buildLauncher() {
    var old = document.getElementById(LAUNCHER_ID);
    if (old) old.remove();
    var b = document.createElement('button');
    b.id = LAUNCHER_ID;
    b.innerHTML = '<span style="font-size:16px">⚡</span><span>精测</span>';
    b.title = '点击打开精测台 · 可按住拖动';
    var moved = false;
    b.onclick = function () { if (!moved) openPanel(); moved = false; };
    (document.body || document.documentElement).appendChild(b);
    makeLauncherDraggable(b, function (didMove) { moved = didMove; });
  }

  /* 浮窗拖动：按住移动到任意位置，松手后若发生过移动则抑制本次 click，
     避免"拖一下却打开了面板"。位置存 localStorage，下次打开还在原处。 */
  function makeLauncherDraggable(btn, onMove) {
    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    try {
      var saved = localStorage.getItem('sgs_jc_launcher_pos');
      if (saved) {
        var p = JSON.parse(saved);
        if (typeof p.x === 'number' && typeof p.y === 'number') {
          btn.style.left = p.x + 'px'; btn.style.top = p.y + 'px';
          btn.style.right = 'auto'; btn.style.bottom = 'auto';
        }
      }
    } catch (e) {}
    btn.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
      var r = btn.getBoundingClientRect();
      ox = r.left; oy = r.top;
      btn.style.left = ox + 'px'; btn.style.top = oy + 'px';
      btn.style.right = 'auto'; btn.style.bottom = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      var nx = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, ox + dx));
      var ny = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, oy + dy));
      btn.style.left = nx + 'px'; btn.style.top = ny + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      onMove && onMove(moved);
      if (moved) {
        try { localStorage.setItem('sgs_jc_launcher_pos', JSON.stringify({ x: btn.offsetLeft, y: btn.offsetTop })); } catch (e) {}
        /* 拖动本身不会触发 click；若标志一直留着，用户下一次真实点击会被吞掉。
           下一 tick 复位，既抑制拖动当次误触，又不影响之后的点击。 */
        setTimeout(function () { onMove && onMove(false); }, 60);
      }
    });
  }

  function openPanel() {
    if (!panelBuilt) buildPanel();
    var p = document.getElementById(PANEL_ID);
    if (p) { p.classList.remove('hidden'); p.style.display = ''; }
    var l = document.getElementById(LAUNCHER_ID);
    if (l) l.style.display = 'none';
    // 面板首次打开时，若之前已抓到数据，把最新一条填进文本框
    var ta = document.getElementById('sgs-jc-text');
    if (ta && !ta.value && captured.length) ta.value = toNoticeText(captured[0]);
    setStatus(captured.length ? ('抓包 ' + captured.length + ' 条，点上方按钮一键导入') : '等待抓包或粘贴公告');
  }

  function closePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.classList.add('hidden');
    var l = document.getElementById(LAUNCHER_ID);
    if (l) l.style.display = '';
  }

  function openDetail(force) {
    var d = document.getElementById('sgs-jc-detail');
    if (!d) return;
    if (force === true) d.classList.add('on');
    else d.classList.toggle('on');
    var btn = document.getElementById('sgs-jc-detail-btn');
    if (btn) btn.textContent = d.classList.contains('on') ? '▴ 收起抓包详情' : '▾ 抓包详情';
  }

  function buildPanel() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    var p = document.createElement('div');
    p.id = PANEL_ID;
    p.innerHTML =
      '<div id="sgs-jc-head">' +
        '<div class="brand"><span class="dot"></span>三国杀精测 · 内嵌精测台</div>' +
        '<span class="status" id="sgs-jc-status">就绪</span>' +
        '<button class="btn" id="sgs-jc-detail-btn">▾ 抓包详情</button>' +
        '<button class="btn" id="sgs-jc-close">✕ 关闭</button>' +
      '</div>' +
      '<div id="sgs-jc-toolbar">' +
        '<button id="sgs-jc-oneclick">⚡ 一键导入本期活动</button>' +
        '<span class="hint">自动识别本期活动数据并导入，选将 / 计算在下方精测界面里完成</span>' +
      '</div>' +
      '<div id="sgs-jc-detail">' +
        '<div class="row">' +
          '<div id="sgs-jc-list"></div>' +
          '<button class="btn" id="sgs-jc-importtext">导入下方文本</button>' +
          '<button class="btn" id="sgs-jc-copy">复制文本</button>' +
          '<button class="btn" id="sgs-jc-dl">下载JSON</button>' +
          '<button class="btn" id="sgs-jc-clear">清空抓包</button>' +
        '</div>' +
        '<textarea id="sgs-jc-text" placeholder="抓到 JSON 后这里会填好转换后的公告文本，可直接改；也可手动粘贴公告 md 再点「导入下方文本」"></textarea>' +
        '<div id="sgs-jc-logs"></div>' +
      '</div>' +
      '<div id="sgs-jc-frame-wrap"><iframe id="sgs-jc-frame" sandbox="allow-scripts allow-same-origin"></iframe></div>';
    (document.body || document.documentElement).appendChild(p);
    panelBuilt = true;

    iframe = document.getElementById('sgs-jc-frame');
    iframe.srcdoc = EMBEDDED_HTML;

    document.getElementById('sgs-jc-oneclick').onclick = oneClickImport;
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
      captured = []; selected = -1; render(); setStatus('已清空抓包'); log('已清空抓包');
    };
    document.getElementById('sgs-jc-detail-btn').onclick = function () { openDetail(); };
    document.getElementById('sgs-jc-close').onclick = closePanel;

    render();
    log('就绪：精测程序已内嵌，等待抓包或手动粘贴公告');
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
  }

  GM_registerMenuCommand('三国杀精测：打开内嵌精测台', openPanel);

  function init() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildLauncher);
    else buildLauncher();
  }
  init();
})();
