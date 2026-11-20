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
      if (sys.kind === 'box') key = '盒';
      else if (sys.kind === 'qifu') key = '祈福灯';
      else if (sys.kind === 'progress') key = '纳贤令';
      else if (sys.kind === 'jinxiu') key = '锦绣';
      else if (sys.kind === 'gacha') { key = '狂欢夺宝券'; mul = 5; }
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
          /* 能否上抵价券：只看品类（价格门槛在 applyCoupons 里按券的 min 判） */
          c1111: /纳贤|锦绣|夺宝|祈福|招募|大礼包|礼盒/.test((b.label || '') + sys.name),
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
    const nd = {};
    KEYS.forEach((k) => { nd[k] = 0; });
    nd['直购'] = 0;
    const pick = [];
    const jxSys = P.systems.find((s) => s.kind === 'jinxiu');
    const satinEv = (jxSys && jxSys.satinEv) || 0.84;
    const nxSys = P.systems.find((s) => s.kind === 'progress') || {};

    (names || []).forEach((nm) => {
      const cands = [];
      const jd = shopItem('jade', nm);
      if (jd) cands.push({ kind: '盒', qty: jd.cost * 50, via: `宝玉 ${jd.cost} 个`, est: jd.cost * 10000 });
      const qf = shopItem('qifu', nm);
      if (qf) { const l = knotLamps(qf.cost); cands.push({ kind: '祈福灯', qty: l, via: `同心结 ${qf.cost} 个`, est: l * UNIT.祈福灯 }); }
      const nx = (nxSys.progress || []).find((p) => p.item === nm);
      if (nx) cands.push({ kind: '纳贤令', qty: nx.n, via: `纳贤 ${nx.n} 次`, est: nx.n * UNIT.纳贤令 });
      /* 海纳百川 / 特惠精选福袋：累计 N 令后「多选一」，
         成本口径和指定武将一样（都按 N 令算），只是名单不是必得 */
      const hy = (nxSys.haiyou || []).find((h) => h.items.includes(nm));
      if (hy) cands.push({
        kind: '纳贤令', qty: hy.n, via: `纳贤 ${hy.n} 次（${hy.items.length}选1）`,
        est: hy.n * UNIT.纳贤令,
      });
      const jx = shopItem('jinxiu', nm);
      if (jx) { const d = ceil(jx.cost / satinEv); cands.push({ kind: '锦绣', qty: d, via: `绸缎 ${jx.cost} 匹`, est: d * UNIT.锦绣 }); }
      const db = P.systems.filter((s) => s.kind === 'gacha')
        .map((s) => (s.progress || []).find((p) => p.item === nm)).find(Boolean);
      if (db) cands.push({ kind: '狂欢夺宝券', qty: db.n * 5, via: `夺宝 ${db.n} 抽`, est: db.n * 5 * UNIT.狂欢夺宝券 });
      const cr = shopItem('crystal', nm);
      if (cr) cands.push({ kind: '狂欢水晶球', qty: cr.cost, via: `水晶球 ${cr.cost} 个`, est: cr.cost * UNIT.狂欢水晶球 });
      const ds = (P.directSales || []).find((d) => d.name === nm && d.price > 0);
      if (ds) cands.push({ kind: '直购', qty: ds.price, via: '皮肤直售', est: ds.price });
      /* 签筒：不放回抽，筒内签数抽完必出大奖 → 保底次数是确定的 */
      P.systems.filter((s) => s.kind === 'tube' && s.tube && s.tube.jackpot === nm).forEach((s) => {
        const sign = s.tube.sign;
        if (!sign || !sign.price) return;
        const draws = Math.max(1, (s.tube.N || 100) - (s.tube.prizes || 1) + 1);
        cands.push({
          kind: '直购', qty: draws * sign.price, via: `${sign.name} ${draws} 抽`,
          est: draws * sign.price, tube: true,
        });
      });

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

  /* 抵价券 key 列表（按面额从大到小）——不写死，跟着 P.coupons 走 */
  function cpnKeys() {
    return Object.keys(P.coupons || {}).sort((a, b) => (P.coupons[b].face || 0) - (P.coupons[a].face || 0));
  }

  /* 抵价券：一次购买只能用一张 */
  function applyCoupons(dist, pool) {
    const left = {};
    cpnKeys().forEach((k) => { left[k] = (pool && pool[k]) || 0; });
    let save = 0;
    const used = {};
    cpnKeys().forEach((ck) => {
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
  /* 道具折算单价：和倍率页同源（当期商城最低可得价）；rates 尚未加载时回退本地估价 */
  function priceTable() {
    const R = window.RATES;
    if (R && R.unitTable) {
      try { return R.unitTable(); } catch (e) { /* 回退 */ }
    }
    return Object.assign({ 绑定元宝: 1 }, UNIT);
  }

  /* 双倍箱档位只能「道具包 / 换绑元」二选一，先按当单需求静态定一条路线：
       道具包 → 到账 need，返的道具按折算价抵需求
       换绑元 → 到账 need + 绑元，不返道具
     判据是「返利道具对当单值多少钱」vs「绑元面值」，取高的那条。
     券不进这个比较：券已经在 settle 里压过当日实付，再算一次就是双算。 */
  function pickRoute(t, demand, U) {
    if (!t.alt) return { route: 'A', y: t.need, giveVal: 0 };
    const giveVal = Object.keys(t.gives || {}).reduce((a, k) => {
      if (k === '绑定元宝' || (P.coupons && P.coupons[k])) return a;
      if (demand && !demand.has(k)) return a;
      return a + (t.gives[k] || 0) * (U[k] || 0);
    }, 0);
    const bind = t.alt['绑定元宝'] || 0;
    return giveVal > bind
      ? { route: 'A', y: t.need, giveVal }
      : { route: 'B', y: t.need + bind, giveVal: 0 };
  }

  /* opts.fixed：锁定充值组合（「先选充值再选将」用）。
     传进来的每项 {i, n, alt}（i = P.chargeTiers 原始索引）或 {t, n, alt}，
     直接按它摊天，不再走凑额 DP——用户既然选定了档位，就不该被算法改掉。 */
  function chargePlan(ybNeed, opts) {
    const days = opts.days;
    const demand = opts.demand || null;
    const tabs = (P.chargeTiers || []).map((t, i) => ({
      ...t,
      idx: i,
      cap: t.total > 0 ? t.total : (t.perDay ? t.perDay * days : 1),
    })).filter((t) => !(t.onlyDay && t.onlyDay > days));

    let picks = [];
    let covered = 0;   /* 等效购买力累计（DP 约束用） */
    let gotYb = 0;     /* 真实到账元宝 */

    if (opts.fixed && opts.fixed.length) {
      opts.fixed.forEach((x) => {
        const t = x.t || tabs.find((y) => y.idx === x.i)
          || (P.chargeTiers[x.i] ? tabs.find((y) => y.need === P.chargeTiers[x.i].need) : null);
        if (!t) return;
        const n = Math.max(0, Math.floor(x.n == null ? 1 : x.n));
        if (!n) return;
        const nb = Math.min(n, t.cap || n);
        const isAlt = t.alt ? !!x.alt : false;
        picks.push({ t, n: nb, alt: isAlt });
        const y = t.need + (isAlt ? (t.alt['绑定元宝'] || 0) : 0);
        covered += y * nb; gotYb += y * nb;
      });
    } else {

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
          gotYb += pickCh[i].t.need * k;
        }
      }
    }

    /* 其余：以 100 元宝为单位做 DP 凑额。
       每一档先定 A/B 路线，到账多少就按多少算，绝不叠加。 */
    const rest = Math.max(0, ybNeed - covered);
    if (rest > 0) {
      const U2 = priceTable();
      const units = Math.ceil(rest / 100);
      const maxU = units + 1400;
      const dp = new Array(maxU + 1).fill(Infinity);
      dp[0] = 0;
      const chs = [];
      tabs.forEach((t) => {
        const rt = pickRoute(t, demand, U2);
        const y = rt.y / 100;
        const nd = dp.slice();
        const ch = new Array(maxU + 1).fill(0);
        for (let v = 0; v <= maxU; v++) {
          if (dp[v] === Infinity) continue;
          for (let k = 1; k <= Math.min(t.cap, Math.floor((maxU - v) / y)); k++) {
            const nv = v + y * k, cst = dp[v] + t.need * k;
            if (cst < nd[nv] - 1e-9) { nd[nv] = cst; ch[nv] = k; }
          }
        }
        for (let i = 0; i <= maxU; i++) dp[i] = nd[i];
        chs.push({ t, rt, ch });
      });
      let bu = -1;
      for (let v = units; v <= maxU; v++) {
        if (dp[v] === Infinity) continue;
        if (bu < 0 || dp[v] < dp[bu] - 1e-9) bu = v;
      }
      /* 档位总额不够覆盖需求时，退到「最大可达」，余量走直充 */
      if (bu < 0) for (let v = maxU; v >= 0; v--) if (dp[v] < Infinity) { bu = v; break; }
      let spentYb = 0;
      if (bu >= 0) {
        let v = bu;
        for (let i = chs.length - 1; i >= 0; i--) {
          const k = chs[i].ch[v];
          if (k <= 0) continue;
          const { t, rt } = chs[i];
          picks.push({ t, n: k, alt: rt.route === 'B' });
          v -= Math.round(rt.y / 100) * k;
          covered += rt.y * k;
          gotYb += rt.y * k;
          spentYb += rt.y * k;
        }
      }
      /* 直充兜底：1 元 = 100 元宝，无返利，保证任何需求都有解 */
      if (spentYb < rest - 1e-6) {
        const gap = rest - spentYb;
        picks.push({ t: { need: gap, gives: {}, cap: 1, perDay: 0, direct: true }, n: 1 });
        covered += gap; gotYb += gap;
      }
    }

    } /* end else：未锁定充值组合时走凑额 DP */

    const merged = [];
    picks.forEach((x) => {
      const k = merged.find((y) => y.t === x.t && !!y.alt === !!x.alt && !!y.crystal === !!x.crystal);
      if (k) k.n += x.n; else merged.push({ ...x });
    });

    /* 摊到天：每日档从第 1 天起一天一次（守每日限次），限次档压在前几天。
       消费日安排在活动后段（见 solveOnce 的 active），保证「钱先到、再花掉」。 */
    /* 摊到天：每日档从第 1 天起一天一次（守每日限次）；「X 日起」的档不能提前买，
       要从 fromDay 那天开始排；限次档压在前几天。 */
    let cursor = 0;
    merged.forEach((x) => {
      const perDay = x.t.perDay || 0;
      const start = Math.max(0, (x.t.fromDay || 1) - 1);
      const arr = [];
      for (let k = 0; k < x.n; k++) {
        if (perDay) { arr.push((start + cursor) % days); cursor++; }
        else arr.push(Math.min(start + k, days - 1));
      }
      x.days = arr;
    });

    const money = merged.reduce((a, x) => a + x.t.need * x.n, 0) / 100;
    /* 双倍箱二选一：走绑元就只给绑元，走道具包就只给道具，绝不叠加 */
    const gives = {};
    merged.forEach((x) => {
      if (x.alt && x.t.alt) {
        gives['绑定元宝'] = (gives['绑定元宝'] || 0) + (x.t.alt['绑定元宝'] || 0) * x.n;
      } else {
        Object.keys(x.t.gives || {}).forEach((k) => { gives[k] = (gives[k] || 0) + x.t.gives[k] * x.n; });
      }
    });
    return { picks: merged, money, yb: gotYb, gives };
  }

  /* ---------------- 七、总方案 ---------------- */
  /* chargePool：上一轮迭代「充值实际返到的中间产物」（券 + 道具）。
     券进券池压当日实付，道具直接回冲需求 —— 两者都必须进下一轮的算式，
     否则就是「充值送的令只写在账本上，方案照样买满」，报价必然偏高。 */
  function solveOnce(names, opts, chargePool) {
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

    const stockCoupons = Object.assign({ 券1111: 0, 券2888: 0, 券6665: 0 }, opts.stock.coupons || {});

    /* 充值返到的东西拆两路：券 → 券池；道具 → 回冲需求。
       同一 key 只走一路，避免「既当券抵扣、又当道具少买」的双算。 */
    const backCoupons = {};
    const backItems = {};
    Object.keys(chargePool || {}).forEach((k) => {
      if (P.coupons && P.coupons[k]) backCoupons[k] = chargePool[k];
      else if (KEYS.includes(k)) backItems[k] = chargePool[k];
    });
    cpnKeys().forEach((k) => { stockCoupons[k] = (stockCoupons[k] || 0) + (backCoupons[k] || 0); });

    /* 期初存货的中间道具：灯 / 令 直接抵需求；宝玉按 1 玉 = 50 盒折成礼盒。
       存量的宝玉不产生「开盒返玉」，所以抵的是盒数而不是玉数。 */
    const stItems = opts.stock.items || {};
    const stockOf = (k) => {
      if (k === '盒') return (stItems.宝玉 || 0) * 50;
      return stItems[k] || 0;
    };

    let reward = {};
    let best = null;
    /* 每轮的候选：用的返利假设 used / 实际返到的 rw。
       档位返利是「先假设、后兑现」，少买一点档位就掉了，容易在两轮之间来回跳。
       所以不能只取最后一轮——要挑「假设 ≤ 实际」且最便宜的那一轮，
       否则会拿着上一轮的返利去抵这一轮的购买量，方案最后缺几件。 */
    const rounds = [];

    for (let round = 0; round < 6; round++) {
      const need = {};
      KEYS.concat(['直购']).forEach((k) => {
        /* 三层回冲，按「确定性」从高到低扣：存货 → 白送 → 档位返 → 充值返。
           充值返最后扣，因为它的量依赖本轮算出的消费额，只有迭代才收敛。 */
        need[k] = Math.max(0, (need0[k] || 0) - (free[k] || 0) - (reward[k] || 0)
          - stockOf(k) - (backItems[k] || 0));
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
          tgt.packs.push({ id: '__direct', name: '直购', price: directYb, direct: true });
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
      rounds.push({ r: best, used: Object.assign({}, reward), rw: Object.assign({}, pick.rw) });
      const same = KEYS.every((k) => Math.abs((reward[k] || 0) - (next[k] || 0)) < 1e-6);
      reward = next;
      if (same) break;
    }

    /* 只在「这一轮假设的档位返利，这一轮真的返到了」的候选里挑最便宜的。
       全都不自洽（震荡）时退回全部候选，让 shortItems 把这个缺口暴露出来。
       比较用净消费而不是 money：money 要等 chargePlan 才算得出来。 */
    const sound = rounds.filter((c) => KEYS.every((k) => (c.used[k] || 0) <= (c.rw[k] || 0) + 1e-6));
    const pool2 = sound.length ? sound : rounds;
    best = pool2.reduce((a, b) => (b.r.netSpend < a.r.netSpend ? b : a)).r;

    const r = best;
    r.netSpend = Math.max(0, r.netSpend - (opts.stock.yb || 0));
    r.charge = chargePlan(r.netSpend, {
      days: opts.days,
      crystals: r.need['狂欢水晶球'] || 0,
      fixed: opts.lockCharge || null,
      /* 只有「这单确实要用」的品类才算返利价值，否则赠品再贵也不顶钱 */
      demand: new Set(KEYS.filter((k) => (need0[k] || 0) > 0)),
    });
    /* 锁定了充值组合时，要花的有可能超出到账元宝——不阻断，但要让上层能提示 */
    if (opts.lockCharge && opts.lockCharge.length) {
      r.locked = true;
      r.overBudget = Math.max(0, r.netSpend - r.charge.yb);
    }

    const produced = {};
    r.dist.forEach((d) => d.packs.forEach((p) => {
      if (!p.gives) return;
      Object.keys(p.gives).forEach((k) => { produced[k] = (produced[k] || 0) + p.gives[k]; });
    }));
    r.produced = produced;

    /* 充值返利也是来源之一：水晶球只从充值档送，实际买不到，
       不把它算进「已有」就会把整单误判成「本期买不到」 */
    const cGives = (r.charge && r.charge.gives) || {};
    r.audit = KEYS.map((k) => {
      const stockUse = Math.min(stockOf(k), need0[k] || 0);
      /* 充值送的量只有「前面几层还不够」的部分才真正顶用，超出的不算 */
      const room = Math.max(0, (need0[k] || 0) - stockUse - (free[k] || 0) - (r.tierReward[k] || 0));
      const chg = Math.min(cGives[k] || 0, room);
      return {
        key: k, label: LBL[k],
        need: need0[k] || 0,
        stock: stockUse,
        free: free[k] || 0,
        tier: r.tierReward[k] || 0,
        charge: chg,
        buy: produced[k] || 0,
        total: stockUse + (free[k] || 0) + (r.tierReward[k] || 0) + chg + (produced[k] || 0),
      };
    }).filter((x) => x.need > 0);
    /* 本轮假设的充值返利量 vs 实际量：假设不能超过实际，否则核对表会「凑数」。
       券走同一套口径：用掉的券不能超过「期初 + 每日档返 + 充值返」。 */
    r.chargeBack = Object.assign({}, backItems);
    const couponOk = cpnKeys().every((k) => ((r.coupons || {})[k] || 0)
      <= (((opts.stock.coupons || {})[k]) || 0) + (r.tierReward[k] || 0) + (cGives[k] || 0) + 1e-6);
    r.chargeBackOk = couponOk && KEYS.every((k) => (backItems[k] || 0) <= (cGives[k] || 0) + 1e-6);
    r.stockUsed = r.audit.reduce((a, x) => a + x.stock, 0);
    /* 逐项缺口：哪个道具还差多少（比笼统说「无法报价」有用） */
    r.shortItems = r.audit
      .filter((x) => x.total < x.need - 1e-6)
      .map((x) => ({ key: x.key, label: x.label, lack: x.need - x.total, need: x.need, total: x.total }));

    r.extras = KEYS.map((k) => ({
      key: k, label: LBL[k], qty: (free[k] || 0) + (r.tierReward[k] || 0) + (produced[k] || 0),
    })).filter((x) => x.qty > 0 && !r.audit.some((a) => a.key === x.key));

    r.ok = r.audit.every((x) => x.total >= x.need - 1e-6);
    r.money = r.charge.money;
    /* 本期没有购买渠道、只能靠活动白送的品类（换期常见：某期没有珍宝礼盒） */
    const cat = catalog();
    r.unbuyable = KEYS
      .filter((k) => (r.need[k] || 0) - (cGives[k] || 0) > 1e-6
        && !cat.some((p) => p.gives && p.gives[k] > 0))
      .map((k) => ({
        key: k, label: LBL[k],
        need: Math.max(0, (r.need[k] || 0) - (cGives[k] || 0)),
      }));
    /* 目标本身找不到任何渠道（签筒 / 砸蛋 / 绘卷这类未建模玩法）：
       不能静默算成 0 元，必须让上层显示「无法报价」 */
    r.pick = info.pick;
    r.noRoute = info.pick.filter((p) => !p.kind).map((p) => p.name);
    r.priced = info.pick.filter((p) => p.kind).length;
    return r;
  }

  /* 外层：把上一轮「充值实际返到的中间产物」喂回去重算，直到稳定。
     两条反馈线：
       ① 券      → 券池（压低当日实付 → 少充钱）
       ② 道具    → 回冲需求（少买 → 少花 → 再少充）
     收敛用「只减不增」：下一轮假设取 min(上一轮假设, 本轮实际)，
     这样假设永远不会超过实际，核对表不会靠假设凑数。
     最后只接受「假设 ≤ 实际」的自洽解，并在自洽解里取最便宜的那个。 */
  function build(names, opts) {
    const allKeys = cpnKeys().concat(KEYS);
    const cands = [];
    let pool = {};
    for (let i = 0; i < 8; i++) {
      const r = solveOnce(names, opts, pool);
      cands.push({ r, pool: Object.assign({}, pool) });
      const g = (r.charge && r.charge.gives) || {};
      const next = {};
      let same = true;
      allKeys.forEach((k) => {
        const prev = pool[k] == null ? Infinity : pool[k];
        const v = Math.min(prev, g[k] || 0);
        next[k] = v;
        if (Math.abs((pool[k] || 0) - v) > 1e-6) same = false;
        else if (pool[k] == null && v > 0) same = false;
      });
      if (same) break;
      pool = next;
    }
    const good = cands.filter((c) => c.r.chargeBackOk);
    const pool2 = good.length ? good : cands;
    return pool2.reduce((a, b) => (b.r.money < a.r.money - 1e-9 ? b : a)).r;
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
          label: fmt(p.t.need) + (p.crystal ? '（水晶球档）' : p.alt ? '（换绑元）' : ''),
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
  /* 券名跟着 P.coupons 走：每期面额不同（1111/2888/6665 → 2500/1000） */
  const CPN = new Proxy({}, { get: (_, k) => (P.coupons && P.coupons[k] && P.coupons[k].name) || String(k) });
  const CPN_KEYS = {
    get length() { return cpnKeys().length; },
    map: (f) => cpnKeys().map(f),
    forEach: (f) => cpnKeys().forEach(f),
    filter: (f) => cpnKeys().filter(f),
    indexOf: (k) => cpnKeys().indexOf(k),
  };

  /* 抵价券流水：获得（期初 + 每日档位 + 充值档位）= 用掉 + 结余
     结余不再记「沉没」：默认拿去单买灯 / 玉（见 leftoverPlan），券面额是能落地的。 */
  function ledger(r, stock) {
    const st = (stock && stock.coupons) || {};
    const rows = cpnKeys().map((k) => {
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

  /* 结余券的去处：只有当期商城**确实还在卖**灯 / 盒时才成立。
     灯靠「祈福礼包（单灯）」、玉靠「开盒保底」，这两条通道不是每期都有；
     没有通道时算出来的「换 N 盏灯」是凭空捏的路线，不如老老实实说券用不掉。 */
  function leftoverPlan(led) {
    const cat = catalog();
    const lampOk = cat.some((p) => p.gives && p.gives['祈福灯'] > 0);
    const boxOk = cat.some((p) => p.gives && p.gives['盒'] > 0);
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
      lampOk, boxOk,
      /* 两条通道都没有时，结余券就是纯粹用不掉的额度 */
      dead: !lampOk && !boxOk,
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
    ledger, condRows, freeRows, CPN, CPN_KEYS, cpnKeys, STATE_TXT,
    SINGLES, singleCost, leftoverPlan,
  };
})();
