/* ============================================================
   界面层
   ============================================================ */
(function () {
  const P = window.PRESET;
  const $ = (s) => document.querySelector(s);

  const state = {
    q: '', cat: '全部', way: '全部', selected: new Set(), lib: null,
    pin: {}, ctx: null, plan: null, daily: null, pendingImport: null,
    targets: null, tmap: null, rate: null, min: null,
  };

  /* 路线缓存：同一套参数下不重复计算 */
  const routeCache = new Map();
  let ctxKey = '';
  function getRoutes(t) {
    const k = ctxKey + '|' + t.name;
    if (!routeCache.has(k)) routeCache.set(k, E.routesFor(t, state.ctx));
    return routeCache.get(k);
  }
  function markCtx() {
    ctxKey = state.ctx.days + '|' + JSON.stringify(state.ctx.params);
    routeCache.clear();
  }

  /* 分类层数据：目标 × 四类路线 */
  function syncTargets() {
    state.targets = TARGETS.build(state.ctx, state.lib);
    state.tmap = new Map(state.targets.map((t) => [t.name, t]));
  }

  /* ---------- 数值格式 ---------- */
  const money = (yb) => {
    if (yb === null || yb === undefined || !isFinite(yb)) return '—';
    if (yb >= 10000) {
      const w = yb / 10000;
      return (w >= 100 ? w.toFixed(0) : w.toFixed(1)) + '万';
    }
    return E.fmt(yb);
  };
  const yuan = (yb) => {
    if (yb === null || yb === undefined || !isFinite(yb)) return '—';
    const r = state.ctx ? state.ctx.params.ratio : 100;
    const y = yb / r;
    if (!y) return '¥0';
    if (y >= 1000) return '¥' + Math.round(y).toLocaleString();
    return '¥' + (y < 100 ? y.toFixed(1).replace(/\.0$/, '') : y.toFixed(0));
  };
  const yi = (yb) => '≈' + yuan(yb);

  /* 链路压缩：同种道具的「需购买」并入前一段 */
  function chainShort(chain) {
    const out = [];
    (chain || []).forEach((c) => {
      if (c.cur === '元宝' || c.cur === '实付元宝') return;
      const last = out[out.length - 1];
      if (c.buy && last && last.cur === c.cur) { last.buy = c.qty; return; }
      out.push({ cur: c.cur, qty: c.qty, buy: c.buy ? c.qty : null });
    });
    return out.map((x) => `${E.fmt(x.qty)} ${x.cur}${x.buy != null ? `（买 ${E.fmt(x.buy)}）` : ''}`)
      .join(' → ');
  }

  /* ---------- 上下文 ---------- */
  function buildCtx() {
    const rate = Math.max(0.05, +$('#pKnot').value || 1);
    const params = {
      qifuExtraKnot: rate,
      ratio: Math.max(1, +$('#pRatio').value || 100),
    };
    return { days: Math.max(1, +$('#pDays').value || 9), params };
  }

  /* ---------- 目标卡片 ---------- */
  const CAT_ORDER = ['武将', '转盘皮肤', '锦绣皮肤', '直售皮肤', '动态水晶'];
  function cats() {
    const set = new Set();
    state.lib.forEach((t) => set.add(t.cat));
    const arr = CAT_ORDER.filter((c) => set.has(c));
    set.forEach((c) => { if (!arr.includes(c)) arr.push(c); });
    return ['全部', ...arr];
  }

  function renderCats() {
    const box = $('#cats');
    box.innerHTML = '';
    cats().forEach((c) => {
      const el = document.createElement('button');
      el.className = 'chip' + (state.cat === c ? ' on' : '');
      el.textContent = c;
      el.onclick = () => { state.cat = c; renderCats(); renderGrid(); };
      box.appendChild(el);
    });
  }

  /* ---------- 四类获取途径 chips ---------- */
  function renderWays() {
    const box = $('#ways');
    if (!box) return;
    box.innerHTML = '';
    const all = [{ key: '全部', name: '全部途径', color: 'var(--ink-3)' }].concat(
      TARGETS.CATS.map((c) => ({ key: c.key, name: c.name, color: c.color })));
    all.forEach((c) => {
      const el = document.createElement('button');
      el.className = 'chip w' + (state.way === c.key ? ' on' : '');
      el.innerHTML = `<i class="dot" style="background:${c.color}"></i>${c.name}`;
      el.title = c.key === '全部' ? '不按途径筛选' : (TARGETS.CAT[c.key] || {}).mid || '';
      el.onclick = () => { state.way = c.key; renderWays(); renderGrid(); };
      box.appendChild(el);
    });
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const arr = [];
    state.lib.forEach((t) => {
      if (state.cat !== '全部' && t.cat !== state.cat) return;
      if (q && !t.name.toLowerCase().includes(q)) return;
      if (state.way !== '全部') {
        const tg = state.tmap && state.tmap.get(t.name);
        if (!tg || !tg.wayKeys.includes(state.way)) return;
      }
      arr.push(t);
    });
    return arr;
  }

  function renderGrid() {
    const grid = $('#grid');
    grid.innerHTML = '';
    const list = filtered();
    if (!list.length) {
      grid.innerHTML = '<div class="empty">没有匹配的目标</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((t) => {
      const tg = state.tmap ? state.tmap.get(t.name) : null;
      const routes = tg ? tg.routes : [];
      const best = tg ? tg.best : null;
      const pinned = state.pin[t.name] && routes.find((r) => r.key === state.pin[t.name]);
      const shown = pinned || best;
      const el = document.createElement('div');
      el.className = 'card' + (state.selected.has(t.name) ? ' on' : '') + (pinned ? ' pinned' : '');
      el.dataset.name = t.name;
      if (!shown) {
        el.innerHTML = `<div class="nm">${t.name}</div><div class="cat">${t.cat}</div>
          <div class="price" style="color:var(--ink-3);font-size:11.5px">本期无确定途径</div>`;
      } else {
        const cc = TARGETS.CAT[shown.cat];
        const basisTxt = shown.basis === 'exact' ? '确定' : shown.basis === 'avg' ? '均值' : '概率';
        const short = shown.raw ? chainShort(shown.raw.chain) : '单买 · 不限购 · 不赌掉落';
        const cur = short ? `<div class="cur">${short}</div>` : '';
        const alts = routes.filter((r) => r !== shown && (r.cat !== shown.cat || r.manual)).slice(0, 3);
        const altTxt = alts.length
          ? `<div class="alts">${alts.map((r) => (r.manual
            ? `<span class="sgl">单买 ${E.fmt(r.qty)} ${r.cur} · 券前 ${yuan(r.yb)}</span>`
            : `<b>${TARGETS.CAT[r.cat].name}</b> ${E.fmt(r.qty)} ${r.cur} · 券前 ${yuan(r.yb)}`)).join('　')}</div>`
          : '';
        el.innerHTML = `
          <div class="mark" style="background:${cc.color}"></div>
          <div class="nm">${t.name}</div>
          <div class="cat"><span class="wdot" style="background:${cc.color}"></span>${cc.name} · ${t.cat} · ${basisTxt}</div>
          ${cur}
          <div class="price">${money(shown.yb)}<small> 元宝</small></div>
          <div class="way">${shown.note || shown.label}</div>
          ${altTxt}
          ${routes.length > 1 ? '<button class="cmp" title="查看全部路径">路线 ' + routes.length + '</button>' : ''}
          ${t.cat === '动态水晶' ? '<div class="flag">需静态</div>' : ''}`;
        const cmp = el.querySelector('.cmp');
        if (cmp) cmp.onclick = (ev) => { ev.stopPropagation(); openRoutes(t.name); };
      }
      el.onclick = () => toggle(t.name);
      frag.appendChild(el);
    });
    grid.appendChild(frag);
  }

  /* ---------- 本地保存 / 恢复 ---------- */
  const LS_KEY = 'jgs_data_v1';
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(P)); } catch (e) { /* file:// 下可能不可用 */ }
  }
  function hasLocal() {
    try { return !!localStorage.getItem(LS_KEY); } catch (e) { return false; }
  }
  function restoreLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      Object.keys(d).forEach((k) => { P[k] = d[k]; });
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 数据摘要 ---------- */
  function renderSummary() {
    const box = $('#dataSummary');
    if (!box) return;
    const boxes = P.systems.filter((s) => s.kind === 'box').length;
    const tubes = P.systems.filter((s) => s.kind === 'tube').length;
    const shops = P.shops.reduce((a, s) => a + s.items.length, 0);
    const imported = !!P.meta.imported;
    box.innerHTML = `
      <div>系统：<b>${P.systems.length}</b> 个（礼盒 ${boxes} · 签筒 ${tubes}）</div>
      <div>可兑换：<b>${shops}</b> 项</div>
      <div>可获取目标：<b>${state.lib.size}</b> 个</div>
      <div>充值档位：<b>${P.chargeTiers.length}</b> 档</div>
      <div style="margin-top:6px">数据来源：<b>${imported ? '导入' : '内置'}</b>${imported ? ' <a href="#" id="btnResetData" style="color:var(--accent)">恢复内置</a>' : ''}</div>`;
    const btn = document.getElementById('btnResetData');
    if (btn) btn.onclick = (e) => {
      e.preventDefault();
      try { localStorage.removeItem(LS_KEY); } catch (err) {}
      location.reload();
    };
  }

  /* ---------- 路线对比 ---------- */
  function openRoutes(name) {
    const t = state.lib.get(name);
    if (!t) return;
    const rs = getRoutes(t);
    const usable = rs.filter((r) => !r.hidden);
    const bestEv = usable.length ? usable[0].costEv.yb : Infinity;
    $('#routeTitle').textContent = name + ' · 获取路径';
    const rowHtml = (r) => {
      const isPin = state.pin[name] === r.key;
      const basis = r.basis === 'exact' ? '<span class="tag-ok">确定</span>'
        : r.basis === 'avg' ? '<span class="tag-avg">均值</span>' : '<span class="tag-bad">概率</span>';
      const cc = TARGETS.CAT[TARGETS.catOf(r)];
      const badge = `<span class="tagline gray" style="border-color:${cc.color}33;background:${cc.soft};color:${cc.color}">${cc.name}</span> `;
      if (r.hidden) {
        return `<tr class="dim">
          <td>${badge}${r.label}<div class="sub">${r.note}</div></td>
          <td class="num">${E.fmt(r.curQty)}</td><td class="num">—</td><td class="num">—</td>
          <td>${basis}</td><td>不可精测</td><td></td>
        </tr>`;
      }
      return `<tr class="${isPin ? 'chosen' : ''}">
        <td>${badge}${r.label}<div class="sub">${r.note || ''}</div></td>
        <td class="num">${E.fmt(r.curQty)} <span class="sub">${r.curName}</span></td>
        <td class="num">${r.buyQty != null ? E.fmt(r.buyQty) : '—'}</td>
        <td class="num ${r.costEv.yb === bestEv ? 'cheap' : ''}">${E.fmt(r.costEv.yb)}</td>
        <td class="num">${yuan(r.costEv.yb)}</td>
        <td>${basis}</td>
        <td><button class="use" data-key="${r.key}">${isPin ? '已采用' : '采用'}</button></td>
      </tr>`;
    };
    const rows = usable.map(rowHtml).join('') + rs.filter((r) => r.hidden).map(rowHtml).join('');
    /* 单买兜底也列进来：价格固定、不限购，但不参与自动排程 */
    const cls = (state.targets || []).find((x) => x.name === name);
    const manuals = cls ? cls.routes.filter((r) => r.manual) : [];
    const manRows = manuals.map((r) => {
      const cc = TARGETS.CAT[r.cat];
      return `<tr class="dim">
        <td><span class="tagline gray" style="border-color:${cc.color}33;background:${cc.soft};color:${cc.color}">${cc.name}</span> ${r.label}
          <div class="sub">不凑礼包、不限购；价格固定，随时可买</div></td>
        <td class="num">${E.fmt(r.qty)} <span class="sub">${r.cur}</span></td>
        <td class="num">${E.fmt(r.qty)}</td>
        <td class="num">${E.fmt(r.yb)}</td>
        <td class="num">${yuan(r.yb)}</td>
        <td><span class="tag-ok">确定</span></td>
        <td><span class="sub" style="font-size:10px;color:var(--ink-3)">兜底</span></td>
      </tr>`;
    }).join('');
    $('#routeBody').innerHTML = `<table>
      <thead><tr><th>怎么拿</th><th class="num">需要道具</th><th class="num">需购买</th><th class="num">元宝</th><th class="num">≈元</th><th>口径</th><th></th></tr></thead>
      <tbody>${rows}${manRows}</tbody></table>
      <p class="hint">「需购买」= 需求道具数 − 活动白送数。灰行为纯概率路线，成本无法锁定，仅供参考，不进入方案；「单买」是无条件兜底价，不参与自动排程。</p>
      <button class="btn ghost sm" id="btnUnpin">恢复自动最优</button>`;
    $('#routeBody').querySelectorAll('.use').forEach((b) => {
      b.onclick = () => {
        state.pin[name] = b.dataset.key;
        renderGrid(); renderPlan(); openRoutes(name);
      };
    });
    $('#btnUnpin').onclick = () => {
      delete state.pin[name];
      renderGrid(); renderPlan(); openRoutes(name);
    };
    $('#routeModal').classList.add('on');
  }

  function toggle(name) {
    if (state.selected.has(name)) state.selected.delete(name);
    else state.selected.add(name);
    renderGrid();
    renderSelected();
    renderPlan();
  }

  function renderSelected() {
    const bar = $('#selectedBar');
    bar.innerHTML = '';
    [...state.selected].forEach((name) => {
      const el = document.createElement('div');
      el.className = 'sel-tag';
      el.innerHTML = `<b>${name}</b><span title="移除">×</span>`;
      el.querySelector('span').onclick = () => toggle(name);
      bar.appendChild(el);
    });
  }

  /* ---------- 每日方案 ---------- */
  const CN = { 盒: '礼盒', 祈福灯: '祈福灯', 纳贤令: '纳贤令', 锦绣: '锦绣', 狂欢夺宝券: '夺宝券', 狂欢水晶球: '水晶球',
    券1111: '抵价券1111', 券2888: '抵价券2888', 券6665: '抵价券6665', 绑定元宝: '绑定元宝' };
  const COUPON_NAME = { 券1111: '抵价券1111', 券2888: '抵价券2888', 券6665: '抵价券6665' };

  function readStock() {
    const g = (id) => { const el = document.querySelector(id); return el ? Math.max(0, +el.value || 0) : 0; };
    return {
      yb: g('#sYb'),
      items: { 宝玉: g('#sJade'), 祈福灯: g('#sLamp'), 纳贤令: g('#sNana') },
      coupons: { 券1111: g('#sC1'), 券2888: g('#sC2'), 券6665: g('#sC3') },
    };
  }

  function dateOf(i) {
    const d = new Date(P.meta.start.replace(/-/g, '/') + ' 00:00:00');
    d.setDate(d.getDate() + i);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function groupPacks(packs) {
    const m = new Map();
    (packs || []).forEach((p) => {
      if (p.coupon || p.price <= 0) return;
      m.set(p.name, (m.get(p.name) || 0) + 1);
    });
    return [...m].map(([n, c]) => (c > 1 ? `${n}×${c}` : n));
  }

  function rewardText(t) {
    return Object.keys(t || {}).map((k) => `${COUPON_NAME[k] || CN[k] || k}×${E.fmt(t[k])}`).join(' · ');
  }

  function renderPlan() {
    const names = [...state.selected];
    const sub = $('#planSub');
    if (!names.length) {
      $('#totals').innerHTML = '';
      $('#dayList').innerHTML = '<div class="empty" style="padding:26px 0">在左侧点选想要的武将 / 皮肤</div>';
      $('#auditBox').innerHTML = '';
      $('#outputBox').innerHTML = '';
      sub.textContent = '选择目标后自动生成';
      state.daily = null;
      renderSplit([]);
      return;
    }
    const r = SCHED.build(names, { days: state.ctx.days, stock: readStock() });
    state.daily = r;

    const left = r.charge.yb - r.netSpend;
    sub.textContent = `${names.length} 个目标 · ` + r.audit.map((a) => a.label + ' ' + E.fmt(a.need)).join(' / ');

    $('#totals').innerHTML = `
      <div class="tot hl">
        <div class="k">需要充值</div>
        <div class="v">¥${E.fmt(r.money)}</div>
        <div class="k" style="margin-top:2px">到账 ${E.fmt(r.charge.yb)} 元宝</div>
      </div>
      <div class="tot">
        <div class="k">实付元宝</div>
        <div class="v">${money(r.netSpend)}</div>
        <div class="k" style="margin-top:2px">券抵 ${E.fmt(r.couponSave)}${left > 1 ? ` · 余 ${money(left)}` : ''}</div>
      </div>`;

    renderSplit(names);
    renderOutput(r, names);

    const rows = SCHED.rows(r);
    const list = $('#dayList');
    list.innerHTML = '';
    let any = false;
    rows.forEach((row) => {
      if (!row.packs.length && !row.charges.length) return;
      any = true;
      const el = document.createElement('div');
      el.className = 'day';
      const chg = row.charges.length ? row.charges.map((c) => `<b>¥${E.fmt(c.money)}</b>`).join(' + ') : '';
      const pk = groupPacks(row.packs);
      const rw = rewardText(row.tier);
      const disc = row.gross - row.spend;
      el.innerHTML = `
        <div class="dh">
          <span class="dt">${dateOf(row.i)}</span>
          ${chg ? `<span class="dchg">充值 ${chg}</span>` : ''}
          <span class="dsp">消费 <b>${E.fmt(row.spend)}</b></span>
        </div>
        <div class="dp">${pk.length ? pk.join('　·　') : '—'}</div>
        ${disc > 1 ? `<div class="ddisc">抵价券 −${E.fmt(disc)}</div>` : ''}
        ${rw ? `<div class="drw">领 ${rw}</div>` : ''}`;
      list.appendChild(el);
    });
    if (!any) list.innerHTML = '<div class="empty" style="padding:20px 0">本期白送的就够了，不用消费</div>';

    const aud = r.audit.map((a) => `<tr>
        <td>${a.label}</td>
        <td class="num">${E.fmt(a.need)}</td>
        <td class="num">${a.stock ? E.fmt(a.stock) : '—'}</td>
        <td class="num">${a.free ? E.fmt(a.free) : '—'}</td>
        <td class="num">${a.tier ? E.fmt(a.tier) : '—'}</td>
        <td class="num">${E.fmt(a.buy)}</td>
        <td class="num ${a.total >= a.need ? 'ok' : 'bad'}">${E.fmt(a.total)}</td>
      </tr>`).join('');
    $('#auditBox').innerHTML = `
      <h3>核对</h3>
      <table class="mini-table">
        <thead><tr><th>道具</th><th class="num">需要</th><th class="num">期初</th><th class="num">白送</th><th class="num">档位</th><th class="num">要买</th><th class="num">合计</th></tr></thead>
        <tbody>${aud}</tbody>
      </table>
      ${r.audit.some((a) => a.stock) ? `<p class="hint">期初存货已抵扣：${r.audit.filter((a) => a.stock).map((a) => `${a.label} ${E.fmt(a.stock)}`).join(' · ')}</p>` : ''}
      ${r.extras.length ? `<p class="hint">顺带拿到：${r.extras.map((x) => `${x.label}×${E.fmt(x.qty)}`).join(' · ')}</p>` : ''}`;
  }

  /* ---------- 右栏：分途径汇总（四类） ---------- */
  function renderSplit(names) {
    const box = $('#splitBox');
    if (!box) return;
    if (!state.targets) { box.innerHTML = ''; return; }
    const s = TARGETS.summary(names || [], state.targets);
    const head = s.mode === 'sel'
      ? `券前 · ${names.length} 个目标`
      : '券前 · 全库主力路线';
    const body = s.rows.map((r) => {
      const cls = (r.n ? '' : 'dim') + (r.star ? ' on' : '');
      return `<tr class="${cls}">
        <td><span class="cn"><i style="background:${r.color}"></i>${r.name}</span>${r.star ? '<span class="star">★</span>' : ''}</td>
        <td>${r.n ? r.midText : '—'}</td>
        <td>${r.n ? money(r.yb) : '—'}</td>
        <td>${r.n ? yuan(r.yb) : '—'}</td>
        <td class="nt" title="${r.full || ''}">${r.note}</td>
      </tr>`;
    }).join('');
    const footRow = s.rows.filter((r) => r.singleText)
      .map((r) => `${r.name} ${r.singleText}`).join(' ｜ ');
    box.innerHTML = `
      <h3>分途径汇总 <span>${head}</span></h3>
      <table>
        <thead><tr><th>分类</th><th>需中间道具</th><th>券前元宝</th><th>折人民币</th><th class="nt">最省</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${footRow ? `<div class="split-foot" title="不限购、不用凑礼包、不赌掉落">单买兜底：${footRow}</div>` : ''}`;
  }

  /* ---------- 右栏：过程产出（券流水 / 条件奖励 / 免费到手） ---------- */
  const STATE_TXT = SCHED.STATE_TXT;
  const CPN_LBL = { 券6665: '6665券', 券2888: '2888券', 券1111: '1111券' };

  function renderOutput(r, names) {
    const box = $('#outputBox');
    if (!box) return;
    const stock = readStock();
    const led = SCHED.ledger(r, stock);
    const cond = SCHED.condRows(r, names);
    const frees = SCHED.freeRows(names);

    /* 2.1 抵价券流水 */
    const cpnRows = led.rows.map((x) => `<tr class="${x.got ? '' : 'dim'}">
      <td class="cpn-name" title="满 ${E.fmt(x.min)} 减 ${E.fmt(x.face)}">${CPN_LBL[x.key] || x.key}</td>
      <td>${x.got || 0}</td>
      <td>${x.used || 0}</td>
      <td class="${x.left ? 'bad' : ''}">${x.left || 0}</td>
    </tr>`).join('');

    /* 2.2 条件奖励（按组领起） */
    let lastG = '';
    const condRows = cond.map((x) => {
      const g = x.group !== lastG ? `<tr><td colspan="2" style="border:0;padding-top:7px;font-size:9.6px;color:var(--ink-3);letter-spacing:.4px">${x.group}</td></tr>` : '';
      lastG = x.group;
      return g + `<tr class="${x.state === 'off' ? 'dim' : ''}" title="${x.note}">
        <td>${x.cond}<div style="font-size:9.4px;color:var(--ink-3);white-space:normal">${x.reward}</div></td>
        <td style="text-align:right;vertical-align:top"><span class="st ${x.state}">${STATE_TXT[x.state]}</span></td>
      </tr>`;
    }).join('');

    /* 2.3 免费到手 */
    const freeChips = frees.map((x) => `<span class="${x.on ? '' : 'off'}" title="${x.from}">${x.cur}×${E.fmt(x.qty)}</span>`).join('');

    /* 2.4 结余券的去处：默认单买灯 / 玉，不再算沉没 */
    const lf = SCHED.leftoverPlan(led);
    const sunk = led.left > 0
      ? `<div class="out-note">结余 <b>${led.left}</b> 张券默认拿去单买：换 <b>${lf.lamps}</b> 盏祈福灯（券面抵 ${E.fmt(lf.face)}，实付 <b>${E.fmt(lf.pay)}</b> 元宝，按 1,000/盏折 <b>${E.fmt(lf.value)}</b> 元宝）${lf.jadeQty ? `；改买玉则换 ${lf.jadeQty} 玉、实付 ${E.fmt(lf.jadePay)}` : ''}。券不是沉没额度。</div>`
      : `<div class="out-note">券刚好用完，没有结余。</div>`;

    box.innerHTML = `
      <h3>过程产出 <em>消费过程中拿到的东西，不是白送的</em></h3>
      <div class="cpn-line">
        <div><div class="k">获得</div><div class="v">${led.got} 张</div></div>
        <div><div class="k">用掉</div><div class="v">${led.used} 张</div></div>
        <div><div class="k">结余</div><div class="v ${led.left ? 'warn' : ''}">${led.left} 张</div></div>
      </div>
      <h4>抵价券流水（一次购买只能用一张）</h4>
      <table class="out-table cpn">
        <thead><tr><th>券种 / 门槛</th><th>获得</th><th>用掉</th><th>结余</th></tr></thead>
        <tbody>${cpnRows}</tbody>
      </table>
      ${sunk}
      <h4>条件奖励（达标才给，和「买」解耦）</h4>
      <table class="out-table cond">
        <thead><tr><th>条件 / 奖励</th><th style="text-align:right">状态</th></tr></thead>
        <tbody>${condRows}</tbody>
      </table>
      <h4>免费到手（登录 / 任务白送，不进上面的账）</h4>
      <div class="free-chips">${freeChips}</div>`;
  }

  /* ---------- 每日方案表（大表） ---------- */
  function renderDayTable() {
    const r = state.daily;
    if (!r) return;
    const rows = SCHED.rows(r);
    const body = rows.map((row) => {
      const chg = row.charges.length ? row.charges.map((c) => `¥${E.fmt(c.money)}`).join(' + ') : '—';
      const flag = row.spend > 0 && !row.packs.length ? '' : '';
      return `<tr>
        <td>${dateOf(row.i)}</td>
        <td class="num">${chg}</td>
        <td class="num">${E.fmt(row.spend)}</td>
        <td>${groupPacks(row.packs).join('　·　') || '—'}</td>
        <td>${rewardText(row.tier) || '—'}</td>
      </tr>`;
    }).join('');

    const aud = r.audit.map((a) => `<tr>
        <td>${a.label}</td>
        <td class="num">${E.fmt(a.need)}</td>
        <td class="num">${a.stock ? E.fmt(a.stock) : '—'}</td>
        <td class="num">${a.free ? E.fmt(a.free) : '—'}</td>
        <td class="num">${a.tier ? E.fmt(a.tier) : '—'}</td>
        <td class="num">${E.fmt(a.buy)}</td>
        <td class="num ${a.total >= a.need ? 'ok' : 'bad'}">${E.fmt(a.total)}</td>
      </tr>`).join('');

    const chgList = r.charge.picks.map((p) => `${p.t.need / 100}元×${p.n}${p.crystal ? '(水晶球档)' : p.alt ? '(双倍箱)' : ''}`).join(' + ');

    $('#dayTitle').textContent = `每日消费方案 · ${[...state.selected].join(' + ')}`;
    $('#dayBody').innerHTML = `
      <table class="plan-table">
        <thead><tr><th>日期</th><th class="num">充值</th><th class="num">当日消费</th><th>买到什么</th><th>当天领奖</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="audit-block">
        <h3>核对</h3>
        <table class="plan-table">
          <thead><tr><th>道具</th><th class="num">需要</th><th class="num">期初</th><th class="num">白送</th><th class="num">档位返</th><th class="num">要买</th><th class="num">合计</th></tr></thead>
          <tbody>${aud}</tbody>
        </table>
      </div>
      <p class="sumline">充值 <b>¥${E.fmt(r.money)}</b>（${chgList}）· 到账 <b>${E.fmt(r.charge.yb)}</b> 元宝 · 实付 <b>${E.fmt(r.netSpend)}</b> · 抵价券省 <b>${E.fmt(r.couponSave)}</b>${r.charge.yb - r.netSpend > 1 ? ` · 余 <b>${E.fmt(r.charge.yb - r.netSpend)}</b>` : ''}</p>
      ${r.extras.length ? `<p class="hint">顺带拿到：${r.extras.map((x) => `${x.label}×${E.fmt(x.qty)}`).join(' · ')}</p>` : ''}`;
  }

  /* ---------- 全部精测表 ---------- */
  function renderAllTable() {
    const rows = [];
    state.lib.forEach((t) => {
      const rs = getRoutes(t).filter((r) => !r.hidden);
      if (!rs.length) return;
      rows.push({ t, b: rs[0], routes: rs });
    });
    rows.sort((a, b) => {
      const fa = a.b.costEv.yb === 0 ? 1 : 0, fb = b.b.costEv.yb === 0 ? 1 : 0;
      return fa - fb || a.b.costEv.yb - b.b.costEv.yb;
    });
    const html = rows.map(({ t, b }) => {
      const basis = b.basis === 'exact' ? '确定' : b.basis === 'avg' ? '均值' : '概率';
      return `<tr data-name="${t.name}">
        <td>${t.name}</td>
        <td>${t.cat}</td>
        <td>${b.curQty ? E.fmt(b.curQty) + ' ' + b.curName : '—'}</td>
        <td class="num">${b.buyQty != null && b.freeQty ? E.fmt(b.buyQty) : '—'}</td>
        <td class="num">${E.fmt(b.costEv.yb)}</td>
        <td class="num">${yuan(b.costEv.yb)}</td>
        <td>${basis}</td>
      </tr>`;
    }).join('');
    $('#allBody').innerHTML = `<table>
      <thead><tr><th>目标</th><th>类型</th><th>需要道具</th><th class="num">需购买</th><th class="num">元宝</th><th class="num">≈元</th><th>口径</th></tr></thead>
      <tbody>${html}</tbody></table>`;
    $('#allBody').querySelectorAll('tbody tr').forEach((tr) => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => { toggle(tr.dataset.name); };
    });
  }

  /* ---------- 充值倍率表 ---------- */
  function renderRates() {
    const days = state.ctx.days;
    state.comboSel = state.comboSel || {};
    const tiers = RATES.tierList(days).slice().sort((a, b) => a.need - b.need);
    const maxRatio = Math.max(...tiers.map((t) => t.ratio));
    const body = tiers.map((t) => {
      const reb = t.reb.length
        ? t.reb.map((x) => `${CN[x.k] || x.k}×${E.fmt(x.q)}`).join(' + ')
        : '<span style="color:var(--ink-3)">无</span>';
      const ybCell = t.altBind
        ? `${E.fmt(t.need)} <span class="sub">+绑元 ${E.fmt(t.altBind)}</span>`
        : E.fmt(t.yb);
      const w = Math.max(3, Math.round((t.ratio / maxRatio) * 46));
      const on = !!state.comboSel[t.i];
      return `<tr class="${on ? 'picked' : ''}">
        <td class="ckcell"><input type="checkbox" class="ckT" data-i="${t.i}" data-need="${t.need}" ${on ? 'checked' : ''}></td>
        <td><b>¥${E.fmt(t.rmb)}</b><div class="sub" style="font-size:9.4px">${t.tag}</div></td>
        <td class="num">${ybCell}</td>
        <td>${reb}</td>
        <td class="num">${E.fmt(Math.round(t.rebVal))}</td>
        <td class="num"><b>${E.fmt(Math.round(t.total))}</b></td>
        <td class="num"><span class="cheap">${t.ratio.toFixed(2)}×</span> <span class="bar" style="width:${w}px"></span></td>
        <td class="num">${t.cap}</td>
        <td><span class="sub">${t.cond}</span></td>
      </tr>`;
    }).join('');

    const rankRows = RATES.rank(days).map((t) => `<div class="combo-row">
      <span class="rtag ${t.place === 1 ? 'a' : t.place <= 3 ? 'g' : ''}">${t.place}</span>
      <b>¥${E.fmt(t.rmb)}</b>
      <span class="sub">到账 ${E.fmt(t.yb)} · 返利 ${E.fmt(Math.round(t.rebVal))}</span>
      <span style="margin-left:auto"><b>${t.ratio.toFixed(2)}×</b>${t.badge ? ` <span class="tagline ${t.place === 1 ? '' : 'gold'}">${t.badge}</span>` : ''}</span>
    </div>`).join('');

    const foot = RATES.NOTE.map((n) => `<div>· ${n}</div>`).join('');

    const quick = (size) => RATES.bestCombos(days, size, size === 2 ? 4 : 3).map((r) =>
      `<button class="qcombo" data-picks="${r.ikey}">${r.picks.map((p) => `¥${E.fmt(p.tier.rmb)}<i>${p.tier.tag}</i>`).join('+')}<b>${r.ratio.toFixed(2)}×</b></button>`
    ).join('');

    $('#rateBody').innerHTML = `
      <table>
        <thead><tr>
          <th class="ckcell">选</th>
          <th>档位(元)</th><th class="num">元宝(到账)</th><th>返利道具</th><th class="num">返利折算</th>
          <th class="num">合计价值</th><th class="num">倍率</th><th class="num">可买次数</th><th>触发条件</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="rate-foot">${foot}</div>

      <div class="rate-sec">
        <h3>组合倍率 <em>勾几档一起充，算整体倍率（¥12 + ¥6 这种）</em></h3>
        <div id="comboOut"></div>
        <div class="quickline"><span>双档最快</span>${quick(2)}</div>
        <div class="quickline"><span>三档最快</span>${quick(3)}</div>
      </div>

      <div class="rate-sec">
        <h3>性价比排行 <em>单档倍率从高到低；「首充档」只买一次，「每日必买档」每天一次</em></h3>
        ${rankRows}
      </div>

      <div class="rate-sec">
        <h3>凑额推荐 <em>给定要花掉的量，DP 求最少人民币（328 / 648 已按 11/8 重置算 0~2 次）</em></h3>
        <div class="min-form" style="border:0;padding-bottom:8px">
          <label style="font-size:11.5px;color:var(--ink-2)">我要花掉</label>
          <input type="number" id="dpX" min="1" step="1000" value="300000">
          <select id="dpUnit"><option value="yb">元宝</option><option value="rmb">人民币(元)</option></select>
          <button class="btn sm" id="btnDp">算组合</button>
          <span class="hintline">按到账元宝覆盖目标；双倍箱一律按绑元计（保证「能花」，不折水晶球）。</span>
        </div>
        <div id="dpOut"></div>
      </div>`;

    $('#btnDp').onclick = () => renderDp();
    $('#dpX').onkeydown = (e) => { if (e.key === 'Enter') renderDp(); };
    $('#rateBody').querySelectorAll('.ckT').forEach((el) => {
      el.onchange = () => {
        const i = +el.dataset.i;
        if (el.checked) state.comboSel[i] = 1; else delete state.comboSel[i];
        syncComboRows();
        renderCombo();
      };
    });
    $('#rateBody').querySelectorAll('.qcombo').forEach((el) => {
      el.onclick = () => {
        state.comboSel = {};
        el.dataset.picks.split('+').forEach((s) => {
          const [i, n] = s.split('x').map(Number);
          if (i != null) state.comboSel[i] = n || 1;
        });
        syncComboRows();
        renderCombo();
      };
    });
    renderDp();
    renderCombo();
  }

  function syncComboRows() {
    const body = $('#rateBody');
    if (!body) return;
    body.querySelectorAll('.ckT').forEach((el) => {
      const on = !!state.comboSel[+el.dataset.i];
      el.checked = on;
      const tr = el.closest('tr');
      if (tr) tr.classList.toggle('picked', on);
    });
  }

  function renderCombo() {
    const out = document.getElementById('comboOut');
    if (!out) return;
    const days = state.ctx.days;
    const list = Object.keys(state.comboSel || {}).map((k) => ({ i: +k, n: state.comboSel[k] }));
    const r = RATES.combo(list, days);
    if (!r.picks.length) {
      out.innerHTML = '<div class="hintline">在上面表格勾档位（可多选），或点下面的快捷组合。组合倍率 = 合计价值 ÷ 本金，是各档按本金加权后的平均。</div>';
      return;
    }
    const rows = r.picks.map((p) => `<span class="combopick">¥${E.fmt(p.tier.rmb)}<s>${p.tier.tag}</s><i>×${p.n}</i><em>${p.tier.ratio.toFixed(2)}×</em></span>`).join('<span class="plus">+</span>');
    const hi = r.picks.reduce((a, p) => (p.tier.ratio > a.tier.ratio ? p : a), r.picks[0]);
    const lo = r.picks.reduce((a, p) => (p.tier.ratio < a.tier.ratio ? p : a), r.picks[0]);
    const drag = r.picks.length > 1 && lo.tier.need !== hi.tier.need;
    out.innerHTML = `
      <div class="combo-line">${rows}
        <button class="btn sm ghost" id="comboClear" style="margin-left:auto">清空</button>
      </div>
      <div class="combo-sum">
        <div><span class="k">本金</span><b>¥${E.fmt(r.money)}</b></div>
        <div><span class="k">到账元宝</span><b>${E.fmt(r.yb)}</b></div>
        <div><span class="k">返利折算</span><b>${E.fmt(Math.round(r.rebVal))}</b></div>
        <div><span class="k">合计价值</span><b>${E.fmt(Math.round(r.total))}</b></div>
        <div class="big"><span class="k">组合倍率</span><b>${r.ratio.toFixed(2)}×</b></div>
        <div><span class="k">笔数</span><b>${r.count}</b></div>
      </div>
      <div class="out-note" style="margin-top:6px">${r.picks.length > 1
        ? `组合是本金加权平均：最高 ¥${E.fmt(hi.tier.rmb)} ${hi.tier.ratio.toFixed(2)}×、最低 ¥${E.fmt(lo.tier.rmb)} ${lo.tier.ratio.toFixed(2)}×${drag ? '，低倍率那档会把整体拉下来' : ''}。`
        : '单档倍率（= 表格里的倍率）。再勾一档就能看组合。'}${r.capped ? ' 有档位超过可买次数，已按上限截断。' : ''}</div>`;
    const clr = document.getElementById('comboClear');
    if (clr) clr.onclick = () => { state.comboSel = {}; syncComboRows(); renderCombo(); };
  }

  function renderDp() {
    const out = document.getElementById('dpOut');
    if (!out) return;
    const unit = document.getElementById('dpUnit').value;
    let x = Math.max(1, +document.getElementById('dpX').value || 0);
    if (unit === 'rmb') x *= 100;
    const list = RATES.recommend(x, state.ctx.days);
    if (!list.length) { out.innerHTML = '<div class="warnbar">超出本期档位上限（全部买满也不够），请调小目标。</div>'; return; }
    out.innerHTML = list.map((r) => {
      const tagCls = r.tag === '最省' ? 'a' : r.tag === '笔数最少' ? 'g' : '';
      const picks = r.picks.map((p) => `¥${E.fmt(p.tier.rmb)}×${p.n}`).join(' + ');
      return `<div class="combo-row">
        <span class="rtag ${tagCls}">${r.tag}</span>
        <div>
          <div><b>¥${E.fmt(r.money)}</b>　<span class="sub">到账 ${E.fmt(r.yb)} 元宝（多 ${E.fmt(r.over)}）· ${r.count} 笔 · 返利折 ${E.fmt(Math.round(r.rebate))}</span></div>
          <div class="sub" style="margin-top:2px">${picks}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- 最低消费反查 ---------- */
  function fillMinSelect() {
    const sel = document.getElementById('minItem');
    if (!sel) return;
    const groups = {};
    (state.targets || []).forEach((t) => {
      if (!t.best) return;
      (groups[t.cat] = groups[t.cat] || []).push(t.name);
    });
    const order = ['武将', '转盘皮肤', '锦绣皮肤', '直售皮肤', '动态水晶', '道具'];
    const keys = order.filter((k) => groups[k]).concat(Object.keys(groups).filter((k) => !order.includes(k)));
    let html = '';
    keys.forEach((k) => {
      const names = groups[k].slice().sort((a, b) => a.localeCompare(b, 'zh'));
      html += `<optgroup label="${k}（${names.length}）">` + names.map((n) => `<option>${n}</option>`).join('') + '</optgroup>';
    });
    sel.innerHTML = html;
    const def = [...sel.options].find((o) => o.value === '威曹彰');
    if (def) sel.value = '威曹彰';
  }

  function renderMin() {
    const r = MINCOST.search(
      document.getElementById('minItem').value,
      Math.max(1, +document.getElementById('minQty').value || 1),
      state.ctx, { stock: readStock() });
    const box = document.getElementById('minResults');
    if (r.err) { box.innerHTML = `<div class="warnbar">${r.err}</div>`; return; }

    const cards = r.rows.map((x, i) => {
      const cls = x.tag === '最省' ? 'best' : '';
      const tg = x.tag === '最省' ? '' : x.tag.indexOf('省心') === 0 ? 'g' : 'k';
      return `<div class="min-card ${cls}">
        <div class="hd">
          <span class="mtag ${tg}">${x.tag}</span>
          <span class="sub">分 ${x.act} 天 · ${x.charges} 笔充值</span>
          <span class="money">¥${E.fmt(x.money)}<small>到账 ${E.fmt(x.yb)}</small></span>
        </div>
        <div class="kv">
          <i>买什么</i><b>${x.buyText}</b>
          <i>充值</i><b>${x.chgText}</b>
          <i>分几天</i><b>${x.act} 天</b>
          <i>用掉券</i><b>${x.couponText}${x.couponSave ? `（省 ${E.fmt(x.couponSave)}）` : ''}</b>
          <i>达标领了</i><b>${x.tierText}</b>
          <i>剩余</i><b>${E.fmt(x.rest)} 元宝</b>
        </div>
        <div class="why">${x.why}${x.ok ? '' : ' · ⚠ 核对未平（有道具是充值/兑换直接到手，不走消费）'}</div>
      </div>`;
    }).join('');

    box.innerHTML = cards + `
      <div class="min-meta">
        券前基准 ${E.fmt(r.baseYb)} 元宝（${yuan(r.baseYb)}，走「${r.routeLabel}」）·
        下界 ${yuan(r.lb * 100)}（券面池 ${E.fmt(r.pool)} 元宝）·
        候选 ${r.cands} 组 / 剪掉 ${r.pruned} 组（到账不足或超过当前最优）·
        档位枚举含 328/648 各 0~2 次（11/8 重置）
      </div>`;
  }

  /* ---------- 复制 ---------- */
  function copyPlan() {
    const r = state.daily;
    if (!r) return;
    const rows = SCHED.rows(r);
    const L = [
      `【${P.meta.title}】每日消费方案`,
      `目标：${[...state.selected].join('、')}`,
      `需要道具：${r.audit.map((a) => a.label + ' ' + E.fmt(a.need)).join('，')}`,
      '',
    ];
    rows.forEach((row) => {
      if (!row.packs.length && !row.charges.length) return;
      const chg = row.charges.map((c) => `${E.fmt(c.money)}元`).join('+');
      L.push(`${dateOf(row.i)}　充值 ${chg || '—'}　消费 ${E.fmt(row.spend)}`);
      L.push(`  买：${groupPacks(row.packs).join('、') || '—'}`);
      const rw = rewardText(row.tier);
      if (rw) L.push(`  领：${rw}`);
    });
    L.push('');
    L.push(`合计：充值 ¥${E.fmt(r.money)}，到账 ${E.fmt(r.charge.yb)} 元宝，实付 ${E.fmt(r.netSpend)}，抵价券省 ${E.fmt(r.couponSave)}`);
    L.push('');
    L.push('核对：');
    r.audit.forEach((a) => L.push(`  ${a.label}：需要 ${E.fmt(a.need)}，白送 ${E.fmt(a.free)}，档位 ${E.fmt(a.tier)}，买 ${E.fmt(a.buy)}`));
    navigator.clipboard.writeText(L.join('\n')).then(() => {
      const b = $('#btnCopy');
      const t = b.textContent; b.textContent = '已复制';
      setTimeout(() => (b.textContent = t), 1200);
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    $('#eventMeta').textContent = `${P.meta.title}　·　${P.meta.start} ~ ${P.meta.end}`;
    $('#pDays').value = P.meta.days;
    $('#pRatio').value = 100;
    $('#pKnot').value = P.params.qifuExtraKnot;

    if (restoreLocal() && P.meta.imported) { /* 使用上次导入的数据 */ }
    state.ctx = buildCtx();
    markCtx();
    state.lib = E.buildLibrary();
    syncTargets();

    renderSummary();
    renderCats();
    renderWays();
    renderGrid();
    renderSelected();
    renderPlan();

    $('#search').oninput = (e) => { state.q = e.target.value; renderGrid(); };
    ['#pDays', '#pRatio', '#pKnot', '#sYb', '#sJade', '#sLamp', '#sNana', '#sC1', '#sC2', '#sC3'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('change', recalc);
    });
    $('#btnRecalc').onclick = recalc;
    $('#btnCopy').onclick = copyPlan;
    $('#btnRate').onclick = () => { renderRates(); $('#rateModal').classList.add('on'); };
    $('#closeRate').onclick = () => $('#rateModal').classList.remove('on');
    $('#btnMin').onclick = () => {
      fillMinSelect();
      $('#minModal').classList.add('on');
      renderMin();
    };
    $('#closeMin').onclick = () => $('#minModal').classList.remove('on');
    document.getElementById('btnMinGo').onclick = renderMin;
    document.getElementById('minQty').onkeydown = (e) => { if (e.key === 'Enter') renderMin(); };
    $('#btnDay').onclick = () => { renderDayTable(); $('#dayModal').classList.add('on'); };
    $('#closeDay').onclick = () => $('#dayModal').classList.remove('on');
    $('#btnAll').onclick = () => { renderAllTable(); $('#allModal').classList.add('on'); };
    $('#closeAll').onclick = () => $('#allModal').classList.remove('on');
    $('#btnImport').onclick = () => $('#importModal').classList.add('on');
    $('#closeImport').onclick = () => $('#importModal').classList.remove('on');
    $('#closeRoute').onclick = () => $('#routeModal').classList.remove('on');
    $('#fileInput').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { $('#mdPaste').value = r.result; doParse(); };
      r.readAsText(f, 'utf-8');
    };
    $('#btnParse').onclick = doParse;
    $('#btnApply').onclick = doApply;
  }

  /* ---------- 解析 / 应用 ---------- */
  function doParse() {
    const text = $('#mdPaste').value;
    if (!text.trim()) return;
    const { model, report } = PARSER.parse(text);
    state.pendingImport = model;
    const box = $('#parseReport');
    box.innerHTML = `<div style="margin-bottom:8px">识别结果：</div>
      <ul style="padding-left:16px;margin:0 0 10px">${report.map((r) => `<li class="ok">${r}</li>`).join('') || '<li class="bad">未识别到可解析的表格</li>'}</ul>
      <div style="margin-bottom:4px;color:var(--ink-3)">可编辑的解析结果（改完点「应用到本期」）：</div>
      <textarea id="jsonEdit" style="width:100%;height:220px;border:1px solid var(--line-strong);border-radius:8px;padding:8px;font-family:ui-monospace,Consolas,monospace;font-size:11px">${JSON.stringify(model, null, 2).replace(/</g, '&lt;')}</textarea>`;
    $('#btnApply').disabled = !report.length;
  }

  function doApply() {
    const ta = document.getElementById('jsonEdit');
    if (!ta) return;
    let model;
    try { model = JSON.parse(ta.value); } catch (e) {
      alert('JSON 格式有误：' + e.message);
      return;
    }
    PARSER.apply(model);
    P.meta.imported = true;
    saveLocal();
    E.reset();
    TARGETS.reset();
    state.lib = E.buildLibrary();
    state.selected = new Set();
    state.pin = {};
    $('#pDays').value = P.meta.days;
    $('#eventMeta').textContent = `${P.meta.title}　·　${P.meta.start} ~ ${P.meta.end}`;
    state.ctx = buildCtx();
    markCtx();
    syncTargets();
    renderCats(); renderWays(); renderGrid(); renderSelected(); renderPlan();
    $('#importModal').classList.remove('on');
  }

  function recalc() {
    state.ctx = buildCtx();
    markCtx();
    // 参数变化后，缓存里与参数相关的键已包含参数，无需清理
    syncTargets();
    renderGrid();
    renderPlan();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.__state = state;
})();
