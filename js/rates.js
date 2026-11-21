/* ============================================================
   充值倍率 + 消费返利 + 端到端倍率 + 组合枚举
   回答四个问题：
     ① 哪个充值档位「值」—— 返利道具折成元宝，算倍率（双倍箱二选一必须分开算）
     ② 充完之后花掉，消费档位还能返多少 —— 每日 / 累计消费
     ③ 从本金到最终产物，整体多少倍 —— 端到端，注意这不等于①
     ④ 给定预算，多少种档位、各买几次最优 —— 组合枚举
   折算口径集中在 unitTable()，与该期方案用的单价同源，改一处即可。
   ============================================================ */

window.RATES = (function () {
  const P = window.PRESET;
  const E = window.E;

  /* ---------- 抵价券可用率 ----------
     券是「满 X 减 Y」，能不能用掉取决于当期有没有够门槛的商品，
     所以按面额给一个折扣率，而不是把面额当全额。 */
  const USABLE = { 1111: 0.85, 2888: 0.85, 6665: 0.60 };
  function usableOf(face) {
    if (USABLE[face] != null) return USABLE[face];
    return face >= 6000 ? 0.60 : 0.85;
  }

  /* ---------- 折算单价 ----------
     和「方案里买这些道具实际要花多少钱」同源：取当期商城最低可得单价。
     这样倍率不会因为「单买价 1000 但礼包 370」而虚高。 */
  let _unit = null;
  function unitTable(force) {
    if (_unit && !force) return _unit;
    const out = { 绑定元宝: 1 };
    const cat = (window.SCHED && window.SCHED.catalog) ? window.SCHED.catalog() : [];
    const base = (window.SCHED && window.SCHED.UNIT) || {};
    const KEYS = ['盒', '祈福灯', '纳贤令', '锦绣', '狂欢夺宝券', '狂欢水晶球', '凡木签', '传世宝玉', '金瑶签', '如意签'];
    KEYS.forEach((k) => {
      /* 纳贤令单独口径：每日前两次 200 / 500 元宝是限购特惠，一天只能各买一次，
         不能当成整期的边际价——否则 100 令的价值会被压到 2 万，
         充值返的那几个令也被算得一文不值（600 档的纳贤令价值直接缩水 5 倍）。
         公告里「纳贤令礼包」才是标准标价（1000 元宝 / 个），折算以它为准。 */
      if (k === '纳贤令') {
        const std = cat.find((p) => /纳贤令礼包$/.test(p.name || '') && (p.gives[k] || 0) > 0);
        out[k] = std ? std.price / std.gives[k] : (base[k] && base[k] >= 800 ? base[k] : 1000);
        return;
      }
      /* 夺宝券也走标准口径：商城里「1111夺宝礼包 888 元宝 → 15 券」这种限购特惠
         会把单价压到 59.2，11.16 期更夸张（777 元宝 → 250 券 = 3.1/张）。
         拿它当整期边际价，券就跟白送一样，档位返的券全被算成零头。
         折算按项目既定单价 60（SCHED.UNIT），不跟限购礼包走。 */
      if (k === '狂欢夺宝券') { out[k] = base[k] || 60; return; }
      /* 只认「纯品类包」：组合礼包的价格没法拆到单一品类上 */
      const ps = cat.filter((p) => p.gives && p.gives[k] > 0
        && Object.keys(p.gives).filter((x) => x !== '绑定元宝').length === 1);
      out[k] = ps.length
        ? Math.min(...ps.map((p) => p.price / p.gives[k]))
        : (base[k] || (P.singles && P.singles[k] && P.singles[k].price) || 0);
    });
    /* 签筒的签不在 catalog 里（它是「抽」，不是「买」），单独取价：
       同一签种可能拆成多个筒（金瑶签1/2/3），按名字去序号合并，取最低单价 */
    (P.systems || []).filter((s) => s.kind === 'tube').forEach((s) => {
      const name = (s.name || '').replace(/\d+$/, '').replace(/[０-９]+$/, '');
      const ps = (s.buys || []).filter((b) => b.price > 0 && b.qty > 0);
      if (!name || !ps.length) return;
      const u = Math.min(...ps.map((b) => b.price / b.qty));
      if (!out[name] || u < out[name]) out[name] = u;
    });
    Object.keys(P.coupons || {}).forEach((k) => {
      const c = P.coupons[k] || {};
      out[k] = (c.face || 0) * usableOf(c.face || 0);
    });
    /* 自选福袋折出的定向产出：招募令有商城价 1000/个（武将招募令*10=10000）；
       定向武将无统一标价，按纳贤令标准价估，且只在 sel15 列计入（可选，不算进「不拿纳贤」）。 */
    out['定向招募令'] = 1000;
    out['定向武将'] = out['纳贤令'] || 1000;
    _unit = out;
    return out;
  }
  function resetUnit() { _unit = null; _spendCache = new Map(); }

  /* 把一组 gives 折成元宝价值；skip 里的品类已按现金计，不能重复算 */
  function valOf(gives, skip) {
    const U = unitTable();
    const rows = [];
    let val = 0;
    Object.keys(gives || {}).forEach((k) => {
      const q = gives[k];
      if (!q || (skip && skip.includes(k))) return;
      const u = U[k] || 0;
      rows.push({ k, q, unit: u, val: q * u });
      val += q * u;
    });
    return { rows, val };
  }

  /* ---------- 消费返利 ----------
     每日档位是「当天消费达 X，逐档累计可领」。所以花得越集中，每天命中的档位越高。
     最优打法不是摊平，而是「每天花到刚好够最高一档，剩下的再分一天」。
     天数受活动天数限制。 */
  let _spendCache = new Map();
  function spendRebate(yb, days) {
    days = days || P.meta.days || 9;
    yb = Math.max(0, yb || 0);
    const key = Math.round(yb) + '|' + days;
    if (_spendCache.has(key)) return _spendCache.get(key);

    const tiers = (P.dailyTiers || []).slice().sort((a, b) => a.need - b.need);
    const cums = (P.cumSpend || []).slice().sort((a, b) => a.need - b.need);
    const res = { val: 0, daily: {}, cum: {}, rows: [], cumRows: [], days: 0, perDay: 0, hit: [], cumHit: [] };
    if (yb <= 0 || (!tiers.length && !cums.length)) { _spendCache.set(key, res); return res; }

    /* 集中天数：让每天都能吃到最高档，且不超过活动天数 */
    let n = 1, perDay = yb;
    if (tiers.length) {
      const top = tiers[tiers.length - 1].need;
      if (top > 0 && yb >= top) {
        n = Math.max(1, Math.min(days, Math.floor(yb / top)));
        perDay = yb / n;
      }
    }
    const hit = tiers.filter((t) => t.need <= perDay + 1e-6);
    hit.forEach((t) => {
      Object.keys(t.gives || {}).forEach((k) => {
        res.daily[k] = (res.daily[k] || 0) + (t.gives[k] || 0) * n;
      });
    });
    const cumHit = cums.filter((t) => t.need <= yb + 1e-6);
    cumHit.forEach((t) => {
      Object.keys(t.gives || {}).forEach((k) => {
        res.cum[k] = (res.cum[k] || 0) + (t.gives[k] || 0);
      });
    });

    /* 合并成一张表 */
    const merged = {};
    const addTo = (k, q, src) => {
      if (!merged[k]) merged[k] = { k, q: 0, from: {} };
      merged[k].q += q;
      merged[k].from[src] = (merged[k].from[src] || 0) + q;
    };
    Object.keys(res.daily).forEach((k) => addTo(k, res.daily[k], '每日'));
    Object.keys(res.cum).forEach((k) => addTo(k, res.cum[k], '累计'));

    const U = unitTable();
    let val = 0;
    res.rows = Object.keys(merged).map((k) => {
      const r = merged[k];
      const v = r.q * (U[k] || 0);
      val += v;
      return { k, q: r.q, unit: U[k] || 0, val: v, from: r.from };
    }).sort((a, b) => b.val - a.val);

    res.val = val;
    res.days = n;
    res.perDay = perDay;
    res.hit = hit.map((t) => t.need);
    res.cumHit = cumHit.map((t) => t.need);
    _spendCache.set(key, res);
    return res;
  }

  function condText(t, days) {
    const p = [];
    if (t.perDay) p.push(`每日 ${t.perDay} 次（${days} 天共 ${t.perDay * days} 次）`);
    else if (t.onlyDay) p.push('仅首日 1 次');
    else if (t.fromDay) p.push('11/8 起 1 次');
    if (t.total != null && !t.fromDay) p.push(t.alt ? `整期 ${t.total} 次（11/8 重置）` : `整期 ${t.total} 次`);
    if (t.alt) p.push('双倍箱二选一');
    return p.join(' · ') || '整期 1 次';
  }

  /* ---------- 单档倍率 ----------
     双倍箱（alt）是「道具包 或 绑元」二选一，必须分开算：
       路线A（道具）：到账 need + 道具返利折算
       路线B（绑元）：到账 need + alt绑元，返利为 0
     老版本把两条加在一起，128/328/648 三档倍率虚高约一倍。 */
  function tierList(days) {
    days = days || P.meta.days || 9;
    return (P.chargeTiers || []).map((t, i) => {
      /* onceGives = 整期限1次的奖励（如「单笔3000·小雪大红包，限完成1次」）。
         它不随档位购买次数累乘，所以单独折一份价值。
         以前漏掉它会导致单档倍率偏低；更早以前把它并进 gives，
         才会出现 ¥30×7 把 6150 红包算成 43050 的重复参与。 */
      const A = valOf(t.gives);
      const O = valOf(t.onceGives || {});
      const onceVal = O.val;
      const altBind = t.alt ? (t.alt['绑定元宝'] || 0) : 0;
      const B = t.alt ? valOf(t.alt, ['绑定元宝']) : null;

      /* rebVal 只放「可随购买次数累加」的返利，供 DP 里 rebVal×k 用；
         限1次价值单独走 onceVal（每档只计1份），不进 rebVal，避免多买时重复累加。 */
      const routeA = { yb: t.need, reb: A.rows, rebVal: A.val, total: t.need + A.val };
      const routeB = B ? { yb: t.need + altBind, reb: B.rows, rebVal: B.val, total: t.need + altBind + B.val } : null;
      const bestRoute = routeB && routeB.total > routeA.total + 1e-9 ? 'B' : 'A';
      const pickR = bestRoute === 'B' ? routeB : routeA;
      const altBetter = bestRoute === 'B';

      const tag = t.onlyDay ? '首日'
        : t.fromDay ? (t.fromDay === 2 ? '11/8起' : `第${t.fromDay}天起`)
        : t.perDay ? '每日'
        : t.total != null ? `共${t.total}次` : '1次';

      /* 推荐上限 prefCap：阶梯方案里每档买几次，和真实 cap（全买满用）分开。
         纯绑元档（gives 只有绑定元宝，倍率恒定 2.0×，没有券/令/抽将道具）
         买多次不产生任何额外奖励、纯粹凑金额，所以限 1 次；
         带券/纳贤令/红包等额外奖励的每日档可买多次（上限 3），
         让方案靠「多加几个不同档位」堆金额，而不是把单一低倍率档买到天花板。 */
      const giveKeys = Object.keys(t.gives || {}).filter((k) => (t.gives[k] || 0) > 0);
      const hasExtra = giveKeys.some((k) => k !== '绑定元宝' && !/红包/.test(k));
      const onceKeys = Object.keys(t.onceGives || {}).filter((k) => (t.onceGives[k] || 0) > 0);
      const hasOnceExtra = onceKeys.some((k) => k !== '绑定元宝' && !/红包/.test(k));
      const realCap = t.total != null ? t.total : (t.perDay ? t.perDay * days : 1);
      const prefCap = (hasExtra || hasOnceExtra) ? Math.min(realCap, 3) : Math.min(realCap, 1);

      return {
        i, need: t.need, rmb: t.need / 100, yb: pickR.yb, reb: pickR.reb, rebVal: pickR.rebVal,
        prefCap,
        /* 单档展示的 total/ratio 要含限1次价值（充1次就能领），但 DP 累加用 rebVal，
           两者刻意分开：onceVal 不进 rebVal，避免买 N 次被算成 N 份。 */
        onceVal,
        total: pickR.total + onceVal,
        ratio: t.need > 0 ? (pickR.total + onceVal) / t.need : 0,
        tag,
        altBind, altYb: routeB ? routeB.yb : 0,
        /* capYb = 这个档位最多能拿到多少「可花元宝」——双倍箱选绑元时是 2 倍本金。
           凑额 DP 要用它，否则「要花 40 万元宝」会被判成买不到。 */
        capYb: Math.max(routeA.yb, routeB ? routeB.yb : 0),
        routeA, routeB, bestRoute, altBetter,
        cap: realCap,
        cond: condText(t, days),
        altText: altBind
          ? `二选一：道具包合计 ${E.fmt(Math.round(routeA.total))} 元宝价值（${(routeA.total / t.need).toFixed(2)}×），或换绑元×${E.fmt(altBind)} 到账 ${E.fmt(routeB.yb)}（${(routeB.total / t.need).toFixed(2)}×）`
          : '',
        note: t.note || '',
      };
    });
  }

  /* 性价比排行：倍率从高到低；同时标出「首充档 / 每日必买档」 */
  function rank(days) {
    const rows = tierList(days).slice().sort((a, b) => b.ratio - a.ratio);
    return rows.map((r, i) => {
      const tags = [];
      if (i === 0) tags.push('最高倍率');
      if (r.need === 1200 && r.cap === 1 && r.reb.some((x) => /^券/.test(x.k))) tags.push('首充档');
      if (r.need === 3000 || r.need === 6000) tags.push('每日必买档');
      return { ...r, place: i + 1, badge: tags.join(' · ') };
    });
  }

  /* ---------- 凑额 DP：给定要花掉的元宝 x，最少人民币 ---------- */
  const CMP = {
    cost: (a, b) => (a.cost - b.cost) || (a.cnt - b.cnt) || (b.reb - a.reb),
    cnt: (a, b) => (a.cnt - b.cnt) || (a.cost - b.cost) || (b.reb - a.reb),
    reb: (a, b) => (b.reb - a.reb) || (a.cost - b.cost) || (a.cnt - b.cnt),
  };

  function solve(x, days, mode, capMoney) {
    x = Math.max(0, Math.ceil(x));
    const capYb = capMoney != null ? capMoney * 100 : Infinity;
    const tiers = tierList(days).filter((t) => t.cap > 0);
    if (!tiers.length) return null;
    /* 容量用 capYb：凑额问的是「怎么凑出这么多可花元宝」，
       双倍箱选绑元时一档能当两档用，不能只按道具路线的到账算 */
    const uv = tiers.map((t) => Math.round(t.capYb / 100));
    const N = uv.reduce((a, u, i) => a + u * tiers[i].cap, 0) + 1;

    let cost = new Float64Array(N).fill(Infinity);
    let cnt = new Float64Array(N).fill(Infinity);
    let reb = new Float64Array(N).fill(-Infinity);
    cost[0] = 0; cnt[0] = 0; reb[0] = 0;
    const snap = [{ cost: cost.slice(), cnt: cnt.slice(), reb: reb.slice() }];

    for (let i = 0; i < tiers.length; i++) {
      const nc = cost.slice(), nn = cnt.slice(), nr = reb.slice();
      for (let v = 0; v < N; v++) {
        if (cost[v] === Infinity) continue;
        for (let k = 1; k <= tiers[i].cap; k++) {
          const nv = v + uv[i] * k;
          if (nv >= N) break;
          const c = cost[v] + tiers[i].need * k;
          const n2 = cnt[v] + k;
          const r2 = reb[v] + tiers[i].rebVal * k;
          const better = c < nc[nv] - 1e-9
            || (Math.abs(c - nc[nv]) < 1e-9 && (n2 < nn[nv]
              || (n2 === nn[nv] && r2 > nr[nv] + 1e-9)));
          if (better) { nc[nv] = c; nn[nv] = n2; nr[nv] = r2; }
        }
      }
      cost = nc; cnt = nn; reb = nr;
      snap.push({ cost: cost.slice(), cnt: cnt.slice(), reb: reb.slice() });
    }

    const U = Math.max(0, Math.ceil(x / 100));
    if (U >= N) return null;
    const better = CMP[mode] || CMP.cost;
    let bv = -1;
    for (let v = U; v < N; v++) {
      if (cost[v] === Infinity) continue;
      if (cost[v] > capYb + 1e-9) continue;
      if (bv < 0) { bv = v; continue; }
      const a = { cost: cost[v], cnt: cnt[v], reb: reb[v] };
      const b = { cost: cost[bv], cnt: cnt[bv], reb: reb[bv] };
      if (better(a, b) < 0) bv = v;
    }
    if (bv < 0) return null;

    const picks = [];
    let v = bv;
    for (let i = tiers.length - 1; i >= 0; i--) {
      const prev = snap[i];
      let got = 0;
      for (let k = Math.min(tiers[i].cap, Math.floor(v / uv[i])); k >= 0; k--) {
        const pv = v - uv[i] * k;
        if (pv < 0) continue;
        if (prev.cost[pv] === Infinity) continue;
        if (Math.abs(prev.cost[pv] + tiers[i].need * k - snap[i + 1].cost[v]) < 1e-9
          && Math.abs(prev.cnt[pv] + k - snap[i + 1].cnt[v]) < 1e-9) { got = k; v = pv; break; }
      }
      if (got > 0) picks.push({
        tier: tiers[i], n: got,
        alt: tiers[i].capYb > tiers[i].routeA.yb + 1e-9,
      });
    }
    picks.reverse();
    const res = {
      picks,
      cost: picks.reduce((a, p) => a + p.tier.need * p.n, 0),
      yb: picks.reduce((a, p) => a + p.tier.capYb * p.n, 0),
      count: picks.reduce((a, p) => a + p.n, 0),
      rebate: picks.reduce((a, p) => a + p.tier.rebVal * p.n, 0),
      target: x,
      mode,
    };
    res.money = res.cost / 100;
    res.over = res.yb - x;
    return res;
  }

  /* ---------- 充值分析：把一个组合的产出按品类拆开 ----------
     分列口径和线下那张 Excel 一致：
       通元 = 到账通用元宝（= 本金，1:1）
       绑元 = 双倍箱选绑元那条路的额外部分
       红包 = 名字里带「红包」的
       抵价券 = 各种券 × 可用率
       灯宝玉 = 祈福灯 / 宝玉 / 水晶球这类「抽将道具」
       纳贤令 = 纳贤令
       15-1 = 「15 选 1 / 自选武将」这类定向产出
     三档倍率的差别只在于「这些产出对你要的武将算不算数」：
       拿 15-1 纳贤  → 全算
       拿非 15-1 纳贤 → 扣掉 15-1（目标不在 15-1 名单里）
       不拿纳贤      → 15-1 和纳贤令都不算（你根本不练纳贤将） */
  const COLS = [
    { key: 'tong', name: '通元', hint: '到账通用元宝，1:1 等价本金' },
    { key: 'bang', name: '绑元', hint: '双倍箱选绑定元宝时多出来的部分' },
    { key: 'hongbao', name: '红包', hint: '充值返的红包元宝' },
    { key: 'coupon', name: '抵价券', hint: '券面额 × 可用率' },
    { key: 'lamp', name: '灯宝玉', hint: '祈福灯 / 宝玉 / 水晶球等抽将道具' },
    { key: 'naxian', name: '纳贤令', hint: '纳贤令' },
    { key: 'sel15', name: '15-1', hint: '15 选 1 / 自选武将类定向产出' },
    { key: 'other', name: '其他', hint: '未归类的产出，按折算价计入' },
  ];

  function colOf(k) {
    if (k === '绑定元宝') return 'bang';
    if (/红包/.test(k)) return 'hongbao';
    if (/券/.test(k)) return 'coupon';
    if (/15\s*[-选一]|十五选一|自选武将|武将自选|自选礼|选一/.test(k)) return 'sel15';
    if (/^定向招募令$|^定向武将$/.test(k)) return 'sel15';
    if (/纳贤|^令$/.test(k)) return 'naxian';
    if (/灯|玉|球/.test(k)) return 'lamp';
    return 'other';
  }

  function breakdown(c, days) {
    const U = unitTable();
    const b = { tong: 0, bang: 0, hongbao: 0, coupon: 0, lamp: 0, naxian: 0, sel15: 0, other: 0 };
    const detail = {};
    const put = (k, q) => {
      if (!q) return;
      const col = colOf(k);
      const val = q * (U[k] || 0);
      b[col] += val;
      (detail[col] = detail[col] || []).push({ k, q, val });
    };
    (c.picks || []).forEach((p) => {
      const t = p.tier;
      const n = p.n;
      b.tong += t.need * n;
      const src = P.chargeTiers[t.i] || {};
      if (t.bestRoute === 'B' && src.alt) {
        /* 走绑元路线：alt 里的钱直接进绑元，道具部分照常归类 */
        const bind = src.alt['绑定元宝'] || 0;
        b.bang += bind * n;
        Object.keys(src.alt).forEach((k) => { if (k !== '绑定元宝') put(k, src.alt[k] * n); });
      } else {
        Object.keys(src.gives || {}).forEach((k) => put(k, (src.gives[k] || 0) * n));
      }
      /* 整期限1次的奖励：买几份都只算 1 次，绝不 ×n */
      if (n > 0) Object.keys(src.onceGives || {}).forEach((k) => put(k, src.onceGives[k] || 0));
    });
    const base = c.cost;
    const sum = COLS.reduce((a, col) => a + b[col.key], 0);
    /* 三档倍率：全算 / 扣 15-1 / 再扣纳贤令 */
    const no15 = sum - b.sel15;
    const noNx = no15 - b.naxian;
    return {
      cols: COLS.map((col) => ({ ...col, val: b[col.key], items: detail[col.key] || [] })),
      b, base, sum,
      ratioAll: base > 0 ? sum / base : 0,
      ratioNo15: base > 0 ? no15 / base : 0,
      ratioNoNaxian: base > 0 ? noNx / base : 0,
      has15: b.sel15 > 0,
      hasNaxian: b.naxian > 0,
    };
  }

  /* 消费返利也按下同样的列拆（「充完之后花掉还能返多少」） */
  function spendBreakdown(yb, days) {
    const s = spendRebate(yb, days);
    const b = { tong: 0, bang: 0, hongbao: 0, coupon: 0, lamp: 0, naxian: 0, sel15: 0, other: 0 };
    (s.rows || []).forEach((r) => { b[colOf(r.k)] += r.val; });
    return { spend: s, b, sum: s.val };
  }
  /* ---------- 组合 ----------
     list 每项 {i, n}：i = 档位索引，n = 买几次（可超 1，受整期可买次数限制）。 */
  function combo(list, days) {
    const tiers = tierList(days);
    const picks = [];
    let cost = 0, yb = 0, rebVal = 0, onceTotal = 0, count = 0, capped = false;
    const gives = {};
    (list || []).forEach((it) => {
      const t = tiers.find((x) => (it.i != null ? x.i === it.i : x.need === it.need));
      if (!t) return;
      const hit = picks.find((p) => p.tier.i === t.i);
      const already = hit ? hit.n : 0;
      let n = Math.max(0, Math.floor(it.n == null ? 1 : it.n));
      if (n + already > t.cap) { n = Math.max(0, t.cap - already); capped = true; }
      if (!n) return;
      if (hit) hit.n += n; else picks.push({ tier: t, n });
      cost += t.need * n;
      yb += t.yb * n;
      rebVal += t.rebVal * n;
      /* 限1次价值：只在「该档第一次进入组合」时计1份，之后重复加购不再加。
         already>0 说明这个档已经在 picks 里了（同一档被拆成多笔）。 */
      if (!already) onceTotal += t.onceVal || 0;
      count += n;
      /* 只有走道具路线时才有道具返利；走绑元路线时返利为空 */
      if (t.bestRoute === 'A') {
        const raw = (P.chargeTiers[t.i] && P.chargeTiers[t.i].gives) || {};
        Object.keys(raw).forEach((k) => { gives[k] = (gives[k] || 0) + raw[k] * n; });
        /* 限1次奖励只计 1 份（与 breakdown 同口径） */
        const once = (P.chargeTiers[t.i] && P.chargeTiers[t.i].onceGives) || {};
        Object.keys(once).forEach((k) => { gives[k] = (gives[k] || 0) + once[k]; });
      }
    });
    const total = yb + rebVal + onceTotal;
    const r = {
      picks, cost, money: cost / 100, yb, rebVal, onceVal: onceTotal, total, count, capped, gives,
      ratio: cost > 0 ? total / cost : 0,
      rebRate: cost > 0 ? rebVal / cost : 0,
      sig: picks.map((p) => p.tier.need + 'x' + p.n).sort().join('+'),
      ikey: picks.map((p) => p.tier.i + 'x' + p.n).join('+'),
    };
    return r;
  }

  /* ---------- 端到端倍率 ----------
     本金 → 到账元宝 → 全部花掉 → 消费返利。
     总价值 = 到账元宝（钱本身就值这个数）+ 充值返利折算 + 消费返利折算
     倍率 = 总价值 ÷ 本金。1.0 表示「一分没亏也没赚」，超过 1 的部分就是返利。
     注意：端到端一定 ≥ 单看充值的倍率，因为多了消费那一层。 */
  function endToEnd(c, days) {
    days = days || P.meta.days || 9;
    const s = spendRebate(c.yb, days);
    const cVal = c.rebVal || 0;
    const total = c.yb + cVal + s.val;
    const cost = c.cost || 0;
    return {
      cash: cost / 100,
      yb: c.yb,
      chargeVal: cVal,
      spendVal: s.val,
      spend: s,
      total,
      ratio: cost > 0 ? total / cost : 0,
      chargeRatio: cost > 0 ? (c.yb + cVal) / cost : 0,
      spendRate: c.yb > 0 ? s.val / c.yb : 0,
    };
  }

  /* ---------- 组合枚举 ----------
     每种档位 0..cap 次，总花费 ≤ 预算 → 取端到端倍率最高的一批。
     关键：不是「花得越少越好」——那样永远只买 ¥12 首日档。
     默认只保留「花掉预算 85% 以上」的组合，回答的是
     「我这个预算怎么分配最划算」，而不是「最少花多少」。 */
  function bestMix(days, budgetRmb, topN, opts) {
    opts = opts || {};
    const tiers = tierList(days).filter((t) => t.cap > 0);
    const limit = Math.round((budgetRmb || 0) * 100);
    if (!tiers.length || limit <= 0) return [];
    const maxKinds = opts.maxKinds || tiers.length;
    /* 剪枝：从 idx 往后全买满也够不到「预算的 30%」，这条分支就没意义 */
    const suffix = new Array(tiers.length + 1).fill(0);
    for (let i = tiers.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + tiers[i].need * (opts.useRealCap ? tiers[i].cap : tiers[i].prefCap);
    const floorYb = limit * (opts.minShare == null ? 0.25 : opts.minShare * 0.3);

    const all = [];
    const cur = [];
    const walk = (idx, spent, kinds) => {
      if (idx === tiers.length) {
        if (cur.length && spent >= floorYb - 1e-6) all.push({ list: cur.map((x) => ({ i: x.i, n: x.n })), spent });
        return;
      }
      if (spent + suffix[idx] < floorYb - 1e-6) return;
      const t = tiers[idx];
      /* 用推荐上限 prefCap，不再把单一低倍率档买到真实天花板（¥30×8/¥128×6）。
         想要「全买满」时由 fullMix 负责，那条链路仍用真实 cap，互不干扰。 */
      const buyCap = opts.useRealCap ? t.cap : t.prefCap;
      const maxK = Math.min(buyCap, Math.floor((limit - spent) / t.need));
      for (let k = 0; k <= maxK; k++) {
        const added = k > 0 && !cur.some((x) => x.i === t.i);
        if (k > 0 && kinds + 1 > maxKinds) break;
        if (k > 0) cur.push({ i: t.i, n: k });
        walk(idx + 1, spent + t.need * k, kinds + (added ? 1 : 0));
        if (k > 0) cur.pop();
      }
    };
    walk(0, 0, 0);

    /* 先按充值侧倍率快速排序，只对头部算端到端（省时间，排序结论几乎不变）。
       关键：必须按「花费」分桶取头部，否则榜单会被 ¥12 首日档这类小金额高倍率组合
       全部占满，用户想要的「这 2000 块怎么分配」根本进不了候选。 */
    const cheap = all.map((x) => {
      const c = combo(x.list, days);
      return { list: x.list, spent: x.spent, combo: c, rough: c.cost > 0 ? c.total / c.cost : 0 };
    }).filter((x) => x.combo.cost > 0);

    const buckets = new Map();
    cheap.forEach((x) => {
      const key = Math.floor(x.spent / 20000);   // 每 200 元一桶
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(x);
    });
    const head = [];
    buckets.forEach((arr) => {
      arr.sort((a, b) => b.rough - a.rough);
      const seen0 = new Set();
      let n = 0;
      for (const x of arr) {
        if (n >= 16) break;
        const sig = x.combo.money + '@' + Math.round(x.combo.yb);
        if (seen0.has(sig)) continue;
        seen0.add(sig);
        head.push(x);
        n++;
      }
    });

    const scored = head.map((x) => ({ combo: x.combo, e2e: endToEnd(x.combo, days), spent: x.spent }));

    /* 花满预算：至少用掉 budget × share，不够就逐级放宽 */
    const pick = (share) => {
      const minYb = limit * share;
      return scored.filter((x) => x.spent >= minYb - 1e-6);
    };
    let pool = pick(opts.minShare == null ? 0.85 : opts.minShare);
    if (!pool.length) pool = pick(0.6);
    if (!pool.length) pool = pick(0.3);
    if (!pool.length) pool = scored;

    pool.sort((a, b) => b.e2e.ratio - a.e2e.ratio
      || b.e2e.total - a.e2e.total
      || b.combo.money - a.combo.money);

    /* 同一「本金 + 到账」只留一条，避免同价档刷屏 */
    const seen = new Set();
    const uniq = pool.filter((x) => {
      const sig = x.combo.money + '@' + Math.round(x.combo.yb);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    return topN ? uniq.slice(0, topN) : uniq;
  }

  /* 全买满：每档买到上限，回答「这期全扫光一共多少倍」 */
  function fullMix(days) {
    const tiers = tierList(days).filter((t) => t.cap > 0);
    const c = combo(tiers.map((t) => ({ i: t.i, n: t.cap })), days);
    return { combo: c, e2e: endToEnd(c, days) };
  }

  /* 每种档位最多一次的快捷组合（保留旧接口） */
  function bestCombos(days, size, topN) {
    const tiers = tierList(days).filter((t) => t.cap > 0);
    const out = [];
    const pick = [];
    const walk = (start) => {
      if (pick.length === size) {
        out.push(combo(pick.map((t) => ({ i: t.i, n: 1 })), days));
        return;
      }
      for (let i = start; i < tiers.length; i++) {
        pick.push(tiers[i]);
        walk(i + 1);
        pick.pop();
      }
    };
    if (size > 0 && size <= tiers.length) walk(0);
    out.sort((a, b) => b.ratio - a.ratio || a.money - b.money);
    const seen = new Set();
    const uniq = out.filter((r) => (seen.has(r.sig) ? false : (seen.add(r.sig), true)));
    return topN ? uniq.slice(0, topN) : uniq;
  }

  /* 三套凑额推荐 */
  function recommend(x, days) {
    const base = solve(x, days, 'cost');
    if (!base || !base.picks.length) return [];
    const out = [{ ...base, tag: '最省', sig: base.picks.map((p) => p.tier.need + 'x' + p.n).join('+') }];
    const seen = new Set([out[0].sig]);
    [['cnt', '笔数最少', base.money], ['reb', '返利最多', base.money + 100]].forEach(([mode, tag, cap]) => {
      const r = solve(x, days, mode, cap);
      if (!r || !r.picks.length) return;
      const sig = r.picks.map((p) => p.tier.need + 'x' + p.n).join('+');
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ ...r, tag, sig });
    });
    return out;
  }

  /* 口径说明（脚注同源） */
  function notes() {
    const U = unitTable();
    const fmt = (k) => (U[k] ? `${k} ${Math.round(U[k])}` : null);
    const line = ['盒', '祈福灯', '纳贤令', '锦绣', '狂欢夺宝券', '狂欢水晶球'].map(fmt).filter(Boolean);
    return [
      `道具折算单价取「当期商城最低可得价」：${line.join('、')}。与方案里实际买入价同源，不是单买标价。`
        + '（纳贤令例外：每日前两次 200 / 500 是限购特惠，按「纳贤令礼包」标准标价折。）',
      Object.keys(P.redPackets || {}).length
        ? Object.keys(P.redPackets).map((k) => {
          const r = P.redPackets[k];
          return `${k}按概率表期望 ${E.fmt(r.ev)} 元宝折（区间 ${E.fmt(r.min)}~${E.fmt(r.max)}）`;
        }).join('；') + '，开出的是绑定元宝，可直接抵消费。'
        : '',
      Object.keys(P.coupons || {}).map((k) => {
        const c = P.coupons[k];
        return `${c.name}按面额 ${E.fmt(c.face)} × 可用率 ${Math.round(usableOf(c.face) * 100)}% = ${E.fmt(Math.round((c.face || 0) * usableOf(c.face)))}`;
      }).join('；') + '（满额门槛越高越容易剩，故折扣越大）。',
      '双倍箱是「道具包 / 绑元」二选一：两条路线分别算，取高的那条，绝不叠加。',
      '倍率 = 合计价值 ÷ 本金；1.00× 表示只拿回本金。充值倍率只看充值侧，端到端倍率还含消费返利。',
      '消费返利按「每天花到刚好够最高一档」估算，天数不超过活动天数；实际排程以右侧方案为准。',
    ].filter(Boolean);
  }

  return {
    USABLE, usableOf, unitTable, resetUnit, valOf, notes, COLS, colOf,
    tierList, rank, solve, recommend, combo, bestCombos, bestMix, fullMix,
    endToEnd, spendRebate, breakdown, spendBreakdown, CMP,
  };
})();
