/* ============================================================
   精测引擎 v2 —— 中间道具链模型
   目标 →（确定规则）→ 中间道具 × 数量 →（购买优化）→ 元宝
   原则：
   1. 中间道具数量只取活动明示的档位 / 返利阶梯 / 商店标价
   2. 没有保底的才用均值，并显式标注
   3. 纯概率直出（如 0.005% 开盒出武将）不算成本，只作参考列出
   ============================================================ */

const E = {};
(function () {
  const P = window.PRESET;
  const ceilE = (x) => Math.ceil(x - 1e-9);

  E.fmt = (n, d = 0) => {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (d) return n.toFixed(d);
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  E.yuan = (yb) => (isFinite(yb) ? yb / (P.meta.rmbPer100 * 100) : Infinity);

  /* ============================================================
     一、购买组合最优：买 N 个「系统单位」最少花多少元宝
     ============================================================ */
  const buyCache = new Map();
  E.buyCost = function (sys, units, ctx) {
    units = Math.max(0, ceilE(units));
    if (units === 0) return { yb: 0, uni: 0, picks: [], units: 0, over: 0 };
    const key = sys.id + ':' + units + ':' + ctx.days;
    if (buyCache.has(key)) return buyCache.get(key);

    const opts = (sys.buys || [{ qty: 1, price: sys.price || 0 }]).map((o) => ({
      ...o,
      cur: o.cur || '元宝',
      cap: o.maxTotal > 0 ? o.maxTotal : (o.perDay > 0 ? o.perDay * ctx.days : Infinity),
    })).filter((o) => o.qty > 0 && o.price > 0);
    if (!opts.length) return { yb: 0, uni: 0, picks: [], units: 0, over: 0 };

    const maxQ = Math.max(...opts.map((o) => o.qty));
    const V = units + maxQ;
    let dp = new Float64Array(V + 1).fill(Infinity);
    let uni = new Float64Array(V + 1);
    dp[0] = 0;
    const choice = [];

    for (const o of opts) {
      const cap = o.cap === Infinity ? Math.ceil(V / o.qty) : Math.min(o.cap, Math.ceil(V / o.qty));
      const ndp = dp.slice(), nuni = uni.slice();
      const ch = new Int32Array(V + 1);
      for (let v = 0; v <= V; v++) {
        if (dp[v] === Infinity) continue;
        const maxc = Math.min(cap, Math.floor((V - v) / o.qty));
        for (let k = 1; k <= maxc; k++) {
          const nv = v + o.qty * k;
          const cost = dp[v] + o.price * k;
          if (cost < ndp[nv] - 1e-9) {
            ndp[nv] = cost;
            nuni[nv] = uni[v] + (o.cur === '通用元宝' ? o.price * k : 0);
            ch[nv] = k;
          }
        }
      }
      dp = ndp; uni = nuni; choice.push(ch);
    }

    let best = units;
    for (let v = units; v <= V; v++) if (dp[v] < dp[best] - 1e-9) best = v;
    if (!isFinite(dp[best])) return { yb: Infinity, uni: 0, picks: [], units, over: 0 };

    const picks = [];
    let v = best;
    for (let i = opts.length - 1; i >= 0; i--) {
      const k = choice[i][v];
      if (k > 0) {
        const o = opts[i];
        picks.push({
          label: o.label || `${o.qty}单位/单`, n: k, units: k * o.qty,
          cost: o.price * k, cur: o.cur,
        });
        v -= o.qty * k;
      }
    }
    picks.sort((a, b) => a.cost / a.units - b.cost / b.units);
    const res = { yb: dp[best], uni: uni[best], picks, units: best, over: best - units };
    buyCache.set(key, res);
    return res;
  };

  /* ============================================================
     二、中间道具的定义（本期）
     每个中间道具说明「怎么来」和「是否确定」
     ============================================================ */
  const CUR_DEF = {
    '纳贤令': {
      basis: 'exact',
      get: '累计纳贤次数达标即领武将',
      note: '令是共用资源，各武将进度独立计数',
    },
    '传世宝玉': {
      basis: 'exact',
      get: '每累计开盒 50 个返 1 宝玉',
      note: '阶梯返利，不依赖随机掉落',
    },
    '同心结': {
      basis: 'exact',
      get: '累计祈福积分档位奖励',
      note: '积分 = 灯数，档位固定',
    },
    '绸缎': {
      basis: 'avg',
      get: '每次寻觅 8% 概率获得绸缎 6~15',
      note: '无保底，只能按平均 0.84/抽 估',
    },
    '如意莲': {
      basis: 'avg',
      get: '签筒中未中大奖的签产出如意莲',
      note: '不放回抽取，均值与最差值都给',
    },
    '狂欢水晶球': {
      basis: 'exact',
      get: '单笔充值档位赠送',
      note: '按档位组合求最少实付',
    },
    '狂欢夺宝券': {
      basis: 'exact',
      get: '累计夺宝次数档位',
      note: '抽数达标即领',
    },
  };
  E.CUR_DEF = CUR_DEF;

  /* 活动白送的中间道具（登录勋章、任务），用于抵扣购买量 */
  function freeOf(cur, names) {
    let q = 0;
    (P.freeGains || []).forEach((f) => {
      if (f.cur !== cur) return;
      if (f.only) {
        const list = names || [];
        if (list.some((n) => f.only.includes(n))) q += f.qty;
        return;
      }
      q += f.qty;
    });
    return q;
  }
  E.freeOf = freeOf;

  /* ============================================================
     三、宝玉：宝玉数 → 盒数（纯阶梯，确定性）
     ============================================================ */
  const jadeCache = new Map();
  E.jadePlan = function (needJade, ctx) {
    needJade = Math.max(0, ceilE(needJade));
    if (!needJade) return { jade: 0, boxes: 0, yb: 0, uni: 0, picks: [], alloc: [], ok: true };
    const key = 'jade2:' + needJade + ':' + ctx.days;
    if (jadeCache.has(key)) return jadeCache.get(key);

    const boxes = P.systems.filter((s) => s.pool === 'jade' && s.mile);
    const totalCap = boxes.reduce((a, s) => a + s.mile.cap, 0);

    // DP：把 needJade 个宝玉分配给各礼盒，每个礼盒 k 个玉 = k*50 盒
    const N = Math.min(needJade, totalCap);
    let dp = new Float64Array(N + 1).fill(Infinity);
    dp[0] = 0;
    const choice = [];
    for (const s of boxes) {
      const ndp = dp.slice();
      const ch = new Int32Array(N + 1);
      for (let j = 0; j <= N; j++) {
        if (dp[j] === Infinity) continue;
        for (let k = 1; k <= s.mile.cap && j + k <= N; k++) {
          const c = E.buyCost(s, k * s.mile.every, ctx);
          if (!isFinite(c.yb)) continue;
          if (dp[j] + c.yb < ndp[j + k] - 1e-9) { ndp[j + k] = dp[j] + c.yb; ch[j + k] = k; }
        }
      }
      dp = ndp; choice.push(ch);
    }

    let bestJ = N;
    for (let j = N; j >= 0; j--) if (dp[j] < Infinity) { bestJ = j; break; }
    if (!isFinite(dp[bestJ])) {
      const res = { jade: needJade, boxes: 0, yb: Infinity, uni: 0, picks: [], alloc: [], ok: false, cap: totalCap };
      jadeCache.set(key, res);
      return res;
    }

    const alloc = [];
    let j = bestJ;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const k = choice[i][j];
      if (k > 0) {
        alloc.push({ sys: boxes[i], jade: k, boxes: k * boxes[i].mile.every });
        j -= k;
      }
    }
    alloc.reverse();

    const picks = [];
    let yb = 0, uni = 0;
    alloc.forEach((a) => {
      const c = E.buyCost(a.sys, a.boxes, ctx);
      yb += c.yb; uni += c.uni;
      c.picks.forEach((p) => picks.push({ ...p, label: `${a.sys.name} · ${p.label}` }));
    });

    const res = {
      jade: bestJ, boxes: alloc.reduce((a, x) => a + x.boxes, 0),
      yb, uni, picks, alloc, ok: bestJ >= needJade, cap: totalCap,
    };
    jadeCache.set(key, res);
    return res;
  };

  /* ============================================================
     四、祈福：同心结 → 灯（累计积分档位，确定性）
     ============================================================ */
  function kMile() {
    const s = P.systems.find((x) => x.id === 'qifu');
    return (s && s.knotMile) || [];
  }
  // 只统计确定档位（不含概率掉落）
  function knotExact(lamps) {
    let s = 0;
    for (const [need, knot] of kMile()) if (lamps >= need) s += knot;
    return s;
  }
  // 含「每灯额外同心结」的均值估算
  function knotAvg(lamps, ctx) {
    return knotExact(lamps) + lamps * (ctx.params.qifuExtraKnot || 0);
  }
  E.knotExact = knotExact;
  E.knotAvg = knotAvg;

  /* 口径：祈福每灯固定 1 同心结（灯 = 结 1:1）。
     累计积分档位送的结是确定的额外收益，只当上界参考、不拿来抵扣灯数（保守）。 */
  E.knotPlan = function (knots, ctx, freeLamps) {
    knots = Math.max(0, knots);
    freeLamps = freeLamps || 0;
    if (!knots) return { lamps: 0, lampsExact: 0, lampsAvg: 0, yb: 0, uni: 0, picks: [], ok: true, free: 0, buy: 0 };
    const rate = (ctx.params && ctx.params.qifuExtraKnot) || 1;
    const maxNeed = Math.max(...kMile().map((x) => x[0]), 1500);
    const capExact = knotExact(maxNeed);

    /* 1 灯 = 1 结：这是唯一口径 */
    const lamps = Math.ceil(knots / rate - 1e-9);
    /* 累计档位口径只用于展示「最坏情况下也够」 */
    let lampsMile = null;
    for (let n = 1; n <= maxNeed; n++) if (knotExact(n) >= knots) { lampsMile = n; break; }

    const sys = P.systems.find((s) => s.id === 'qifu');
    const buy = Math.max(0, lamps - freeLamps);
    const c = E.buyCost(sys, buy, ctx);
    return {
      lamps, lampsExact: lampsMile, lampsAvg: null, free: Math.min(freeLamps, lamps), buy,
      yb: c.yb, uni: c.uni, picks: c.picks,
      ok: true, capExact, mileLamps: lampsMile,
    };
  };

  /* ============================================================
     五、绸缎：绸缎数 → 寻觅次数（无保底，均值）
     ============================================================ */
  E.satinPlan = function (needSatin, ctx, freeDraws) {
    const sys = P.systems.find((s) => s.id === 'jinxiu');
    const per = sys.satinEv;                       // 每抽平均绸缎
    const draws = ceilE(needSatin / per);
    freeDraws = Math.min(freeDraws || 0, draws);
    const c = E.buyCost(sys, draws - freeDraws, ctx);
    return { draws, per, free: freeDraws, buy: draws - freeDraws, yb: c.yb, uni: c.uni, picks: c.picks, basis: 'avg' };
  };

  /* ============================================================
     六、签筒：如意莲 → 签数（不放回，均值 + 最差）
     ============================================================ */
  function tubeStat(t) {
    const non = t.N - t.prizes;
    const L = t.lian;
    const avg = (L.nBig * L.big + L.nMid * L.mid + L.nSmall * L.small) / Math.max(non, 1);
    return { avg, worst: Math.min(L.big, L.mid, L.small), non };
  }
  E.tubeStat = tubeStat;

  E.lianPlan = function (needLian, ctx, freeSigns) {
    freeSigns = freeSigns || 0;
    let best = null;
    for (const sys of P.systems.filter((s) => s.kind === 'tube')) {
      const st = tubeStat(sys.tube);
      const drawsAvg = ceilE(needLian / st.avg);
      const drawsWorst = ceilE(needLian / st.worst);
      if (drawsAvg > st.non) continue;
      // 只有凡木签能用免费凡木签抵扣
      const free = sys.id.indexOf('tube_fm') === 0 ? Math.min(freeSigns, drawsAvg) : 0;
      const c = E.buyCost(sys, drawsAvg - free, ctx);
      if (!isFinite(c.yb)) continue;
      const cand = {
        sys, draws: drawsAvg, drawsWorst, per: st.avg, worstPer: st.worst,
        free, buy: drawsAvg - free,
        yb: c.yb, uni: c.uni, picks: c.picks,
        maxLian: st.avg * st.non,
      };
      if (!best || cand.yb < best.yb) best = cand;
    }
    return best;
  };

  /* ============================================================
     七、水晶球：充值档位 → 水晶球
     ============================================================ */
  const crysCache = new Map();
  E.chargeForCrystals = function (need, ctx) {
    const key = 'cry:' + need;
    if (crysCache.has(key)) return crysCache.get(key);
    const tiers = P.chargeTiers
      .map((t) => ({ ...t, crystals: (t.gives && t.gives['狂欢水晶球']) || t.crystals || 0 }))
      .filter((t) => t.crystals > 0).map((t) => ({
        ...t,
        cap: t.maxTotal != null ? t.maxTotal : (t.perDay != null ? t.perDay * ctx.days : 1),
      }));
    if (!tiers.length) return { yb: Infinity, crystals: 0, picks: [] };
    const V = need + Math.max(...tiers.map((t) => t.crystals));
    const dp = new Float64Array(V + 1).fill(Infinity);
    dp[0] = 0;
    const choice = [];
    for (const t of tiers) {
      const ndp = dp.slice();
      const ch = new Int32Array(V + 1);
      for (let v = 0; v <= V; v++) {
        if (dp[v] === Infinity) continue;
        const maxc = Math.min(t.cap, Math.floor((V - v) / t.crystals));
        for (let k = 1; k <= maxc; k++) {
          const nv = v + t.crystals * k;
          const cost = dp[v] + t.need * k;
          if (cost < ndp[nv] - 1e-9) { ndp[nv] = cost; ch[nv] = k; }
        }
      }
      dp.set(ndp);
      choice.push(ch);
    }
    let best = need;
    for (let v = need; v <= V; v++) if (dp[v] < dp[best] - 1e-9) best = v;
    if (!isFinite(dp[best])) return { yb: Infinity, crystals: 0, picks: [] };
    const picks = [];
    let v = best;
    for (let i = tiers.length - 1; i >= 0; i--) {
      const k = choice[i][v];
      if (k > 0) {
        const t = tiers[i];
        picks.push({ label: `单笔充值 ${E.fmt(t.need)} 元宝`, n: k, units: t.crystals * k, cost: t.need * k, extra: t.extra });
        v -= t.crystals * k;
      }
    }
    const res = { yb: dp[best], crystals: best, picks };
    crysCache.set(key, res);
    return res;
  };

  /* ============================================================
     八、目标库
     ============================================================ */
  function guessCat(name) {
    if (/水晶/.test(name)) return '动态水晶';
    if (/\*/.test(name)) return '皮肤';
    return '武将';
  }
  E.buildLibrary = function () {
    const lib = new Map();
    const add = (name, cat, src) => {
      if (!name) return null;
      if (!lib.has(name)) lib.set(name, { id: name, name, cat: cat || guessCat(name), srcs: [] });
      const t = lib.get(name);
      if (cat && cat !== '武将') t.cat = cat;
      if (src) t.srcs.push(src);
      return t;
    };
    P.shops.forEach((sh) => sh.items.forEach((it) => add(it.name, it.cat, { shop: sh.id, cost: it.cost, currency: sh.currency })));
    P.systems.forEach((sys) => {
      (sys.progress || []).forEach((pr) => add(pr.item, null, { sys: sys.id, at: pr.n }));
      (sys.haiyou || []).forEach((h) => h.items.forEach((it) => add(it, null, { sys: sys.id, at: h.n })));
      if (sys.kind === 'tube') add(sys.tube.jackpot, null, { sys: sys.id, tube: true });
    });
    P.directSales.forEach((d) => add(d.name, d.cat, { sale: d.price, free: d.free }));
    P.consumeRewards.forEach((c) => add(c.name, null, { consume: c.need }));

    /* 皮肤不再混成一类：按获取途径拆成 转盘 / 锦绣 / 直售
       转盘 = 狂欢夺宝的三个转盘（db_*）；锦绣 = 锦绣霓裳商店（绸缎） */
    lib.forEach((t) => {
      if (t.cat !== '皮肤') return;
      const srcs = t.srcs || [];
      if (srcs.some((s) => s.sys && /^db_/.test(s.sys))) t.cat = '转盘皮肤';
      else if (srcs.some((s) => s.shop === 'jinxiu')) t.cat = '锦绣皮肤';
      else if (srcs.some((s) => s.sale != null)) t.cat = '直售皮肤';
      else if (/印|丹|令|宝箱|碎片/.test(t.name)) t.cat = '道具';
    });
    return lib;
  };

  /* ============================================================
     九、单个目标的获取路线（中间道具链）
     ============================================================ */
  E.routesFor = function (target, ctx) {
    const name = target.name;
    const routes = [];
    const push = (r) => { if (r && isFinite(r.costEv.yb)) routes.push(r); };

    /* ---- 9.1 累计进度（纳贤令 / 夺宝抽数） ---- */
    P.systems.forEach((sys) => {
      (sys.progress || []).forEach((pr) => {
        if (pr.item !== name) return;
        const freeCur = sys.freeCur || sys.unit;
        const free = Math.floor(freeOf(freeCur, [name]) / (sys.freePer || 1));
        const buy = Math.max(0, pr.n - free);
        const c = E.buyCost(sys, buy, ctx);
        push({
          key: 'prog:' + sys.id, kind: 'progress', sysId: sys.id, sysName: sys.name,
          target: name, basis: 'exact',
          label: `${sys.unit} ${pr.n} 个（免费 ${free}，需买 ${buy}）`,
          chain: [
            { cur: sys.unit, qty: pr.n, note: `累计达标即领；免费 ${free}` },
            { cur: sys.unit, qty: buy, buy: true, note: buy ? `${freeCur} 已抵扣` : '白嫖' },
            { cur: '元宝', qty: c.yb },
          ],
          curName: sys.unit, curQty: pr.n, freeQty: free, buyQty: buy,
          costEv: { yb: c.yb, uni: c.uni }, costMax: { yb: c.yb, uni: c.uni },
          picks: c.picks,
          note: `${sys.unit}×${pr.n} = 必然获得${free ? `；活动白送 ${free}` : ''}`,
        });
      });
    });

    /* ---- 9.2 海纳百川（累计达标，6 选 1） ---- */
    const nx = P.systems.find((s) => s.id === 'naxian');
    if (nx && nx.haiyou) {
      nx.haiyou.forEach((h) => {
        if (!h.items.includes(name)) return;
        const free = freeOf('纳贤令', [name]);
        const buy = Math.max(0, h.n - free);
        const c = E.buyCost(nx, buy, ctx);
        push({
          key: 'haiyou:' + h.n, kind: 'progress', sysId: 'naxian', sysName: '海纳百川',
          target: name, basis: 'exact',
          label: `纳贤令 ${h.n} 个（6选1，免费 ${free}，需买 ${buy}）`,
          chain: [
            { cur: '纳贤令', qty: h.n, note: `累计 ${h.n} 次，${h.items.length} 选 1` },
            { cur: '纳贤令', qty: buy, buy: true, note: `免费 ${free}` },
            { cur: '元宝', qty: c.yb },
          ],
          curName: '纳贤令', curQty: h.n, freeQty: free, buyQty: buy,
          costEv: { yb: c.yb, uni: c.uni }, costMax: { yb: c.yb, uni: c.uni },
          picks: c.picks, note: `${h.n} 令 6 选 1（限 ${h.cap} 次）`,
        });
      });
    }

    /* ---- 9.3 珍宝商店（宝玉 → 开盒） ---- */
    const jadeShop = P.shops.find((s) => s.id === 'jade');
    const jadeItem = jadeShop && jadeShop.items.find((x) => x.name === name);
    if (jadeItem) {
      const j = E.jadePlan(jadeItem.cost, ctx);
      if (j.ok) {
        push({
          key: 'jade', kind: 'jade', sysId: 'jade', sysName: '珍宝商店',
          target: name, basis: 'exact',
          label: `${jadeItem.cost} 宝玉 → 开盒 ${j.boxes}`,
          chain: [
            { cur: '传世宝玉', qty: jadeItem.cost, note: '商店标价' },
            { cur: '礼盒', qty: j.boxes, note: '每 50 盒返 1 玉' },
            { cur: '元宝', qty: j.yb },
          ],
          curName: '传世宝玉', curQty: jadeItem.cost,
          costEv: { yb: j.yb, uni: j.uni }, costMax: { yb: j.yb, uni: j.uni },
          picks: j.picks,
          note: j.alloc.map((a) => `${a.sys.name} ${a.boxes}盒`).join(' + '),
          alloc: j.alloc,
        });
      }
    }

    /* ---- 9.4 祈福商城（同心结 → 灯） ---- */
    const qfShop = P.shops.find((s) => s.id === 'qifu');
    const qfItem = qfShop && qfShop.items.find((x) => x.name === name);
    if (qfItem) {
      const freeL = freeOf('祈福灯', [name]);
      const q = E.knotPlan(qfItem.cost, ctx, freeL);
      if (q.lamps) {
        push({
          key: 'knot', kind: 'knot', sysId: 'qifu', sysName: '祈福商城',
          target: name, basis: 'exact',
          label: `${qfItem.cost} 同心结 → ${q.lamps} 灯（免费 ${q.free}，需买 ${q.buy}）`,
          chain: [
            { cur: '同心结', qty: qfItem.cost, note: '商店标价' },
            { cur: '祈福灯', qty: q.lamps, note: '1 灯 = 1 结（固定口径）' },
            { cur: '祈福灯', qty: q.buy, buy: true, note: `免费 ${q.free}` },
            { cur: '元宝', qty: q.yb },
          ],
          curName: '同心结', curQty: qfItem.cost, freeQty: q.free, buyQty: q.buy,
          costEv: { yb: q.yb, uni: q.uni },
          costMax: { yb: q.yb, uni: q.uni },
          picks: q.picks,
          note: '1 灯 = 1 结（累计积分档位送的结算额外收益，不抵扣灯数）',
        });
      }
    }

    /* ---- 9.5 锦绣商店（绸缎 → 寻觅） ---- */
    const jxShop = P.shops.find((s) => s.id === 'jinxiu');
    const jxItem = jxShop && jxShop.items.find((x) => x.name === name);
    if (jxItem) {
      const freeD = freeOf('锦绣', [name]);
      const s = E.satinPlan(jxItem.cost, ctx, freeD);
      push({
        key: 'satin', kind: 'satin', sysId: 'jinxiu', sysName: '锦绣商店',
        target: name, basis: 'avg',
        label: `${jxItem.cost} 绸缎 → ${s.draws} 抽（免费 ${s.free}，需买 ${s.buy}）`,
        chain: [
          { cur: '绸缎', qty: jxItem.cost, note: '商店标价' },
          { cur: '锦绣', qty: s.draws, note: `每抽约 ${s.per} 绸缎` },
          { cur: '锦绣', qty: s.buy, buy: true, note: `免费 ${s.free}` },
          { cur: '元宝', qty: s.yb },
        ],
        curName: '绸缎', curQty: jxItem.cost, freeQty: s.free, buyQty: s.buy,
        costEv: { yb: s.yb, uni: s.uni }, costMax: null,
        picks: s.picks, note: '绸缎无保底，按均值估算',
      });
    }

    /* ---- 9.6 如意商城（如意莲 → 签筒） ---- */
    const ryShop = P.shops.find((s) => s.id === 'ruyi');
    const ryItem = ryShop && ryShop.items.find((x) => x.name === name);
    if (ryItem) {
      const freeS = freeOf('凡木签', [name]);
      const l = E.lianPlan(ryItem.cost, ctx, freeS);
      if (l) {
        push({
          key: 'lian', kind: 'lian', sysId: 'ruyi', sysName: '如意商城',
          target: name, basis: 'avg',
          label: `${E.fmt(ryItem.cost)} 如意莲 → ${l.draws} 签（免费 ${l.free}，需买 ${l.buy}）`,
          chain: [
            { cur: '如意莲', qty: ryItem.cost, note: '商店标价' },
            { cur: '签', qty: l.draws, note: `每签约 ${E.fmt(l.per)} 莲` },
            { cur: '签', qty: l.buy, buy: true, note: `免费 ${l.free}` },
            { cur: '元宝', qty: l.yb },
          ],
          curName: '如意莲', curQty: ryItem.cost, freeQty: l.free, buyQty: l.buy,
          costEv: { yb: l.yb, uni: l.uni }, costMax: null,
          picks: l.picks,
          note: `建议 ${l.sys.name}；最差需 ${l.drawsWorst} 签`,
        });
      }
    }

    /* ---- 9.7 水晶球商店（充值档位） ---- */
    const csShop = P.shops.find((s) => s.id === 'crystal');
    const csItem = csShop && csShop.items.find((x) => x.name === name);
    if (csItem) {
      const c = E.chargeForCrystals(csItem.cost, ctx);
      if (isFinite(c.yb)) {
        push({
          key: 'crystal', kind: 'crystal', sysId: 'crystal', sysName: '水晶球兑换',
          target: name, basis: 'exact',
          label: `${csItem.cost} 水晶球 → 充值 ${E.fmt(c.yb)} 元宝`,
          chain: [
            { cur: '狂欢水晶球', qty: csItem.cost, note: '商店标价' },
            { cur: '实付元宝', qty: c.yb, note: '单笔充值档位组合' },
          ],
          curName: '狂欢水晶球', curQty: csItem.cost,
          costEv: { yb: c.yb, uni: c.yb }, costMax: { yb: c.yb, uni: c.yb },
          picks: c.picks, cash: true,
          note: '充值到账的元宝还能继续花，等于「花 X 元 + 送水晶球」',
        });
      }
    }

    /* ---- 9.8 商城直售 ---- */
    const sale = P.directSales.find((s) => s.name === name);
    if (sale) {
      push({
        key: 'sale', kind: 'sale', sysId: 'sale', sysName: '商城直售',
        target: name, basis: 'exact',
        label: sale.free ? '活动白嫖（皮肤券）' : `直售 ${E.fmt(sale.price)} 元宝`,
        chain: sale.free
          ? [{ cur: '皮肤券', qty: 1, note: '活动任务' }]
          : [{ cur: '直售礼包', qty: 1 }, { cur: '元宝', qty: sale.price }],
        curName: sale.free ? '皮肤券' : '直售礼包', curQty: 1,
        costEv: { yb: sale.price, uni: 0 }, costMax: { yb: sale.price, uni: 0 },
        picks: sale.price ? [{ label: '直售礼包', n: 1, units: 1, cost: sale.price, cur: '元宝' }] : [],
        note: sale.bonus ? `附赠：${sale.bonus}` : '',
      });
    }

    /* ---- 9.9 消费返利 ---- */
    P.consumeRewards.filter((c) => c.name === name).forEach((c) => {
      push({
        key: 'consume', kind: 'consume', sysId: 'consume', sysName: '消费热力',
        target: name, basis: 'exact',
        label: `消费 ${E.fmt(c.need)} 元宝`,
        chain: [
          { cur: '元宝', qty: c.need, note: '消费门槛' },
        ],
        curName: '元宝', curQty: c.need,
        costEv: { yb: c.need, uni: 0 }, costMax: { yb: c.need, uni: 0 },
        picks: [], note: c.note || '消费额不浪费，但需一次性花掉',
      });
    });

    /* ---- 9.10 纯概率直出（仅参考，不参与方案） ---- */
    P.systems.forEach((sys) => {
      let p = 0;
      (sys.table || []).forEach(([n, pp, g]) => { if (g && g[name]) p += pp / 100; });
      if (p > 0) {
        routes.push({
          key: 'gamble:' + sys.id, kind: 'gamble', sysId: sys.id, sysName: sys.name,
          target: name, basis: 'gamble',
          label: `概率直出 ${p}%`,
          chain: sys.kind === 'tube'
            ? [{ cur: '签', qty: sys.tube.N - sys.tube.prizes + 1, note: '不放回，最多抽这么多必中' }]
            : [{ cur: sys.unit, qty: Math.ceil(1 / p), note: '按 1/p 期望' }],
          curName: sys.unit, curQty: Math.ceil(1 / p),
          costEv: { yb: Infinity, uni: 0 }, costMax: null, picks: [],
          probability: p,
          note: '纯概率，无法锁定成本；只作参考',
          hidden: true,
        });
      }
    });

    routes.sort((a, b) => {
      const ha = a.hidden ? 1 : 0, hb = b.hidden ? 1 : 0;
      return ha - hb || a.costEv.yb - b.costEv.yb;
    });
    return routes;
  };

  /* ============================================================
     十、多目标合并：同池中间道具合并计算
     ============================================================ */
  E.plan = function (targets, ctx, pinned) {
    pinned = pinned || {};
    const chosen = targets.map((t) => {
      const all = E.routesFor(t, ctx);
      const rs = all.filter((r) => !r.hidden);
      if (!rs.length) return { target: t, route: null, routes: all, locked: !!pinned[t.name] };
      const key = pinned[t.name];
      const route = (key && rs.find((r) => r.key === key)) || rs[0];
      return { target: t, route, routes: all, locked: !!key };
    });

    const groups = new Map();
    chosen.forEach((c) => {
      if (!c.route) return;
      const g = c.route.key;
      if (!groups.has(g)) {
        groups.set(g, {
          key: g, kind: c.route.kind, sysId: c.route.sysId, sysName: c.route.sysName,
          items: [], curName: c.route.curName, curQty: 0, basis: c.route.basis,
        });
      }
      const grp = groups.get(g);
      grp.items.push(c.target.name);
      grp.curQty += c.route.curQty || 0;
    });

    const lines = [];
    groups.forEach((g) => {
      let costEv = null, costMax = null, picks = [], note = '', label = '', chain = [];
      let freeQty = 0, buyQty = g.curQty;
      const nm = g.items.join(' + ');

      if (g.kind === 'jade') {
        const j = E.jadePlan(g.curQty, ctx);
        costEv = { yb: j.yb, uni: j.uni }; costMax = { yb: j.yb, uni: j.uni };
        picks = j.picks; freeQty = 0; buyQty = g.curQty;
        label = `${j.jade} 宝玉 → 开盒 ${E.fmt(j.boxes)}`;
        chain = [
          { cur: '传世宝玉', qty: j.jade, note: '合计需求' },
          { cur: '礼盒', qty: j.boxes, note: '每 50 盒返 1 玉' },
          { cur: '元宝', qty: j.yb },
        ];
        note = j.alloc.map((a) => `${a.sys.name} ${E.fmt(a.boxes)}盒`).join(' + ');
        if (!j.ok) note = `宝玉上限 ${j.cap}，还差 ${g.curQty - j.cap}`;
      } else if (g.kind === 'knot') {
        const freeL = freeOf('祈福灯', g.items);
        const q = E.knotPlan(g.curQty, ctx, freeL);
        freeQty = q.free; buyQty = q.buy;
        costEv = { yb: q.yb, uni: q.uni };
        const cm = q.lampsAvg
          ? E.buyCost(P.systems.find((s) => s.id === 'qifu'), Math.max(0, q.lampsAvg - freeL), ctx)
          : null;
        costMax = cm ? { yb: cm.yb, uni: cm.uni } : { yb: q.yb, uni: q.uni };
        picks = q.picks;
        label = `${E.fmt(g.curQty)} 同心结 → ${E.fmt(q.lamps)} 灯（免费 ${q.free}，需买 ${q.buy}）`;
        chain = [
          { cur: '同心结', qty: g.curQty, note: '合计需求' },
          { cur: '祈福灯', qty: q.lamps, note: q.lampsExact != null ? '累计积分档位' : '含均值' },
          { cur: '祈福灯', qty: q.buy, buy: true, note: `免费 ${q.free}` },
          { cur: '元宝', qty: q.yb },
        ];
        if (q.lampsAvg && q.lampsAvg !== q.lampsExact) {
          const avgYb = E.buyCost(P.systems.find((s) => s.id === 'qifu'), Math.max(0, q.lampsAvg - freeL), ctx).yb;
          note = `确定 ${q.lampsExact} 灯；若按均值约 ${q.lampsAvg} 灯 = ${E.fmt(avgYb)} 元宝`;
        } else note = '累计积分档位，确定';
      } else if (g.kind === 'satin') {
        const freeD = freeOf('锦绣', g.items);
        const s = E.satinPlan(g.curQty, ctx, freeD);
        freeQty = s.free; buyQty = s.buy;
        costEv = { yb: s.yb, uni: s.uni }; costMax = null;
        picks = s.picks;
        label = `${E.fmt(g.curQty)} 绸缎 → ${s.draws} 抽（免费 ${s.free}，需买 ${s.buy}）`;
        chain = [
          { cur: '绸缎', qty: g.curQty, note: '合计需求' },
          { cur: '锦绣', qty: s.draws, note: `每抽约 ${s.per}` },
          { cur: '锦绣', qty: s.buy, buy: true, note: `免费 ${s.free}` },
          { cur: '元宝', qty: s.yb },
        ];
        note = '绸缎无保底，按均值';
      } else if (g.kind === 'lian') {
        const freeS = freeOf('凡木签', g.items);
        const l = E.lianPlan(g.curQty, ctx, freeS);
        if (l) {
          freeQty = l.free; buyQty = l.buy;
          costEv = { yb: l.yb, uni: l.uni }; costMax = null;
          picks = l.picks;
          label = `${E.fmt(g.curQty)} 如意莲 → ${l.draws} 签（免费 ${l.free}，需买 ${l.buy}）`;
          chain = [
            { cur: '如意莲', qty: g.curQty, note: '合计需求' },
            { cur: '签', qty: l.draws, note: `每签约 ${E.fmt(l.per)} 莲` },
            { cur: '签', qty: l.buy, buy: true, note: `免费 ${l.free}` },
            { cur: '元宝', qty: l.yb },
          ];
          note = `${l.sys.name}；最差 ${l.drawsWorst} 签`;
        }
      } else if (g.kind === 'crystal') {
        const c = E.chargeForCrystals(g.curQty, ctx);
        costEv = { yb: c.yb, uni: c.yb }; costMax = { yb: c.yb, uni: c.yb };
        picks = c.picks;
        label = `${g.curQty} 水晶球 → 充值 ${E.fmt(c.yb)} 元宝`;
        chain = [
          { cur: '狂欢水晶球', qty: g.curQty, note: '合计需求' },
          { cur: '实付元宝', qty: c.yb, note: '充值档位' },
        ];
        note = '充值元宝另到账，可继续消费';
      } else if (g.kind === 'consume') {
        costEv = { yb: g.curQty, uni: 0 }; costMax = { yb: g.curQty, uni: 0 };
        label = `消费 ${E.fmt(g.curQty)} 元宝`;
        chain = [{ cur: '元宝', qty: g.curQty, note: '消费门槛' }];
        note = '消费达标';
      } else if (g.kind === 'sale') {
        const first = chosen.find((c) => c.route && c.route.key === g.key).route;
        costEv = { yb: first.costEv.yb, uni: 0 }; costMax = { yb: first.costEv.yb, uni: 0 };
        picks = first.picks; label = first.label; chain = first.chain;
      } else {
        /* progress：各目标进度独立计数，中间道具数相加；免费量只抵一次 */
        const sys = P.systems.find((s) => s.id === (g.sysId === 'naxian' ? 'naxian' : g.sysId));
        const freeCur = sys.freeCur || sys.unit;
        const free = Math.floor(freeOf(freeCur, g.items) / (sys.freePer || 1));
        const buy = Math.max(0, g.curQty - free);
        const c = E.buyCost(sys, buy, ctx);
        freeQty = Math.min(free, g.curQty); buyQty = buy;
        costEv = { yb: c.yb, uni: c.uni }; costMax = { yb: c.yb, uni: c.uni };
        picks = c.picks;
        label = `${E.fmt(g.curQty)} ${g.curName}（免费 ${freeQty}，需买 ${buy}）`;
        chain = [
          { cur: g.curName, qty: g.curQty, note: '各目标进度独立，数量相加' },
          { cur: g.curName, qty: buy, buy: true, note: `活动白送 ${freeQty}` },
          { cur: '元宝', qty: c.yb },
        ];
        note = `${sys.name} 累计达标`;
      }

      lines.push({
        key: g.key, kind: g.kind, sysName: g.sysName, target: nm,
        label, note, chain, curName: g.curName, curQty: g.curQty,
        freeQty, buyQty, items: g.items, costEv, costMax, picks,
      });
    });

    lines.sort((a, b) => (b.costEv ? b.costEv.yb : 0) - (a.costEv ? a.costEv.yb : 0));

    const totalEv = lines.reduce((a, l) => a + (l.costEv ? l.costEv.yb : 0), 0);
    const totalMax = lines.reduce((a, l) => a + (l.costMax ? l.costMax.yb : l.costEv.yb), 0);
    const universal = lines.reduce((a, l) => a + (l.costEv ? l.costEv.uni : 0), 0);

    return { chosen, lines, totalEv, totalMax, universal };
  };

  /* ============================================================
     十一、充值建议（元宝不足时怎么充最省）
     ============================================================ */
  const chargePlanCache = new Map();
  E.chargePlan = function (needYb, ctx) {
    const key = needYb + ':' + ctx.days;
    if (chargePlanCache.has(key)) return chargePlanCache.get(key);
    const tiers = P.chargeTiers.filter((t) => t.need > 0).map((t) => ({
      ...t, cap: t.maxTotal != null ? t.maxTotal : (t.perDay != null ? t.perDay * ctx.days : 1),
    })).sort((a, b) => b.need - a.need);

    let remain = needYb;
    const picks = [];
    for (const t of tiers) {
      if (remain <= 0) break;
      const n = Math.min(t.cap, Math.floor(remain / t.need));
      if (n > 0) { picks.push({ ...t, n }); remain -= t.need * n; }
    }
    const extra = [];
    if (remain > 0) {
      const free = [64800, 32800, 12800, 6000, 3000, 1200].map((need) => ({ need }));
      const maxV = remain + 64800;
      const dp = new Float64Array(maxV + 1).fill(Infinity);
      const from = new Int32Array(maxV + 1).fill(-1);
      dp[0] = 0;
      for (let v = 0; v <= maxV; v++) {
        if (dp[v] === Infinity) continue;
        for (let i = 0; i < free.length; i++) {
          const nv = v + free[i].need;
          if (nv > maxV) continue;
          const c = dp[v] + free[i].need;
          if (c < dp[nv]) { dp[nv] = c; from[nv] = i; }
        }
      }
      let best = remain;
      for (let v = remain; v <= maxV; v++) if (dp[v] < dp[best]) best = v;
      let v = best;
      const counts = new Map();
      while (v > 0) {
        const i = from[v];
        if (i < 0) break;
        counts.set(free[i].need, (counts.get(free[i].need) || 0) + 1);
        v -= free[i].need;
      }
      [...counts.entries()].sort((a, b) => b[0] - a[0]).forEach(([need, n]) => extra.push({ need, n }));
    }
    const total = picks.reduce((a, p) => a + p.need * p.n, 0) + extra.reduce((a, p) => a + p.need * p.n, 0);
    const res = { picks, extra, total, over: Math.max(0, total - needYb) };
    chargePlanCache.set(key, res);
    return res;
  };

  E.reset = function () { buyCache.clear(); jadeCache.clear(); crysCache.clear(); chargePlanCache.clear(); };
})();

/* 便于测试脚本引用 */
if (typeof window !== "undefined") window.E = E;
