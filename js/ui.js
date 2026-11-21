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
    /* 充值分析：视图（table/pick）、当前方案、勾选的武将 */
    rateView: 'table', pickPlan: null, pickSel: null, comboSel: {},
    /* 锁定充值组合：从「先选充值」进来时，方案不再自己算充值 */
    lockCharge: null,
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
  /* 券名跟着本期 P.coupons 走，不再写死 1111/2888/6665 */
  const COUPON_NAME = { 券1111: '抵价券1111', 券2888: '抵价券2888', 券6665: '抵价券6665' };
  const cpnLabel = (k) => {
    const c = (P.coupons || {})[k];
    return c && c.face ? '抵价券' + c.face : (COUPON_NAME[k] || CN[k] || k);
  };
  const cpnShort = (k) => {
    const c = (P.coupons || {})[k];
    return c && c.face ? c.face + '券' : (k.replace(/^券/, '') + '券');
  };

  /* ---------- 抵价券存货输入（券种跟着本期 P.coupons 走） ---------- */
  function renderCouponStock() {
    const box = document.getElementById('couponStock');
    if (!box) return;
    const keys = Object.keys(P.coupons || {}).sort((a, b) => (P.coupons[b].face || 0) - (P.coupons[a].face || 0));
    if (!keys.length) {
      box.innerHTML = '<div class="hint" style="grid-column:1/-1">本期公告未出现抵价券</div>';
      return;
    }
    box.innerHTML = keys.map((k) => {
      const c = P.coupons[k];
      return `<label title="抵价券 ${c.min}-${c.face}">${c.face}<input type="number" id="sC_${k}" value="0" min="0"></label>`;
    }).join('');
    box.querySelectorAll('input').forEach((el) => el.addEventListener('change', recalc));
  }

  function readStock() {
    const g = (id) => { const el = document.querySelector(id); return el ? Math.max(0, +el.value || 0) : 0; };
    const coupons = {};
    Object.keys(P.coupons || {}).forEach((k) => { coupons[k] = g('#sC_' + k); });
    return {
      yb: g('#sYb'),
      items: { 宝玉: g('#sJade'), 祈福灯: g('#sLamp'), 纳贤令: g('#sNana') },
      coupons,
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
    return Object.keys(t || {}).map((k) => `${cpnLabel(k)}×${E.fmt(t[k])}`).join(' · ');
  }

  /* 到账 = 可花总额 = 充值本金 + 红包返利 + 福喵返利（+ 首充双倍）。
     以前返利只在这里展示、不进预算，锁定 132 时明明返还够花却报「还差一万多」。
     绑定元宝不在回冲品类里，计入可花余额不会双算，这里把构成标清楚。 */
  function arrivalText(chg) {
    const yb = (chg && chg.yb) || 0;
    const red = (chg && chg.rebateYb) || 0;
    const fm = (chg && chg.fumiaoYb) || 0;
    const fd = (chg && chg.firstDoubleYb) || 0;
    const arr = Math.max((chg && chg.arrivalYb) || (yb + red + fm + fd), yb + red + fm + fd);
    const parts = [`本金 ${E.fmt(yb)}`];
    if (red > 0) parts.push(`红包 ${E.fmt(red)}`);
    if (fm > 0) parts.push(`福喵 ${E.fmt(fm)}`);
    if (fd > 0) parts.push(`首充双倍 ${E.fmt(fd)}`);
    return `到账 ${E.fmt(arr)} 元宝` + (arr > yb + 1 ? `（${parts.join(' + ')}）` : '');
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
    const r = SCHED.build(names, {
      days: state.ctx.days,
      stock: readStock(),
      lockCharge: state.lockCharge || null,
      /* 0 = 自动按当期档位门槛挑最优；>0 = 强制按这个金额卡每天消费 */
      budget: Math.max(0, +$('#pBudget').value || 0),
    });
    state.daily = r;

    const left = (r.charge.spendableYb != null ? r.charge.spendableYb : r.charge.yb) - r.netSpend;
    const noRoute = r.noRoute || [];
    const unb = r.unbuyable || [];
    /* 报价不完整：要么目标本身没渠道，要么需求的道具本期买不到 */
    const broken = (noRoute.length > 0 && !r.priced) || unb.length > 0;
    sub.textContent = `${names.length} 个目标 · ` + r.audit.map((a) => a.label + ' ' + E.fmt(a.need)).join(' / ')
      + (noRoute.length ? ` · ${noRoute.length} 个目标无渠道` : '');

    const priceHtml = broken
      ? `<div class="v" style="color:var(--ink-3)">无法报价</div>
         <div class="k" style="margin-top:2px">${unb.length ? unb.map((u) => u.label + ' 本期买不到').join('、')
           : `${noRoute.length} 个目标本期无购买渠道`}</div>`
      : `<div class="v">¥${E.fmt(r.money)}</div>
         <div class="k" style="margin-top:2px">${arrivalText(r.charge)}</div>`;

    const warns = [];
    if (noRoute.length) {
      warns.push(`未计入报价：${noRoute.join('、')}<span>只能靠签筒 / 砸蛋 / 绘卷等未建模玩法产出</span>`);
    }
    if (unb.length) {
      warns.push(`本期买不到：${unb.map((u) => `${u.label} 需 ${E.fmt(u.need)}`).join('、')}<span>需求存在但没有购买渠道，金额不可信</span>`);
    }
    const short = (r.shortItems || []).filter((x) => !unb.some((u) => u.key === x.key));
    if (short.length) {
      warns.push(`还差：${short.map((x) => `${x.label} ${E.fmt(Math.round(x.lack))}`).join('、')}
        <span>${state.lockCharge ? '这组充值给的不够，加档位或去掉目标' : '当前渠道凑不齐，考虑换路线或加预算'}</span>`);
    }
    /* 充值被锁定：说明钱是按你选的那组充的，以及够不够花 */
    let lockHtml = '';
    if (state.lockCharge && state.lockCharge.length) {
      const over = r.overBudget || 0;
      lockHtml = `<div class="lockbar${over > 1 ? ' bad' : ''}">
        <span>${over > 1
          ? `充值已锁定，但还差 <b>${E.fmt(Math.round(over))}</b> 元宝才够买这些——再加一档，或去掉一个目标`
          : `充值已锁定为这一组，${arrivalText(r.charge)}，可花余额够花`}</span>
        <button class="btn sm ghost" id="unlockCharge">解除锁定</button>
      </div>`;
    }

    $('#totals').innerHTML = `
      <div class="tot hl">
        <div class="k">需要充值</div>
        ${priceHtml}
      </div>
      <div class="tot">
        <div class="k">实付元宝</div>
        <div class="v">${money(r.netSpend)}</div>
        <div class="k" style="margin-top:2px">券抵 ${E.fmt(r.couponSave)}${left > 1 ? ` · 可花余 ${money(left)}` : ''}</div>
      </div>
      ${lockHtml}
      ${warns.map((w) => `<div class="noroute">${w}</div>`).join('')}`;
    const ul = document.getElementById('unlockCharge');
    if (ul) ul.onclick = () => { state.lockCharge = null; renderPlan(); };

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
          <span class="dchg">${chg ? '充值 ' + chg : ''}</span>
          <span class="dsp"><span class="dsp-k">消费</span><b>${E.fmt(row.spend)}</b></span>
        </div>
        <div class="dp">${pk.length ? pk.join('　·　') : '—'}</div>
        ${disc > 1 ? `<div class="ddisc">抵价券 −${E.fmt(disc)}</div>` : ''}
        ${rw ? `<div class="drw">领 ${rw}</div>` : ''}`;
      list.appendChild(el);
    });
    if (!any) {
      list.innerHTML = broken
        ? '<div class="empty" style="padding:20px 0">本期无法报价：所需道具在本期买不到，见上方提示</div>'
        : '<div class="empty" style="padding:20px 0">本期白送的就够了，不用消费</div>';
    }

    const aud = r.audit.map((a) => `<tr>
        <td>${a.label}</td>
        <td class="num">${E.fmt(a.need)}</td>
        <td class="num">${a.stock ? E.fmt(a.stock) : '—'}</td>
        <td class="num">${a.free ? E.fmt(a.free) : '—'}</td>
        <td class="num">${a.tier ? E.fmt(a.tier) : '—'}</td>
        <td class="num">${a.duobao ? E.fmt(a.duobao) : '—'}</td>
        <td class="num">${a.charge ? E.fmt(a.charge) : '—'}</td>
        <td class="num">${E.fmt(a.buy)}</td>
        <td class="num ${a.total >= a.need ? 'ok' : 'bad'}">${E.fmt(a.total)}</td>
      </tr>`).join('');
    $('#auditBox').innerHTML = `
      <h3>核对</h3>
      <table class="mini-table">
        <thead><tr><th>道具</th><th class="num">需要</th><th class="num">期初</th><th class="num">白送</th><th class="num">档位</th><th class="num">充值</th><th class="num">要买</th><th class="num">合计</th></tr></thead>
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
      <td class="cpn-name" title="满 ${E.fmt(x.min)} 减 ${E.fmt(x.face)}">${cpnShort(x.key)}</td>
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

    /* 2.4 结余券的去处：只有当期真的还在卖灯 / 盒，才谈得上「拿去单买」 */
    const lf = SCHED.leftoverPlan(led);
    const sunk = led.left <= 0
      ? `<div class="out-note">券刚好用完，没有结余。</div>`
      : lf.dead
        ? `<div class="out-note">结余 <b>${led.left}</b> 张券（券面 ${E.fmt(lf.face)}）。本期商城没有祈福灯 / 礼盒的单买通道，这些券在本单里用不掉，不计入残值。</div>`
        : `<div class="out-note">结余 <b>${led.left}</b> 张券默认拿去单买：${lf.lampOk ? `换 <b>${lf.lamps}</b> 盏祈福灯（券面抵 ${E.fmt(lf.face)}，实付 <b>${E.fmt(lf.pay)}</b> 元宝，按 1,000/盏折 <b>${E.fmt(lf.value)}</b> 元宝）` : '本期没有祈福灯单卖'}${lf.lampOk && lf.boxOk && lf.jadeQty ? `；改买玉则换 ${lf.jadeQty} 玉、实付 ${E.fmt(lf.jadePay)}` : ''}。券不是沉没额度。</div>`;

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
      <div class="free-chips">${freeChips}</div>
      ${rhythmHtml(r, state.ctx.days)}
      ${jadeTopupHtml(r)}
      ${ccbjHtml(r, names)}`;
  }

  /* 草船借箭：概率武将靠方案消费产草人→抽箭矢→兑换。
     展示草人来源分解、每个选中武将的期望覆盖情况，以及不足时补到哪个档。 */
  function ccbjHtml(r, names) {
    const cp = SCHED.ccbjPlan(names, r, state.ctx.days);
    if (!cp.on || !cp.targets.length) return '';
    const g = cp.grass;
    const rows = cp.targets.map((t) => {
      const cls = t.covered ? (t.coveredMin ? 'done' : 'hl-row') : 'far';
      let note;
      if (t.covered) note = t.coveredMin ? '<span class="st in">保底也够</span>'
        : '<span class="st warn">期望够·非保底</span>';
      else if (t.topup && t.topup.steps.length) {
        const steps = t.topup.steps.map((s) => `${s.type} ${E.fmt(s.need)}→+${s.qty}草人`).join('、');
        note = `<span class="st warn">差 ${t.needGrass} 草人</span><div style="font-size:9.3px;color:var(--ink-3);white-space:normal;margin-top:2px">补：${steps}</div>`;
      } else note = `<span class="st off">差 ${t.needGrass} 草人</span>`;
      return `<tr class="${cls}">
        <td>${t.name}</td>
        <td class="num">${E.fmt(t.arrows)}</td>
        <td class="num">${t.drawsEv}</td>
        <td class="num">${E.fmt(t.arrowEv)}</td>
        <td>${note}</td>
      </tr>`;
    }).join('');
    const tip = `本方案产 <b class="hl-num">${g.total}</b> 草人（游戏 ${g.game} + 充值 ${g.charge} + 消费 ${g.spend}），`
      + `每抽箭矢期望 <b>${cp.arrow.ev}</b>、保底 ${cp.arrow.min}，期望共 <b>${E.fmt(g.total * cp.arrow.ev)}</b> 箭矢。`
      + (cp.allCovered ? ' 选中武将均可用期望箭矢兑换到。' : ' 未达标的武将按「补档」把消费/充值顶到对应档即可多抽。');
    return `<h4>草船借箭 · 概率武将期望覆盖</h4>
      <div class="out-note jade-tip">${tip}</div>
      <table class="out-table rhythm ccbj-topup">
        <thead><tr><th>武将</th><th class="num">需箭矢</th><th class="num">期望抽数</th><th class="num">本方案期望箭矢</th><th>覆盖 / 补档</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* 累计消费送宝玉：告诉玩家「消费也能换玉」，并把净消费补到下一档门槛。
     宝玉是珍宝商店换武将的硬通货，所以这类活动的消费不该只停在买齐道具的最小花费。 */
  function jadeTopupHtml(r) {
    const jt = SCHED.spendJadeTopup(r.netSpend);
    if (!jt.on) return '';
    const rows = jt.tiers.map((t) => {
      const isNext = jt.next && t.need === jt.next.need;
      return `<tr class="${t.reached ? 'done' : isNext ? 'hl-row next' : 'far'}">
        <td class="num">${E.fmt(t.need)}</td>
        <td>${t.jadeText}</td>
        <td class="num">${E.fmt(Math.round(t.value))}</td>
        <td>${t.reached ? '<span class="st in">已拿到</span>'
          : isNext ? `<span class="st warn">再花 ${E.fmt(Math.round(t.gap))}</span>`
            : `<span class="dim">差 ${E.fmt(Math.round(t.gap))}</span>`}</td>
      </tr>`;
    }).join('');
    const tip = jt.topup
      ? `当前净消费 <b>${money(r.netSpend)}</b>，再补 <b class="hl-num">${E.fmt(Math.round(jt.topup.gap))} 元宝</b>`
        + ` 到 <b>${E.fmt(jt.topup.toNeed)}</b> 档，可多拿 <b class="hl-num">${jt.topup.jade} 个传世宝玉</b>`
        + `（按保底约值 ${E.fmt(Math.round(jt.topup.value))} 元宝）。宝玉能在珍宝商店换武将，凑到门槛通常比停在档外划算。`
      : `本期累计消费送宝玉 <b>${jt.tiers.length}</b> 档已全部拿到，宝玉档这块没有可补的了。`;
    return `<h4>累计消费送宝玉 · 补档建议</h4>
      <div class="out-note jade-tip">${tip}</div>
      <table class="out-table rhythm jade-topup">
        <thead><tr><th class="num">累计消费门槛</th><th>送宝玉</th><th class="num">约值元宝</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* 消费节奏对比：同样一笔钱，一次性花完还是分天花，哪个每日档拿得多。
     plan 只给原始奖励，这里用 rates 的单价折成元宝价值再排序。 */
  function rhythmHtml(r, days) {
    const rhythms = SCHED.spendRhythm(r.netSpend, days);
    if (!rhythms.length) return '';
    const U = RATES.unitTable();
    const scored = rhythms.map((x) => {
      const val = Object.keys(x.gets).reduce((a, k) => a + x.gets[k] * (U[k] || 0), 0);
      return { ...x, val, detail: Object.keys(x.gets)
        .map((k) => `${k}×${E.fmt(x.gets[k])}`).join('、') };
    });
    const bestVal = Math.max(...scored.map((x) => x.val));
    const rows = scored.map((x) => {
      const best = x.val >= bestVal - 1e-6;
      const dayStr = x.perDay.filter((v) => v > 0).map((v) => E.fmt(Math.round(v))).join(' / ');
      return `<tr class="${best ? 'hl-row' : ''}">
        <td>${x.name}${best ? ' <span class="st in">最划算</span>' : ''}<div style="font-size:9.4px;color:var(--ink-3);white-space:normal">${x.note}</div></td>
        <td class="num">${x.daysUsed}</td>
        <td class="num">${x.hitCount}</td>
        <td class="num">${E.fmt(Math.round(x.val))}</td>
        <td style="white-space:normal;font-size:9.6px" title="${dayStr}">${dayStr}</td>
      </tr>`;
    }).join('');
    return `<h4>消费节奏：一次性花完 vs 分天花</h4>
      <div class="out-note">同样花 <b>${money(r.netSpend)}</b> 元宝，每日档是「当天花到门槛就领、每天都重置」。分散到多天能各领一次，但摊得太薄又够不到高档——下面按本期单价折成元宝价值。</div>
      <table class="out-table rhythm">
        <thead><tr><th>节奏</th><th class="num">用几天</th><th class="num">命中档</th><th class="num">奖励价值</th><th>每日花费</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* ---------- 每日方案表（大表） ---------- */
  function renderDayTable() {
    const r = state.daily;
    if (!r) return;
    const rows = SCHED.rows(r);
    const body = rows.map((row) => {
      const chg = row.charges.length ? row.charges.map((c) => `¥${E.fmt(c.money)}`).join(' + ') : '—';
      /* 消费档位标注：当日净消费过了哪些每日档（对齐人工图的「消费档位」列） */
      const tierTxt = (row.tierNeeds || []).length
        ? `<div class="day-tier">档 ${row.tierNeeds.map((n) => E.fmt(n)).join('/')}</div>` : '';
      /* 用券买的道具单独标出来（对齐人工图「用X券买Y个」） */
      const cpnTxt = (row.couponPacks || []).length
        ? `<div class="day-cpn">券购 ${groupPacks(row.couponPacks).join('、')}${row.couponDisc ? `（省${E.fmt(row.couponDisc)}）` : ''}</div>` : '';
      const buyTxt = groupPacks(row.packs).join('　·　');
      return `<tr>
        <td>${dateOf(row.i)}</td>
        <td class="chg">${chg}</td>
        <td class="num">${row.charges.length ? E.fmt(row.charges.reduce((a, c) => a + c.money, 0)) : '—'}</td>
        <td class="num">${E.fmt(row.spend)}${tierTxt}</td>
        <td>${buyTxt || '—'}${cpnTxt}</td>
        <td>${rewardText(row.tier) || '—'}</td>
      </tr>`;
    }).join('');

    const aud = r.audit.map((a) => `<tr>
        <td>${a.label}</td>
        <td class="num">${E.fmt(a.need)}</td>
        <td class="num">${a.stock ? E.fmt(a.stock) : '—'}</td>
        <td class="num">${a.free ? E.fmt(a.free) : '—'}</td>
        <td class="num">${a.tier ? E.fmt(a.tier) : '—'}</td>
        <td class="num">${a.duobao ? E.fmt(a.duobao) : '—'}</td>
        <td class="num">${a.charge ? E.fmt(a.charge) : '—'}</td>
        <td class="num">${E.fmt(a.buy)}</td>
        <td class="num ${a.total >= a.need ? 'ok' : 'bad'}">${E.fmt(a.total)}</td>
      </tr>`).join('');

    const chgList = r.charge.picks.map((p) => `${p.t.need / 100}元×${p.n}${p.crystal ? '(水晶球档)' : p.alt ? '(换绑元)' : ''}`).join(' + ');

    $('#dayTitle').textContent = `每日消费方案 · ${[...state.selected].join(' + ')}`;
    $('#dayBody').innerHTML = `
      <table class="plan-table day-plan">
        <thead><tr><th>日期</th><th>充值档位</th><th class="num">充值合计</th><th class="num">当日消费</th><th>买到什么</th><th>当天领奖</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="audit-block">
        <h3>核对</h3>
        <table class="plan-table aud-plan">
          <thead><tr><th>道具</th><th class="num">需要</th><th class="num">期初</th><th class="num">白送</th><th class="num">档位返</th><th class="num">夺宝</th><th class="num">充值</th><th class="num">要买</th><th class="num">合计</th></tr></thead>
          <tbody>${aud}</tbody>
        </table>
      </div>
      <p class="sumline">充值 <b>¥${E.fmt(r.money)}</b>（${chgList}）· ${arrivalText(r.charge)} · 实付 <b>${E.fmt(r.netSpend)}</b> · 抵价券省 <b>${E.fmt(r.couponSave)}</b>${(r.charge.spendableYb != null ? r.charge.spendableYb : r.charge.yb) - r.netSpend > 1 ? ` · 可花余 <b>${E.fmt((r.charge.spendableYb != null ? r.charge.spendableYb : r.charge.yb) - r.netSpend)}</b>` : ''}</p>
      ${r.budget > 0 ? `<p class="hint">逐日预算：按每天 <b>${E.fmt(r.budget)}</b> 元宝卡当日消费档，共 ${r.act} 天有花销。每日档（含每日重置的充值档）按天各结算一次，堆在一天只能吃一次。</p>` : ''}
      ${r.duobao && r.duobao.detail && r.duobao.detail.length ? `<p class="hint">夺宝兑换：本期返到 <b>${E.fmt(r.duobao.pool)}</b> 张夺宝券，打 ${r.duobao.detail.map((x) => `${x.pool} ${x.plays} 次（${x.coupons} 券）`).join(' + ')}，换回 ${Object.keys(r.duobao.got).map((k) => `${k}×${E.fmt(r.duobao.got[k])}`).join('、')}。券不打夺宝就作废。</p>` : ''}
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

  /* ---------- 充值分析（先定充值，再挑武将） ---------- */
  let planCache = null;

  function planLabel(picks) {
    return picks.map((p) => {
      const t = p.tier;
      const suf = t.tag === '首日' ? '·首' : (/11\/8|第\d天起/.test(t.tag) ? '·后' : '');
      return `¥${E.fmt(t.rmb)}${suf}${p.n > 1 ? '×' + p.n : ''}`;
    }).join(' + ');
  }

  /* 方案库：一次枚举出各金额段的最优，再按预算档挑代表。
     枚举 7 万量级要几百毫秒，所以按天数缓存，别每次开弹窗都算。 */
  function getPlans(days) {
    if (planCache && planCache.days === days) return planCache.list;
    const out = [];
    const seen = new Set();
    const add = (tag, picks) => {
      if (!picks || !picks.length) return;
      const c = RATES.combo(picks, days);
      if (!c.cost) return;
      const sig = c.picks.map((p) => p.tier.i + 'x' + p.n).sort().join('+');
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({
        tag, c, bd: RATES.breakdown(c, days), label: planLabel(c.picks),
        picks: c.picks.map((p) => ({ i: p.tier.i, n: p.n })),
      });
    };

    const maxBudget = Math.max(200, (P.chargeTiers || []).reduce((a, t) => {
      const cap = t.total > 0 ? t.total : (t.perDay ? t.perDay * days : 1);
      return a + (t.need / 100) * cap;
    }, 0));

    let pool = [];
    try { pool = RATES.bestMix(days, maxBudget, 260, { minShare: 0 }); } catch (e) { pool = []; }
    [100, 300, 600, 1000, 2000, 4000].forEach((b) => {
      if (b > maxBudget) return;
      const cand = pool
        .filter((x) => x.combo.money <= b * 1.02 && x.combo.money >= b * 0.7)
        .sort((x, y) => y.e2e.ratio - x.e2e.ratio)[0];
      if (cand) add('推荐', cand.combo.picks.map((p) => ({ i: p.tier.i, n: p.n })));
    });
    const full = RATES.fullMix(days);
    add('全买满', full.combo.picks.map((p) => ({ i: p.tier.i, n: p.n })));
    RATES.tierList(days).forEach((t) => { if (t.cap > 0) add('单档', [{ i: t.i, n: 1 }]); });

    planCache = { days, list: out };
    return out;
  }

  function bdYbTotal(bd) {
    return bd.b.tong + bd.b.bang + bd.b.hongbao;
  }

  function renderRates() {
    if (state.rateView === 'pick') return renderPicker();
    state.rateView = 'table';
    state.comboSel = state.comboSel || {};
    const days = state.ctx.days;
    const plans = getPlans(days);
    const full = RATES.fullMix(days);
    const bestOne = plans.slice().sort((a, b) => b.bd.ratioAll - a.bd.ratioAll)[0];

    const head = RATES.COLS.map((c) => `<th class="num" title="${c.hint}">${c.name}</th>`).join('');

    const rows = plans.map((p, i) => {
      const bd = p.bd;
      const ybTotal = bdYbTotal(bd);
      const e2e = RATES.endToEnd(p.c, days);
      const cells = RATES.COLS.map((c) => {
        const v = bd.b[c.key];
        return `<td class="num${v > 0 ? '' : ' zero'}">${v > 0 ? E.fmt(Math.round(v)) : '—'}</td>`;
      }).join('');
      return `<tr>
        <td class="planname">${p.label}<span class="tagline ${p.tag === '推荐' ? '' : 'gold'}">${p.tag}</span></td>
        <td class="num"><b>¥${E.fmt(p.c.money)}</b></td>
        <td class="num"><b>${E.fmt(Math.round(ybTotal))}</b></td>
        ${cells}
        <td class="num ratio">${bd.ratioAll.toFixed(2)}×</td>
        <td class="num ratio sub2">${bd.ratioNo15.toFixed(2)}×</td>
        <td class="num ratio sub2">${bd.ratioNoNaxian.toFixed(2)}×</td>
        <td class="num e2e" title="充值返利 + 消费返利都算上">${e2e.ratio.toFixed(2)}×</td>
        <td class="num"><button class="btn sm ghost pickbtn" data-i="${i}">选将 →</button></td>
      </tr>`;
    }).join('');

    const tiers = RATES.tierList(days).slice().sort((a, b) => a.need - b.need);
    const chips = tiers.map((t) => {
      const on = state.comboSel[t.i];
      const tip = [t.cond, t.altText].filter(Boolean).join(' · ');
      return `<label class="tchip${on ? ' on' : ''}" data-i="${t.i}" title="${tip}">
        <input type="checkbox" class="ckT" data-i="${t.i}" ${on ? 'checked' : ''}>
        <b>¥${E.fmt(t.rmb)}</b><i>${t.tag}</i>
        <input type="number" class="nT" data-i="${t.i}" min="1" max="${t.cap}" value="${on || 1}" ${on ? '' : 'disabled'}>
        <s>/${t.cap}</s>
      </label>`;
    }).join('');

    /* 本期充值到底返不返「15-1 / 纳贤令」——不返的话三档倍率必然一样，
       与其让用户以为是 bug，不如直接说明白 */
    const noSpecial = plans.every((p) => p.bd.b.sel15 === 0 && p.bd.b.naxian === 0);
    const hintText = noSpecial
      ? '本期充值不返 15-1 / 纳贤令，三档倍率一致；换个有纳贤返利的期就会分开'
      : '倍率高 ≠ 一定值：要看这些产出对不对得上你要的武将';

    $('#rateBody').innerHTML = `
      <div class="rate-kpis">
        <div class="kpi"><span>最优单档</span><b>${bestOne ? `¥${E.fmt(bestOne.c.money)} · ${bestOne.bd.ratioAll.toFixed(2)}×` : '—'}</b></div>
        <div class="kpi"><span>全买满</span><b>¥${E.fmt(full.combo.money)} · ${full.e2e.ratio.toFixed(2)}×</b></div>
        <div class="kpi"><span>方案</span><b>${plans.length} 组</b></div>
        <div class="kpi hint">${hintText}</div>
      </div>

      <table class="ana-table">
        <thead>
          <tr>
            <th>充值方案</th><th class="num">金额</th><th class="num" title="能直接花的元宝">总元宝</th>
            ${head}
            <th class="num" title="产出全部算数">拿15-1</th>
            <th class="num" title="目标不在 15 选 1 名单里">拿非15-1</th>
            <th class="num" title="根本不练纳贤将">不拿纳贤</th>
            <th class="num" title="充值返利 + 消费返利都算上">含消费</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="rate-foot">
        ${RATES.notes().map((n) => `<div>· ${n}</div>`).join('')}
        <div>· 三档倍率只差在「产出算不算数」：<b>拿 15-1</b> 全算；<b>拿非 15-1</b> 扣掉 15-1 类产出；<b>不拿纳贤</b> 连纳贤令也不算。</div>
      </div>

      <div class="rate-sec">
        <h3>自己配 <em>勾档位、填次数（同档可以多次），看这一组拆出什么</em></h3>
        <div class="tier-chips">${chips}</div>
        <div id="comboOut"></div>
      </div>

      <div class="rate-sec">
        <h3>凑额推荐 <em>给定要花掉的量，DP 求最少人民币（含双倍箱绑元路线）</em></h3>
        <div class="min-form" style="border:0;padding-bottom:8px">
          <label style="font-size:11.5px;color:var(--ink-2)">我要花掉</label>
          <input type="number" id="dpX" min="1" step="1000" value="300000">
          <select id="dpUnit"><option value="yb">元宝</option><option value="rmb">人民币(元)</option></select>
          <button class="btn sm" id="btnDp">算组合</button>
          <span class="hintline">按可花元宝覆盖目标，双倍箱优先按绑元算（拿得更多）。</span>
        </div>
        <div id="dpOut"></div>
      </div>`;

    $('#btnDp').onclick = () => renderDp();
    $('#dpX').onkeydown = (e) => { if (e.key === 'Enter') renderDp(); };

    $('#rateBody').querySelectorAll('.ckT').forEach((el) => {
      el.onchange = () => {
        const i = +el.dataset.i;
        const nEl = $('#rateBody').querySelector(`.nT[data-i="${i}"]`);
        if (el.checked) {
          const n = Math.max(1, Math.min(+nEl.value || 1, +nEl.max || 1));
          state.comboSel[i] = n;
          nEl.value = n;
          nEl.disabled = false;
        } else {
          delete state.comboSel[i];
          nEl.disabled = true;
        }
        el.closest('.tchip').classList.toggle('on', el.checked);
        renderCombo();
      };
    });
    $('#rateBody').querySelectorAll('.nT').forEach((el) => {
      el.onchange = () => {
        const i = +el.dataset.i;
        const n = Math.max(1, Math.min(+el.value || 1, +el.max || 1));
        el.value = n;
        if (state.comboSel[i] != null) { state.comboSel[i] = n; renderCombo(); }
      };
    });
    $('#rateBody').querySelectorAll('.pickbtn').forEach((el) => {
      el.onclick = () => openPicker(plans[+el.dataset.i]);
    });

    renderDp();
    renderCombo();
  }

  /* 勾选的档位 → 拆解 + 三档倍率 */
  function renderCombo() {
    const out = document.getElementById('comboOut');
    if (!out) return;
    const days = state.ctx.days;
    const list = Object.keys(state.comboSel || {}).map((k) => ({ i: +k, n: state.comboSel[k] }));
    const c = RATES.combo(list, days);
    if (!c.picks.length) {
      out.innerHTML = '<div class="hintline">勾上面的档位（同档可填次数），或直接用表格里的方案。</div>';
      return;
    }
    const bd = RATES.breakdown(c, days);
    const ybTotal = bdYbTotal(bd);
    const cols = RATES.COLS.filter((col) => bd.b[col.key] > 0)
      .map((col) => `<div><span class="k">${col.name}</span><b>${E.fmt(Math.round(bd.b[col.key]))}</b></div>`).join('');
    out.innerHTML = `
      <div class="combo-line">
        ${c.picks.map((p) => `<span class="combopick">¥${E.fmt(p.tier.rmb)}<s>${p.tier.tag}</s><i>×${p.n}</i></span>`).join('<span class="plus">+</span>')}
        <button class="btn sm ghost" id="comboClear" style="margin-left:auto">清空</button>
      </div>
      <div class="combo-sum">
        <div><span class="k">本金</span><b>¥${E.fmt(c.money)}</b></div>
        <div><span class="k">总元宝</span><b>${E.fmt(Math.round(ybTotal))}</b></div>
        ${cols}
        <div class="big"><span class="k">拿15-1</span><b>${bd.ratioAll.toFixed(2)}×</b></div>
        <div><span class="k">不拿纳贤</span><b>${bd.ratioNoNaxian.toFixed(2)}×</b></div>
      </div>
      <div class="combo-act">
        <button class="btn sm" id="comboPick">用这一组去选将 →</button>
        ${c.capped ? '<span class="hintline">有档位超过整期可买次数，已按上限截断</span>' : ''}
      </div>`;
    const clr = document.getElementById('comboClear');
    if (clr) clr.onclick = () => { state.comboSel = {}; syncChipRows(); renderCombo(); };
    const pk = document.getElementById('comboPick');
    if (pk) pk.onclick = () => openPicker({
      picks: c.picks.map((p) => ({ i: p.tier.i, n: p.n })),
      c, bd, label: planLabel(c.picks), tag: '自定义',
    });
  }

  function syncChipRows() {
    const body = $('#rateBody');
    if (!body) return;
    body.querySelectorAll('.tchip').forEach((lab) => {
      const i = +lab.dataset.i;
      const on = state.comboSel[i] != null;
      const ck = lab.querySelector('.ckT');
      const nEl = lab.querySelector('.nT');
      if (ck) ck.checked = on;
      if (nEl) { nEl.disabled = !on; if (on) nEl.value = state.comboSel[i]; }
      lab.classList.toggle('on', on);
    });
  }

  /* ---------- 选将：给定充值组合，看这些产出能覆盖谁 ---------- */
  function openPicker(plan) {
    state.pickPlan = plan;
    state.rateView = 'pick';
    state.pickSel = new Set();
    state.pickCat = null;
    renderRates();
  }

  function renderPicker() {
    const p = state.pickPlan;
    if (!p) { state.rateView = 'table'; return renderRates(); }
    const days = state.ctx.days;
    const c = p.c || RATES.combo(p.picks, days);
    const bd = p.bd || RATES.breakdown(c, days);
    const ybTotal = bdYbTotal(bd);
    const soft = Math.max(0, bd.sum - ybTotal);
    const budget = ybTotal + soft;

    /* 组合实际能给的「只能靠充值档拿到」的道具。
       水晶球是硬门槛：买不到、只能充指定档位送，预算够也没用。 */
    const haveBall = (c.gives && c.gives['狂欢水晶球']) || 0;
    const ballOf = (mid) => (mid || [])
      .filter((m) => /水晶球/.test(m.cur || ''))
      .reduce((a, m) => a + (m.qty || 0), 0);

    const all = (state.targets || [])
      /* 只留「有真实购买路线」的目标：靠单买兜底或压根没渠道的，
         锁了充值也算不出确定价，放进列表只会让人白勾 */
      .map((t) => {
        const real = (t.routes || [])
          .filter((r) => !r.manual && r.kind)
          .sort((a, b) => a.yb - b.yb);
        if (!real.length || !(real[0].yb > 0)) return null;
        /* 方案层认不认这条路，才是真标准：engine 有路线但需要层找不到商店项的，
           生成方案时会落进「未计入报价」，别放进列表让人白勾 */
        const nf = SCHED.needOf([t.name]);
        if (!nf.pick.length || !nf.pick[0].kind) return null;
        const mid = real[0].mid || [];
        const ball = ballOf(mid);
        return {
          name: t.name,
          cat: ((state.lib && state.lib.get(t.name)) || {}).cat || '其他',
          need: real[0].yb,
          route: real[0].label || real[0].key || '',
          ball,
          lackBall: ball > haveBall,
        };
      })
      .filter(Boolean)
      .filter((x) => x.need <= budget)
      .sort((a, b) => a.need - b.need);

    /* 默认先看武将：按价位升序排在前面的多半是 2888 的皮肤，不是用户真正要找的 */
    const countOf = (k) => (k === '全部' ? all.filter((x) => !x.lackBall).length
      : all.filter((x) => !x.lackBall && x.cat === k).length);
    const cat = state.pickCat || (countOf('武将') > 0 ? '武将' : '全部');
    const pool = (cat === '全部' ? all : all.filter((x) => x.cat === cat))
      .filter((x) => !x.lackBall);
    const cntOf = countOf;
    const lackList = all.filter((x) => x.lackBall);

    const sel = state.pickSel || new Set();
    const items = pool.map((x) => `<tr class="pickrow${sel.has(x.name) ? ' on' : ''}" data-n="${x.name}">
      <td><input type="checkbox" class="ckP" data-n="${x.name}" ${sel.has(x.name) ? 'checked' : ''}></td>
      <td><b>${x.name}</b><span class="catpill ${x.cat === '武将' ? 'w' : ''}">${x.cat}</span></td>
      <td class="num">${E.fmt(Math.round(x.need))}</td>
      <td class="sub">${x.route}${x.ball ? `<i class="balltag">需 ${x.ball} 球</i>` : ''}</td>
    </tr>`).join('');

    const tabs = ['全部', '武将', '皮肤'].filter((k) => k === '全部' || cntOf(k) > 0)
      .map((k) => `<button class="picktab${cat === k ? ' on' : ''}" data-cat="${k}">${k} <i>${cntOf(k)}</i></button>`).join('');

    $('#rateBody').innerHTML = `
      <div class="pick-head">
        <button class="btn sm ghost" id="pickBack">← 返回充值分析</button>
        <div class="pick-sum">
          <b>${p.label}</b>
          <span>¥${E.fmt(c.money)} · 可花元宝 ${E.fmt(Math.round(ybTotal))} · 折算资源 ${E.fmt(Math.round(soft))}</span>
        </div>
      </div>
      <div class="pick-note">按「这些产出全部可用于该目标」估的可覆盖范围，共 <b>${pool.length}</b> 个。
        勾选后生成方案，充值锁定成这一组，不再由算法改。
        ${lackList.length ? `<br><b>已排除 ${lackList.length} 个要水晶球的目标</b>：这一组只送 ${haveBall} 个球，而球只能从指定充值档来，预算够也补不了。` : ''}</div>
      <div class="pick-tabs">${tabs}</div>
      <div class="pick-list">
        <table class="pick-table">
          <thead><tr><th style="width:34px">选</th><th>目标</th><th class="num">需要元宝</th><th>主要途径</th></tr></thead>
          <tbody>${items || '<tr><td colspan="4" class="empty" style="padding:18px 0;text-align:center;color:var(--ink-3)">这组充值覆盖不了任何目标，加大额度或换一组</td></tr>'}</tbody>
        </table>
      </div>
      <div class="pick-foot">
        <span>已选 <b id="pickCount">${sel.size}</b> 个 · 合计 <b id="pickNeed">0</b> 元宝 · 球 <b id="pickBall">0</b>/${haveBall}</span>
        <button class="btn sm ghost" id="pickOnly" title="保留主界面已选的目标，只把充值锁定成这一组">只锁充值 · 回主界面选将</button>
        <button class="btn sm ghost" id="pickCheap">选最便宜的 3 个</button>
        <button class="btn sm ghost" id="pickClear">清空</button>
        <button class="btn sm" id="pickGo" ${sel.size ? '' : 'disabled'}>用这一组生成方案</button>
      </div>`;

    const refresh = () => {
      const picked = all.filter((x) => sel.has(x.name));
      const need = picked.reduce((a, x) => a + x.need, 0);
      const ball = picked.reduce((a, x) => a + (x.ball || 0), 0);
      const cnt = document.getElementById('pickCount');
      const nd = document.getElementById('pickNeed');
      const bl = document.getElementById('pickBall');
      const go = document.getElementById('pickGo');
      if (cnt) cnt.textContent = sel.size;
      if (nd) nd.textContent = E.fmt(Math.round(need));
      if (bl) {
        bl.textContent = ball;
        bl.style.color = ball > haveBall ? 'var(--accent)' : '';
      }
      if (go) {
        go.disabled = !sel.size;
        go.textContent = ball > haveBall ? `球不够（要 ${ball}，只有 ${haveBall}）` : '用这一组生成方案';
        go.disabled = !sel.size || ball > haveBall;
      }
    };
    refresh();

    $('#pickBack').onclick = () => { state.rateView = 'table'; renderRates(); };
    $('#rateBody').querySelectorAll('.picktab').forEach((el) => {
      el.onclick = () => { state.pickCat = el.dataset.cat; renderPicker(); };
    });
    $('#rateBody').querySelectorAll('.ckP').forEach((el) => {
      el.onchange = () => {
        const n = el.dataset.n;
        if (el.checked) sel.add(n); else sel.delete(n);
        el.closest('tr').classList.toggle('on', el.checked);
        refresh();
      };
    });
    $('#pickCheap').onclick = () => {
      sel.clear();
      pool.slice(0, 3).forEach((x) => sel.add(x.name));
      $('#rateBody').querySelectorAll('.ckP').forEach((el) => {
        el.checked = sel.has(el.dataset.n);
        el.closest('tr').classList.toggle('on', el.checked);
      });
      refresh();
    };
    $('#pickClear').onclick = () => {
      sel.clear();
      $('#rateBody').querySelectorAll('.ckP').forEach((el) => {
        el.checked = false;
        el.closest('tr').classList.remove('on');
      });
      refresh();
    };
    /* 两种进入方案的方式，充值都一样锁定成这组，区别只在目标从哪来：
       pickGo  = 用弹窗里勾选的目标（覆盖主界面选择）
       pickOnly = 保留主界面原有选择，回主界面自己勾武将 / 皮肤 */
    const lockAndGo = (usePicked) => {
      if (usePicked) state.selected = new Set(sel);
      state.lockCharge = p.picks.map((x) => ({ i: x.i, n: x.n, alt: !!x.alt }));
      state.rateView = 'table';
      $('#rateModal').classList.remove('on');
      renderSelected();
      renderPlan();
    };
    $('#pickGo').onclick = () => lockAndGo(true);
    $('#pickOnly').onclick = () => lockAndGo(false);
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
      const picks = r.picks.map((p) => `¥${E.fmt(p.tier.rmb)}×${p.n}${p.alt ? '<i class="altmark">绑</i>' : ''}`).join(' + ');
      return `<div class="combo-row">
        <span class="rtag ${tagCls}">${r.tag}</span>
        <div>
          <div><b>¥${E.fmt(r.money)}</b>　<span class="sub">可花元宝 ${E.fmt(r.yb)}（多 ${E.fmt(r.over)}）· ${r.count} 笔 · 返利折 ${E.fmt(Math.round(r.rebate))}</span></div>
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
    L.push(`合计：充值 ¥${E.fmt(r.money)}，${arrivalText(r.charge)}，实付 ${E.fmt(r.netSpend)}，抵价券省 ${E.fmt(r.couponSave)}`);
    if (r.budget > 0) L.push(`逐日预算：每天 ${E.fmt(r.budget)} 元宝，${r.act} 天有花销（每日重置档按天各结算一次）`);
    if (r.duobao && r.duobao.detail && r.duobao.detail.length) {
      L.push(`夺宝兑换：${r.duobao.pool} 张券 → ${r.duobao.detail.map((x) => `${x.pool}${x.plays}次`).join('+')}，换回 ${Object.keys(r.duobao.got).map((k) => `${k}×${E.fmt(r.duobao.got[k])}`).join('、')}`);
    }
    L.push('');
    L.push('核对：');
    r.audit.forEach((a) => L.push(`  ${a.label}：需要 ${E.fmt(a.need)}，白送 ${E.fmt(a.free)}，档位 ${E.fmt(a.tier)}，夺宝 ${E.fmt(a.duobao || 0)}，充值 ${E.fmt(a.charge || 0)}，买 ${E.fmt(a.buy)}`));
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
    if ($('#pBudget')) $('#pBudget').value = 0;

    if (restoreLocal() && P.meta.imported) { /* 使用上次导入的数据 */ }
    renderCouponStock();
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
    ['#pDays', '#pRatio', '#pKnot', '#pBudget', '#sYb', '#sJade', '#sLamp', '#sNana'].forEach((sel) => {
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
    const miss = model.miss || [];
    const unsup = model.unsupported || [];
    box.innerHTML = `<div style="margin-bottom:8px">识别结果：</div>
      <ul style="padding-left:16px;margin:0 0 8px">${report.map((r) => `<li class="ok">${r}</li>`).join('') || '<li class="bad">未识别到可解析的表格</li>'}</ul>
      ${miss.length ? `<div class="bad" style="margin-bottom:6px">本期公告未找到：${miss.join('、')}</div>` : ''}
      ${unsup.length ? `<div style="margin-bottom:6px;color:var(--ink-3)">未纳入精算的玩法：${unsup.map((u) => u.name).join('、')}（公告有，但没有建模，不会算进价格）</div>` : ''}
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
    /* 换期后档位表变了，锁定的充值组合（按档位索引记的）必须清掉 */
    state.lockCharge = null;
    state.comboSel = {};
    planCache = null;
    RATES.resetUnit();
    $('#pDays').value = P.meta.days;
    $('#eventMeta').textContent = `${P.meta.title}　·　${P.meta.start} ~ ${P.meta.end}`;
    state.ctx = buildCtx();
    markCtx();
    renderCouponStock();
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
