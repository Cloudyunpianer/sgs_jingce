/* ============================================================
   排程引擎 —— 目标 → 中间道具 → 每日购买方案
   不猜概率，只用公告写死的三张表：
     ① 每日消费档位（1111 / 3888 / 8888 / 18888 / 28888 / 38888 / 58888）
     ② 单笔充值档位（返灯、返券、双倍箱）
     ③ 商城礼包的限购与单价
   输出：日期 | 充值 | 当日消费 | 买到什么 | 当天返利
   ============================================================ */

window.SCHED = (function () {
  const P = window.PRESET;
  const E = window.E;
  const fmt = (n) => E.fmt(n);
  const ceil = (x) => Math.ceil(x - 1e-9);

  const KEYS = ['盒', '祈福灯', '纳贤令', '锦绣', '狂欢夺宝券', '狂欢水晶球'];
  const LBL = {
    盒: '礼盒', 祈福灯: '祈福灯', 纳贤令: '纳贤令', 锦绣: '锦绣',
    狂欢夺宝券: '夺宝券', 狂欢水晶球: '水晶球',
  };

  /* 估价单价：只用于不同获取路径之间比大小，不参与最终报价 */
  const UNIT = { 盒: 200, 祈福灯: 370, 纳贤令: 555, 锦绣: 296, 狂欢夺宝券: 60, 狂欢水晶球: 3000 };

  /* ---------------- 一、商品目录 ---------------- */
  let _cat = null;
  function catalog() {
    if (_cat) return _cat;
    const out = [];
    P.systems.forEach((sys) => {
      let key = null, mul = 1;
      if (/^box_/.test(sys.id)) key = '盒';
      else if (sys.id === 'qifu') key = '祈福灯';
      else if (sys.id === 'naxian') key = '纳贤令';
      else if (sys.id === 'jinxiu') key = '锦绣';
      else if (/^db_/.test(sys.id)) { key = '狂欢夺宝券'; mul = 5; }
      if (!key) return;
      (sys.buys || []).forEach((b, i) => {
        if (!b.price) return;
        out.push({
          id: sys.id + '#' + i,
          name: b.label || sys.name,
          price: b.price,
          ty: b.cur === '通用元宝',
          gives: { [key]: b.qty * mul },
          perDay: b.perDay || 0,
          total: b.maxTotal != null ? b.maxTotal : 0,
          c1111: b.price >= 3000 && /纳贤|锦绣|夺宝|祈福|威曹彰|招募|大礼包|礼盒/.test((b.label || '') + sys.name),
          src: sys.name,
        });
      });
    });
    (P.extraPacks || []).forEach((p) => {
      out.push({
        id: p.id, name: p.name, price: p.price, ty: p.cur === '通用元宝',
        gives: p.gives, perDay: p.perDay || 0, total: p.total || 0,
        c1111: !!p.c1111, src: '钜惠商城', exclusive: p.exclusive, chain: p.chain, note: p.note,
      });
    });
    _cat = out.filter((p) => p.price > 0);
    return _cat;
  }
  function reset() { _cat = null; }

  /* ---------------- 二、目标 → 中间道具 ---------------- */
  function shopItem(id, name) {
    const sp = P.shops.find((s) => s.id === id);
    return sp ? (sp.items || []).find((x) => x.name === name) : null;
  }
  /* 祈福：1 灯 = 1 结（固定口径，用户指定），不再按累计档位/均值估算 */
  function knotLamps(knots) {
    const rate = P.params.qifuExtraKnot || 1;
    return Math.ceil(knots / rate - 1e-9);
  }

  function needOf(names) {
    const nd = { 盒: 0, 祈福灯: 0, 纳贤令: 0, 锦绣: 0, 狂欢夺宝券: 0, 狂欢水晶球: 0, 直购: 0 };
    const pick = [];
    const satinEv = P.systems.find((s) => s.id === 'jinxiu').satinEv || 0.84;

    (names || []).forEach((nm) => {
      const cands = [];
      const jd = shopItem('jade', nm);
      if (jd) cands.push({ kind: '盒', qty: jd.cost * 50, via: `宝玉 ${jd.cost} 个`, est: jd.cost * 10000 });
      const qf = shopItem('qifu', nm);
      if (qf) { const l = knotLamps(qf.cost); cands.push({ kind: '祈福灯', qty: l, via: `同心结 ${qf.cost} 个`, est: l * UNIT.祈福灯 }); }
      const nx = (P.systems.find((s) => s.id === 'naxian').progress || []).find((p) => p.item === nm);
      if (nx) cands.push({ kind: '纳贤令', qty: nx.n, via: `纳贤 ${nx.n} 次`, est: nx.n * UNIT.纳贤令 });
      const jx = shopItem('jinxiu', nm);
      if (jx) { const d = ceil(jx.cost / satinEv); cands.push({ kind: '锦绣', qty: d, via: `绸缎 ${jx.cost} 匹`, est: d * UNIT.锦绣 }); }
      const db = ['db_ljjp', 'db_wcz', 'db_fc'].map((id) => P.systems.find((s) => s.id === id))
        .map((s) => ((s && s.progress) || []).find((p) => p.item === nm)).find(Boolean);
      if (db) cands.push({ kind: '狂欢夺宝券', qty: db.n * 5, via: `夺宝 ${db.n} 抽`, est: db.n * 5 * UNIT.狂欢夺宝券 });
      const cr = shopItem('crystal', nm);
      if (cr) cands.push({ kind: '狂欢水晶球', qty: cr.cost, via: `水晶球 ${cr.cost} 个`, est: cr.cost * UNIT.狂欢水晶球 });
      const ds = (P.directSales || []).find((d) => d.name === nm && d.price > 0);
      if (ds) cands.push({ kind: '直购', qty: ds.price, via: '皮肤直售', est: ds.price });

      if (!cands.length) { pick.push({ name: nm, via: '本期无确定途径', kind: null }); return; }
      cands.sort((a, b) => a.est - b.est);
      const c = cands[0];
      nd[c.kind] += c.qty;
      pick.push({ name: nm, via: c.via, kind: c.kind, qty: c.qty });
    });
    return { need: nd, pick };
  }

  /* ---------------- 三、单品最优购买（DP，限购生效） ---------------- */
  function solveItem(key, need, packs, days) {
    if (need <= 0) return { counts: [], cost: 0 };
    const opts = packs
      .filter((p) => p.gives[key] > 0 && Object.keys(p.gives).filter((k) => KEYS.includes(k)).length === 1)
      .map((p) => ({
        p, q: p.gives[key], price: p.price,
        cap: p.total > 0 ? p.total : (p.perDay ? p.perDay * days : 9999),
      }));
    if (!opts.length) return { counts: [], cost: Infinity };
    /* 同价时优先大包（能上抵价券） */
    opts.sort((a, b) => (b.p.c1111 ? 1 : 0) - (a.p.c1111 ? 1 : 0) || b.q - a.q);

    const maxQ = Math.max(...opts.map((o) => o.q));
    const V = need + maxQ;
    const INF = Infinity;
    const dp = Array.from({ length: opts.length + 1 }, () => new Array(V + 1).fill(INF));
    dp[0][0] = 0;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      for (let v = 0; v <= V; v++) {
        const base = dp[i][v];
        if (base === INF) continue;
        const maxk = Math.min(o.cap, Math.floor((V - v) / o.q));
        for (let k = 0; k <= maxk; k++) {
          const nv = v + o.q * k, c = base + o.price * k;
          if (c < dp[i + 1][nv] - 1e-6) dp[i + 1][nv] = c;
        }
      }
    }
    let best = need;
    for (let v = need; v <= V; v++) if (dp[opts.length][v] < dp[opts.length][best] - 1e-6) best = v;
    if (!isFinite(dp[opts.length][best])) return { counts: [], cost: Infinity };

    const counts = [];
    let v = best;
    for (let i = opts.length - 1; i >= 0; i--) {
      const o = opts[i];
      for (let k = 0; k <= Math.min(o.cap, Math.floor(v / o.q)); k++) {
        const pv = v - o.q * k;
        if (pv >= 0 && Math.abs(dp[i][pv] + o.price * k - dp[i + 1][v]) < 1e-6) {
          if (k > 0) counts.push({ pack: o.p, n: k });
          v = pv; break;
        }
      }
    }
    return { counts, cost: dp[opts.length][best] };
  }

  /* ---------------- 四、组合包是否值得买 ---------------- */
  function comboValue(p, unitPrice) {
    return Object.keys(p.gives).reduce((a, k) => a + (KEYS.includes(k) ? p.gives[k] * (unitPrice[k] || 0) : 0), 0);
  }
  function comboSweep(need, packs, unitPrice, heroSet) {
    const bought = [];
    const combos = packs.filter((p) => p.total > 0 && Object.keys(p.gives).filter((k) => KEYS.includes(k)).length > 1)
      .filter((p) => !p.exclusive || heroSet.has(p.exclusive));
    combos.sort((a, b) => (a.price / Math.max(1, comboValue(a, unitPrice))) - (b.price / Math.max(1, comboValue(b, unitPrice))));
    combos.forEach((p) => {
      let n = 0;
      while (n < p.total) {
        if (comboValue(p, unitPrice) <= p.price * 1.02) break;
        if (!Object.keys(p.gives).some((k) => KEYS.includes(k) && need[k] > 0)) break;
        n++;
        Object.keys(p.gives).forEach((k) => {
          if (!KEYS.includes(k)) return;
          need[k] = Math.max(0, need[k] - p.gives[k]);
        });
      }
      if (n > 0) bought.push({ pack: p, n });
    });
    return bought;
  }

  /* ---------------- 五、摊到每天 ---------------- */
  function distribute(instances, days, active) {
    const d = [];
    for (let i = 0; i < days; i++) d.push({ i, spend: 0, net: 0, packs: [], used: {} });
    const act = active && active.length ? active : d.map((x) => x.i);

    const push = (day, ins) => {
      day.packs.push(ins);
      day.spend += ins.price;
      day.used[ins.id] = (day.used[ins.id] || 0) + 1;
    };

    const perDay = instances.filter((x) => x.perDay > 0);
    const bulk = instances.filter((x) => !(x.perDay > 0));

    perDay.sort((a, b) => b.price - a.price).forEach((ins) => {
      const ok = d.filter((x) => act.includes(x.i) && (x.used[ins.id] || 0) < ins.perDay);
      const pool = ok.length ? ok : d.filter((x) => (x.used[ins.id] || 0) < ins.perDay);
      if (!pool.length) return;
      pool.sort((a, b) => a.spend - b.spend);
      push(pool[0], ins);
    });

    bulk.sort((a, b) => b.price - a.price).forEach((ins) => {
      const pool = d.filter((x) => act.includes(x.i));
      const use = pool.length ? pool : d;
      use.sort((a, b) => a.spend - b.spend);
      push(use[0], ins);
    });

    return d;
  }

  function tierOf(spend) {
    const got = {};
    (P.dailyTiers || []).forEach((t) => {
      if (spend + 1e-6 >= t.need) Object.keys(t.gives).forEach((k) => { got[k] = (got[k] || 0) + t.gives[k]; });
    });
    return got;
  }

  /* 抵价券：一次购买只能用一张 */
  function applyCoupons(dist, pool) {
    const left = Object.assign({ 券1111: 0, 券2888: 0, 券6665: 0 }, pool);
    let save = 0;
    const used = {};
    ['券6665', '券2888', '券1111'].forEach((ck) => {
      const def = P.coupons[ck];
      let avail = left[ck] || 0;
      if (!avail || !def) return;
      const cands = [];
      dist.forEach((d) => d.packs.forEach((p) => {
        if (p.c1111 && !p.__c && !p.coupon && p.price >= def.min) cands.push(p);
      }));
      cands.sort((a, b) => b.price - a.price);
      for (const p of cands) {
        if (!avail) break;
        avail--; p.__c = true; p.__disc = def.face;
        save += def.face;
        used[ck] = (used[ck] || 0) + 1;
      }
    });
    dist.forEach((d) => {
      d.net = d.spend - d.packs.reduce((a, p) => a + (p.__disc || 0), 0);
    });
    return { save, used };
  }

  /* 补档：当天离下一档只差一点，用一件“值回票价”的礼包顶上。
     抵价券只有在「确实有满额商品能用掉」时才算价值，避免为了券白花钱。 */
  function topUp(dist, packs, unitPrice, demand) {
    const totalUsed = (id) => dist.reduce((a, d) => a + d.packs.filter((x) => x.id === id).length, 0);

    for (let guard = 0; guard < 40; guard++) {
      let changed = false;
      for (const d of dist) {
        const net = d.spend;
        const next = (P.dailyTiers || []).find((t) => t.need > net + 1e-6);
        if (!next) continue;
        const gap = next.need - net;
        if (gap > 6888) continue;
        /* 只按「真正需要的道具」估值，抵价券不算进来（否则会为了券白花钱） */
        let gain = 0;
        Object.keys(next.gives).forEach((k) => {
          if (!demand.has(k)) return;
          gain += next.gives[k] * (unitPrice[k] || 0);
        });
        if (gain < gap) continue;
        const cand = packs
          .filter((p) => p.price >= gap && p.price <= gap * 2.6)
          .filter((p) => !p.perDay || d.packs.filter((x) => x.id === p.id).length < p.perDay)
          .filter((p) => p.total === 0 || totalUsed(p.id) < p.total)
          .sort((a, b) => a.price - b.price)[0];
        if (!cand) continue;
        d.packs.push(Object.assign({}, cand));
        d.spend += cand.price;
        changed = true;
      }
      if (!changed) break;
    }
  }

  /* 券 ↔ 档位：券压低当日消费 → 档位变低 → 返券变少。
     从最宽松的一组券开始，一旦用券超过实际返券就收紧，单调收敛。 */
  function settle(dist, basePool) {
    const base = Object.assign({ 券1111: 0, 券2888: 0, 券6665: 0 }, basePool);
    dist.forEach((d) => { d.net = d.spend; });
    let pool = Object.assign({}, base);
    const est = tierSum(dist);
    Object.keys(est).forEach((k) => { if (k in pool) pool[k] += est[k]; });

    let ap = { save: 0, used: {} };
    for (let it = 0; it < 5; it++) {
      dist.forEach((d) => d.packs.forEach((p) => { p.__c = false; p.__disc = 0; }));
      dist.forEach((d) => { d.net = d.spend; });
      ap = applyCoupons(dist, pool);
      const earned = tierSum(dist);
      let ok = true;
      ['券1111', '券2888', '券6665'].forEach((k) => {
        if ((ap.used[k] || 0) > (base[k] || 0) + (earned[k] || 0)) ok = false;
      });
      if (ok) break;
      pool = Object.assign({}, base);
      Object.keys(earned).forEach((k) => { if (k in pool) pool[k] += earned[k]; });
    }
    return ap;
  }

  function tierSum(dist) {
    const rw = {};
    dist.forEach((d) => {
      const g = tierOf(d.net);
      Object.keys(g).forEach((k) => { rw[k] = (rw[k] || 0) + g[k]; });
    });
    return rw;
  }

  /* ---------------- 六、充值组合 ---------------- */
  function chargePlan(ybNeed, opts) {
    const days = opts.days;
    const tabs = (P.chargeTiers || []).map((t) => ({
      ...t,
      cap: t.total != null ? t.total : (t.perDay ? t.perDay * days : 1),
    })).filter((t) => !(t.onlyDay && t.onlyDay > days));

    const picks = [];
    let covered = 0;

    /* 水晶球只能用「水晶球档」拿 */
    const cry = opts.crystals || 0;
    if (cry > 0) {
      const tiers = tabs.filter((t) => t.gives && t.gives['狂欢水晶球']);
      const maxC = cry + 22;
      const dp = new Array(maxC + 1).fill(Infinity);
      const pickCh = [];
      dp[0] = 0;
      tiers.forEach((t) => {
        const q = t.gives['狂欢水晶球'];
        const nd = dp.slice();
        const ch = new Array(maxC + 1).fill(0);
        for (let c = 0; c <= maxC; c++) {
          if (dp[c] === Infinity) continue;
          for (let k = 1; k <= Math.min(t.cap, Math.floor((maxC - c) / q)); k++) {
            const nc = c + q * k, cost = dp[c] + t.need * k;
            if (cost < nd[nc] - 1e-6) { nd[nc] = cost; ch[nc] = k; }
          }
        }
        dp.length = 0;
        for (let i = 0; i <= maxC; i++) dp[i] = nd[i];
        pickCh.push({ t, ch });
      });
      let bc = cry;
      for (let c = cry; c <= maxC; c++) if (dp[c] < dp[bc] - 1e-6) bc = c;
      let c = bc;
      for (let i = pickCh.length - 1; i >= 0; i--) {
        const k = pickCh[i].ch[c];
        if (k > 0) {
          picks.push({ t: pickCh[i].t, n: k, crystal: true });
          c -= pickCh[i].t.gives['狂欢水晶球'] * k;
          covered += pickCh[i].t.need * k;
        }
      }
    }

    /* 其余：以 100 元宝为单位做 DP，双倍箱按 2 倍元宝算 */
    const rest = Math.max(0, ybNeed - covered);
    if (rest > 0) {
      const units = Math.ceil(rest / 100);
      const maxU = units + 648;
      const dp = new Array(maxU + 1).fill(Infinity);
      dp[0] = 0;
      const chs = [];
      tabs.forEach((t) => {
        const c = t.need / 100;
        const y = (t.need + (t.alt ? (t.alt['绑定元宝'] || 0) : 0)) / 100;
        const nd = dp.slice();
        const ch = new Array(maxU + 1).fill(0);
        for (let v = 0; v <= maxU; v++) {
          if (dp[v] === Infinity) continue;
          for (let k = 1; k <= Math.min(t.cap, Math.floor((maxU - v) / y)); k++) {
            const nv = v + y * k, cost = dp[v] + c * k;
            if (cost < nd[nv] - 1e-9) { nd[nv] = cost; ch[nv] = k; }
          }
        }
        for (let i = 0; i <= maxU; i++) dp[i] = nd[i];
        chs.push({ t, ch });
      });
      let bu = units;
      for (let v = units; v <= maxU; v++) if (dp[v] < dp[bu] - 1e-9) bu = v;
      let v = bu;
      for (let i = chs.length - 1; i >= 0; i--) {
        const k = chs[i].ch[v];
        if (k <= 0) continue;
        const t = chs[i].t;
        const yk = ((t.need + (t.alt ? (t.alt['绑定元宝'] || 0) : 0)) / 100) * k;
        picks.push({ t, n: k, alt: !!t.alt });
        v -= yk;
        covered += yk * 100;
      }
    }

    const merged = [];
    picks.forEach((x) => {
      const k = merged.find((y) => y.t === x.t && !!y.alt === !!x.alt && !!y.crystal === !!x.crystal);
      if (k) k.n += x.n; else merged.push({ ...x });
    });

    /* 摊到天：每日档从第 1 天起一天一次（守每日限次），限次档压在前几天。
       消费日安排在活动后段（见 solveOnce 的 active），保证「钱先到、再花掉」。 */
    let cursor = 0;
    merged.forEach((x) => {
      const perDay = x.t.perDay || 0;
      const arr = [];
      for (let k = 0; k < x.n; k++) {
        if (perDay) { arr.push(cursor % days); cursor++; }
        else arr.push(Math.min(k, days - 1));
      }
      x.days = arr;
    });

    const money = merged.reduce((a, x) => a + x.t.need * x.n, 0) / 100;
    const gives = {};
    merged.forEach((x) => {
      Object.keys(x.t.gives || {}).forEach((k) => { gives[k] = (gives[k] || 0) + x.t.gives[k] * x.n; });
      if (x.alt && x.t.alt) gives['绑定元宝'] = (gives['绑定元宝'] || 0) + (x.t.alt['绑定元宝'] || 0) * x.n;
    });
    return { picks: merged, money, yb: covered, gives };
  }

  /* ---------------- 七、总方案 ---------------- */
  function solveOnce(names, opts, chargeCoupons) {
    opts = Object.assign({ days: P.meta.days, stock: {} }, opts || {});
    const heroSet = new Set(names || []);
    const info = needOf(names);
    const need0 = info.need;

    const free = {};
    (P.freeGains || []).forEach((f) => {
      if (f.only && !f.only.some((x) => heroSet.has(x))) return;
      free[f.cur] = (free[f.cur] || 0) + f.qty;
    });

    const packs = catalog();
    const unitPrice = {};
    KEYS.forEach((k) => {
      const ps = packs.filter((p) => p.gives[k] > 0 && Object.keys(p.gives).filter((x) => KEYS.includes(x)).length === 1);
      unitPrice[k] = ps.length ? Math.min(...ps.map((p) => p.price / p.gives[k])) : UNIT[k];
    });

    const stockCoupons = Object.assign({ 券1111: 0, 券2888: 0, 券6665: 0 }, opts.stock.coupons || {}, chargeCoupons || {});

    /* 期初存货的中间道具：灯 / 令 直接抵需求；宝玉按 1 玉 = 50 盒折成礼盒。
       存量的宝玉不产生「开盒返玉」，所以抵的是盒数而不是玉数。 */
    const stItems = opts.stock.items || {};
    const stockOf = (k) => {
      if (k === '盒') return (stItems.宝玉 || 0) * 50;
      return stItems[k] || 0;
    };

    let reward = {};
    let best = null;

    for (let round = 0; round < 4; round++) {
      const need = {};
      KEYS.concat(['直购']).forEach((k) => {
        need[k] = Math.max(0, (need0[k] || 0) - (free[k] || 0) - (reward[k] || 0) - stockOf(k));
      });

      const comboBought = comboSweep(need, packs, unitPrice, heroSet);
      const instances = [];
      comboBought.forEach((c) => { for (let i = 0; i < c.n; i++) instances.push(Object.assign({}, c.pack)); });

      const itemResult = [];
      KEYS.forEach((k) => {
        if (need[k] <= 0) return;
        const single = packs.filter((p) => p.gives[k] > 0);
        const r = solveItem(k, need[k], single, opts.days);
        itemResult.push({ k, r });
        r.counts.forEach((c) => { for (let i = 0; i < c.n; i++) instances.push(Object.assign({}, c.pack)); });
      });

      const directYb = need['直购'] || 0;
      const demandSet = new Set(KEYS.filter((k) => (need0[k] || 0) > 0));
      const couponPool = Object.assign({}, stockCoupons);

      let pick = null;
      for (let act = 1; act <= opts.days; act++) {
        if (opts.forceAct && act !== Math.min(opts.forceAct, opts.days)) continue;
        const active = [];
        for (let i = opts.days - act; i < opts.days; i++) active.push(i);
        const dist = distribute(instances.map((x) => Object.assign({}, x)), opts.days, active);
        if (directYb > 0) {
          const used = dist.filter((d) => d.spend > 0);
          const tgt = (used.length ? used : dist).slice().sort((a, b) => a.spend - b.spend)[0];
          tgt.spend += directYb;
          tgt.packs.push({ id: '__direct', name: '皮肤直售', price: directYb, direct: true });
        }
        topUp(dist, packs, unitPrice, demandSet);
        const applied = settle(dist, couponPool);
        const rw = tierSum(dist);
        const net = dist.reduce((a, d) => a + d.net, 0);
        if (!pick || net < pick.net - 1e-6) {
          pick = { act, dist, applied, rw, net };
        }
      }

      best = {
        need0, free, need, comboBought, itemResult,
        dist: pick.dist, act: pick.act, tierReward: pick.rw,
        spend: pick.dist.reduce((a, d) => a + d.spend, 0),
        netSpend: pick.net,
        couponSave: pick.applied.save, coupons: pick.applied.used,
        directYb, unitPrice, info,
      };

      const next = {};
      KEYS.forEach((k) => {
        next[k] = Math.min(pick.rw[k] || 0, Math.max(0, (need0[k] || 0) - (free[k] || 0)));
      });
      const same = KEYS.every((k) => Math.abs((reward[k] || 0) - (next[k] || 0)) < 1e-6);
      reward = next;
      if (same) break;
    }

    const r = best;
    r.netSpend = Math.max(0, r.netSpend - (opts.stock.yb || 0));
    r.charge = chargePlan(r.netSpend, { days: opts.days, crystals: r.need['狂欢水晶球'] || 0 });

    const produced = {};
    r.dist.forEach((d) => d.packs.forEach((p) => {
      if (!p.gives) return;
      Object.keys(p.gives).forEach((k) => { produced[k] = (produced[k] || 0) + p.gives[k]; });
    }));
    r.produced = produced;

    r.audit = KEYS.map((k) => ({
      key: k, label: LBL[k],
      need: need0[k] || 0,
      stock: Math.min(stockOf(k), need0[k] || 0),
      free: free[k] || 0,
      tier: r.tierReward[k] || 0,
      buy: produced[k] || 0,
      total: Math.min(stockOf(k), need0[k] || 0) + (free[k] || 0) + (r.tierReward[k] || 0) + (produced[k] || 0),
    })).filter((x) => x.need > 0);
    r.stockUsed = r.audit.reduce((a, x) => a + x.stock, 0);

    r.extras = KEYS.map((k) => ({
      key: k, label: LBL[k], qty: (free[k] || 0) + (r.tierReward[k] || 0) + (produced[k] || 0),
    })).filter((x) => x.qty > 0 && !r.audit.some((a) => a.key === x.key));

    r.ok = r.audit.every((x) => x.total >= x.need - 1e-6);
    r.money = r.charge.money;
    return r;
  }

  /* 外层：充值返的券会再压低成本，迭代两次 */
  function build(names, opts) {
    let cc = { 券1111: 0, 券2888: 0, 券6665: 0 };
    let r = solveOnce(names, opts, cc);
    for (let i = 0; i < 3; i++) {
      const g = r.charge.gives || {};
      const next = { 券1111: g['券1111'] || 0, 券2888: g['券2888'] || 0, 券6665: g['券6665'] || 0 };
      if (next.券1111 === cc.券1111 && next.券2888 === cc.券2888 && next.券6665 === cc.券6665) break;
      cc = next;
      r = solveOnce(names, opts, cc);
    }
    return r;
  }

  /* 逐日行：给 UI 用 */
  function rows(r) {
    const out = [];
    for (let i = 0; i < r.dist.length; i++) {
      const d = r.dist[i];
      const charges = (r.charge.picks || []).filter((p) => (p.days || []).includes(i));
      const tier = tierOf(d.net);
      out.push({
        i, day: i + 1,
        charges: charges.map((p) => ({
          label: fmt(p.t.need) + (p.crystal ? '（水晶球档）' : p.alt ? '（双倍箱）' : ''),
          money: p.t.need / 100,
        })),
        spend: d.net, gross: d.spend,
        packs: d.packs.filter((p) => !p.coupon),
        tier, rewards: Object.keys(tier),
      });
    }
    return out;
  }

  /* ---------------- 八、过程产出账本 ---------------- */
  const CPN = { 券6665: '抵价券6665', 券2888: '抵价券2888', 券1111: '抵价券1111' };
  const CPN_KEYS = ['券6665', '券2888', '券1111'];

  /* 抵价券流水：获得（期初 + 每日档位 + 充值档位）= 用掉 + 结余
     结余不再记「沉没」：默认拿去单买灯 / 玉（见 leftoverPlan），券面额是能落地的。 */
  function ledger(r, stock) {
    const st = (stock && stock.coupons) || {};
    const rows = CPN_KEYS.map((k) => {
      const def = P.coupons[k] || { face: 0, min: 0, name: k };
      const init = st[k] || 0;
      const daily = (r.tierReward && r.tierReward[k]) || 0;
      const charge = (r.charge && r.charge.gives && r.charge.gives[k]) || 0;
      const used = (r.coupons && r.coupons[k]) || 0;
      const got = init + daily + charge;
      const left = Math.max(0, got - used);
      return {
        key: k, name: CPN[k] || def.name, face: def.face, min: def.min,
        init, daily, charge, got, used, left,
        leftVal: left * def.face,
      };
    });
    const s = (f) => rows.reduce((a, x) => a + f(x), 0);
    return {
      rows,
      got: s((x) => x.got), used: s((x) => x.used), left: s((x) => x.left),
      gotVal: s((x) => x.got * x.face), usedVal: s((x) => x.used * x.face),
      leftVal: s((x) => x.leftVal),
    };
  }

  /* 单买兜底：不凑礼包、不赌开盒，按单价直接买。
     祈福灯 1,000 元宝/盏；传世宝玉 10,000 元宝/个（50 盒保底折）。 */
  const SINGLES = P.singles || {
    祈福灯: { price: 1000, unit: '灯' },
    传世宝玉: { price: 10000, unit: '玉' },
  };
  function singleCost(kind, qty) {
    const s = SINGLES[kind];
    return s ? qty * s.price : Infinity;
  }

  /* 结余券的默认去处：单买灯（1000 整数倍，正好卡 3,000 / 6,666 门槛）。
     每张券单独成一笔（一次购买只能用一张），买够门槛的整数盏灯。
     另给「改买玉」的等价方案：玉单价 10,000 ≥ 所有门槛，一张券抵一个玉。 */
  function leftoverPlan(led) {
    const lamp = SINGLES.祈福灯;
    const jade = SINGLES.传世宝玉;
    const rows = [];
    let lamps = 0, pay = 0, face = 0, n = 0;
    (led.rows || []).forEach((x) => {
      if (!x.left) return;
      const min = x.min || 0;
      const per = Math.max(1, Math.ceil(min / lamp.price));
      const goods = per * lamp.price;
      const net = Math.max(0, goods - x.face);
      lamps += per * x.left;
      pay += net * x.left;
      face += x.face * x.left;
      n += x.left;
      rows.push({ key: x.key, left: x.left, per, goods, face: x.face, net, lamps: per * x.left });
    });
    const jadeQty = n;
    const jadePay = Math.max(0, n * jade.price - face);
    return {
      rows, n, lamps, pay, face,
      value: lamps * lamp.price,
      jadeQty, jadePay,
      lampUnit: lamp.price, jadeUnit: jade.price,
    };
  }

  /* 条件奖励（达标才给，与「买」解耦）
     三态：in 已计入（回冲需求） / only 仅特定目标有效 / off 本方案用不上 */
  const STATE_TXT = { in: '已计入', only: '仅特定目标有效', off: '本方案用不上' };

  function condRows(r, names) {
    const sel = new Set(names || []);
    const out = [];
    const rw = r.tierReward || {};

    /* 1. 每日消费档位送的道具 */
    (P.dailyTiers || []).forEach((t) => {
      const ks = Object.keys(t.gives || {});
      if (!ks.length) return;
      const hit = ks.some((k) => (rw[k] || 0) > 0);
      out.push({
        group: '每日档位',
        cond: `每日消费 ${fmt(t.need)}`,
        reward: ks.map((k) => `${LBL[k] || k}×${fmt(t.gives[k])}`).join(' + '),
        state: hit ? 'in' : 'off',
        note: hit ? '已回冲中间道具需求' : '本方案没吃到这一档',
      });
    });

    /* 2. 消费热力 → 谋程普（1111 热力 = 111100 元宝） */
    (P.consumeRewards || []).forEach((c) => {
      const on = sel.has(c.name);
      out.push({
        group: '消费热力',
        cond: `累计消费 ${fmt(c.need)}`,
        reward: c.name,
        state: on ? 'in' : 'only',
        note: on ? '选中该目标，直接按免单计入' : '只对选中「' + c.name + '」时有效',
      });
    });

    /* 3. 纳贤累计 100 / 120 达标即领 */
    const nx = P.systems.find((s) => s.id === 'naxian');
    const byN = {};
    ((nx && nx.progress) || []).forEach((p) => { (byN[p.n] = byN[p.n] || []).push(p.item); });
    Object.keys(byN).sort((a, b) => a - b).forEach((n) => {
      const items = byN[n];
      const hit = items.filter((x) => sel.has(x));
      out.push({
        group: '纳贤进度',
        cond: `纳贤 ${n} 令`,
        reward: `${items.join(' / ')}（达标即领）`,
        state: hit.length ? 'in' : 'only',
        note: hit.length ? `已按「纳贤 ${n} 令」路线计入` : '走这条路线才用得上',
      });
    });

    /* 4. 海纳百川 6 选 1 */
    ((nx && nx.haiyou) || []).forEach((h) => {
      const hit = h.items.filter((x) => sel.has(x));
      out.push({
        group: '纳贤进度',
        cond: `纳贤 ${h.n} 令（6 选 1，限 ${h.cap} 次）`,
        reward: h.items.join(' / '),
        state: hit.length ? 'in' : 'only',
        note: hit.length ? '已按该档 6 选 1 计入' : '走这条路线才用得上',
      });
    });

    /* 5. 夺宝累计抽数 → 皮肤 */
    const db = {};
    P.systems.filter((s) => /^db_/.test(s.id)).forEach((s) => {
      (s.progress || []).forEach((p) => {
        if (p.n < 160) return;
        (db[p.n] = db[p.n] || []).push(p.item);
      });
    });
    Object.keys(db).sort((a, b) => a - b).forEach((n) => {
      const items = db[n];
      const hit = items.filter((x) => sel.has(x));
      out.push({
        group: '夺宝进度',
        cond: `狂欢夺宝 ${n} 抽`,
        reward: items.join(' / '),
        state: hit.length ? 'in' : 'only',
        note: hit.length ? '已按「夺宝 ' + n + ' 抽」路线计入' : '走夺宝路线才用得上',
      });
    });

    /* 6. 高档位自选箱 / 福袋 */
    out.push({
      group: '自选箱',
      cond: '每日消费 38888 / 58888',
      reward: '自选宝箱（时欢岁好 / 韶华佳庆）',
      state: 'off',
      note: '箱内容不在本期精测范围，不折算',
    });
    out.push({
      group: '自选箱',
      cond: '每日消费 88888',
      reward: '纳贤武将自选福袋（只对指定 5 将有用）',
      state: 'only',
      note: '指定 5 将之外的目标用不上，不折算',
    });

    return out;
  }

  /* 免费到手（登录 / 任务白送，与「达标才给」分栏） */
  function freeRows(names) {
    const sel = names || [];
    return (P.freeGains || []).map((f) => {
      const limited = !!f.only;
      const on = !limited || f.only.some((x) => sel.includes(x));
      return {
        cur: f.cur, qty: f.qty, from: f.from, only: f.only || null,
        on, note: limited ? `仅 ${f.only.join(' / ')}` : '全目标通用',
      };
    });
  }

  return {
    build, rows, needOf, catalog, reset, tierOf, knotLamps, LBL, KEYS, UNIT,
    ledger, condRows, freeRows, CPN, CPN_KEYS, STATE_TXT,
    SINGLES, singleCost, leftoverPlan,
  };
})();
