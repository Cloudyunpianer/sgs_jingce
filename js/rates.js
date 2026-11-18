/* ============================================================
   充值倍率表 + 凑额 DP
   一张表回答两个问题：
     ① 哪个充值档位「值」—— 把返利道具按当期兑换价折成元宝，算倍率
     ② 想拿到 X 元宝，最少充多少钱 —— 档位组合 DP（含 11/8 重置后可买两次的 328/648）
   折算口径全部集中在 UNIT 里，脚注同源，改一处即可整体调整。
   ============================================================ */

window.RATES = (function () {
  const P = window.PRESET;
  const E = window.E;

  /* ---------- 折算口径（脚注同源） ---------- */
  const USABLE = { 券1111: 0.85, 券2888: 0.85, 券6665: 0.60 };
  const UNIT = {
    祈福灯: 1000,
    狂欢水晶球: 2980,
    绑定元宝: 1,
  };
  ['券1111', '券2888', '券6665'].forEach((k) => {
    UNIT[k] = (P.coupons[k] ? P.coupons[k].face : 0) * USABLE[k];
  });

  const NOTE = [
    '祈福灯 = 1,000 元宝（当期单灯价，与祈福礼包最低单价对齐）。',
    '狂欢水晶球 = 2,980 元宝/球（22 球 = 许劭；648 档送 22 球，按当期最省兑换单价折）。',
    '抵价券 = 面额 × 可用率：1111 / 2888 记 85%，6665 记 60%（门槛 3000 / 6666，越大的券越容易剩）。无满足门槛的商品时记 0。',
    '绑定元宝 = 1:1（双倍箱的另一选项，按面额计）。',
    '倍率 = 合计价值 ÷ (档位元 × 100)；倍率 1.00 代表「只拿到本金」。',
    '「到账元宝」= 档位元宝 + 双倍箱可选绑元；返利道具不计入到账元宝，只折算价值。',
  ];

  function condText(t, days) {
    const p = [];
    if (t.perDay) p.push(`每日 ${t.perDay} 次（${days} 天共 ${t.perDay * days} 次）`);
    else if (t.onlyDay) p.push('仅首日 1 次');
    else if (t.fromDay) p.push('11/8 起 1 次');
    if (t.total != null && !t.fromDay) p.push(t.alt ? `整期 ${t.total} 次（11/8 重置）` : `整期 ${t.total} 次`);
    if (t.alt) p.push('双倍箱二选一');
    return p.join(' · ') || '整期 1 次';
  }

  function tierList(days) {
    days = days || P.meta.days || 9;
    return (P.chargeTiers || []).map((t, i) => {
      const altBind = t.alt ? (t.alt['绑定元宝'] || 0) : 0;
      const yb = t.need + altBind;
      const reb = [];
      let rebVal = 0;
      Object.keys(t.gives || {}).forEach((k) => {
        const q = t.gives[k];
        if (!q) return;
        const u = UNIT[k] || 0;
        reb.push({ k, q, unit: u, val: q * u });
        rebVal += q * u;
      });
      const total = yb + rebVal;
      const tag = t.onlyDay ? '首日'
        : t.fromDay ? (t.fromDay === 2 ? '11/8起' : `第${t.fromDay}天起`)
        : t.perDay ? '每日'
        : t.total != null ? `共${t.total}次` : '1次';
      return {
        i, need: t.need, rmb: t.need / 100, yb, reb, rebVal, total,
        ratio: total / t.need, tag,
        altBind, altYb: altBind ? t.need + altBind : 0,
        cap: t.total != null ? t.total : (t.perDay ? t.perDay * days : 1),
        cond: condText(t, days),
        altText: altBind ? `或换绑元×${E.fmt(altBind)}（1:1，到账合计 ${E.fmt(t.need + altBind)} 元宝）` : '',
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
      if (r.need === 1200 && r.cap === 1 && r.reb.some((x) => x.k === '券6665')) tags.push('首充档');
      if (r.need === 3000 || r.need === 6000) tags.push('每日必买档');
      return { ...r, place: i + 1, badge: tags.join(' · ') };
    });
  }

  /* ---------- 凑额 DP：给定要花掉的元宝 x，最少人民币 ----------
     目标值 = 到账元宝（双倍箱按绑元计，保证「能花」）
     三个口径：cost 最省 / cnt 笔数最少 / reb 返利最多 */
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
    const uv = tiers.map((t) => Math.round(t.yb / 100));
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

    /* 回溯 */
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
      if (got > 0) picks.push({ tier: tiers[i], n: got });
    }
    picks.reverse();
    const res = {
      picks,
      cost: picks.reduce((a, p) => a + p.tier.need * p.n, 0),
      yb: picks.reduce((a, p) => a + p.tier.yb * p.n, 0),
      count: picks.reduce((a, p) => a + p.n, 0),
      rebate: picks.reduce((a, p) => a + p.tier.rebVal * p.n, 0),
      target: x,
      mode,
    };
    res.money = res.cost / 100;
    res.over = res.yb - x;
    return res;
  }

  /* ---------- 组合倍率：12 + 6 这种几档一起充，整体值不值 ----------
     组合倍率 = Σ合计价值 ÷ Σ本金，本质是各档倍率按本金加权平均，
     所以它一定落在「参与组合的最低档 ~ 最高档」之间——组合的意义不是刷高倍率，
     而是把「买不到 / 次数用满」的额度用掉时，整体还剩下多少效率。 */
  function combo(list, days) {
    const tiers = tierList(days);
    const picks = [];
    let cost = 0, yb = 0, rebVal = 0, count = 0, capped = false;
    (list || []).forEach((it) => {
      const t = tiers.find((x) => (it.i != null ? x.i === it.i : x.need === it.need));
      if (!t) return;
      const hit = picks.find((p) => p.tier.i === t.i);
      const already = hit ? hit.n : 0;
      let n = Math.max(0, Math.floor(it.n == null ? 1 : it.n));
      /* 可买次数是「整期累计」的，同一档选两次也要合起来看上限 */
      if (n + already > t.cap) { n = Math.max(0, t.cap - already); capped = true; }
      if (!n) return;
      if (hit) hit.n += n; else picks.push({ tier: t, n });
      cost += t.need * n;
      yb += t.yb * n;
      rebVal += t.rebVal * n;
      count += n;
    });
    const total = yb + rebVal;
    return {
      picks, cost, money: cost / 100, yb, rebVal, total, count, capped,
      ratio: cost > 0 ? total / cost : 0,
      rebRate: cost > 0 ? rebVal / cost : 0,
      /* sig 按价格去重（两个 ¥12 档算同一组合）；ikey 按档位定位（点选要用） */
      sig: picks.map((p) => p.tier.need + 'x' + p.n).sort().join('+'),
      ikey: picks.map((p) => p.tier.i + 'x' + p.n).join('+'),
    };
  }

  /* 每种档位最多一次的组合排行：size = 2 就是「12+6」这种双档，3 是三档 */
  function bestCombos(days, size, topN) {
    const tiers = tierList(days).filter((t) => t.cap > 0);
    const out = [];
    const pick = [];
    const walk = (start) => {
      if (pick.length === size) {
        /* 必须传档位索引：两个 ¥12 档 need 相同，按 need 会解析成同一档 */
        const r = combo(pick.map((t) => ({ i: t.i, n: 1 })), days);
        out.push(r);
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
    /* 同价档（两个 ¥12：首日 / 11/8 起）会排出同 sig 的组合，只留倍率最高的一条 */
    const seen = new Set();
    const uniq = out.filter((r) => (seen.has(r.sig) ? false : (seen.add(r.sig), true)));
    return topN ? uniq.slice(0, topN) : uniq;
  }

  /* 三套凑额推荐：都不许比「最省」更贵（返利最多允许最多多花 ¥100） */
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

  return { UNIT, USABLE, NOTE, tierList, rank, solve, recommend, combo, bestCombos, CMP };
})();
