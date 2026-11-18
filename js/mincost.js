/* ============================================================
   最低消费反查 —— 给定道具 + 数量，反推「最少花多少钱」
   搜索空间：
     ① 每日消费档位分布：把采购摊到 1..N 天（集中冲高档 / 摊平吃低档逐天全试）
     ② 充值组合：build 内部的档位 DP（328/648 按整期 2 次、含 11/8 重置）
        + RATES 的三口径枚举（最省 / 笔数最少 / 返利最多）复核并择优
   剪枝：券前需要 → 券面池下界；到账不够、人民币超过当前最优的候选直接丢
   ============================================================ */

window.MINCOST = (function () {
  const P = window.PRESET;
  const E = window.E;
  const S = window.SCHED;
  const R = window.RATES;

  const GIVE_LBL = {
    券6665: '券6665', 券2888: '券2888', 券1111: '券1111',
    祈福灯: '祈福灯', 纳贤令: '纳贤令', 锦绣: '锦绣',
    狂欢夺宝券: '夺宝券', 狂欢水晶球: '水晶球', 绑定元宝: '绑元',
  };

  function fmtGives(g) {
    const ks = Object.keys(g || {}).filter((k) => g[k] > 0);
    if (!ks.length) return '';
    return ks.map((k) => `${GIVE_LBL[k] || k}×${E.fmt(g[k])}`).join('、');
  }

  function buyText(r) {
    const m = new Map();
    (r.dist || []).forEach((d) => (d.packs || []).forEach((p) => {
      if (!p || p.price <= 0 || p.coupon || p.direct) return;
      m.set(p.name, (m.get(p.name) || 0) + 1);
    }));
    const buys = [...m.entries()].map(([n, c]) => (c > 1 ? `${n}×${c}` : n));
    const chg = (r.charge.picks || []).map((p) => `${E.fmt(p.t.need / 100)}元×${p.n}`
      + (p.crystal ? '（水晶球档）' : p.alt ? '（双倍箱）' : ''));
    return { chg: chg.join(' + ') || '不充值', buys: buys.join('、') || '无' };
  }

  function couponText(r) {
    const u = r.coupons || {};
    const ks = Object.keys(u).filter((k) => u[k] > 0);
    if (!ks.length) return '0 张';
    const n = ks.reduce((a, k) => a + u[k], 0);
    return `${n} 张（${ks.map((k) => `${k.replace('券', '')}×${u[k]}`).join(' + ')}）`;
  }

  /* 可用券面池（期初 + 充值档位上限 + 每日档位上限） */
  function couponFacePool(stock, days) {
    let pool = 0;
    S.CPN_KEYS.forEach((k) => {
      const def = P.coupons[k] || { face: 0 };
      const init = (stock.coupons && stock.coupons[k]) || 0;
      const fromCharge = Math.max(0, ...(P.chargeTiers || []).map((t) => (t.gives && t.gives[k]) || 0))
        * Math.max(1, ...(P.chargeTiers || []).map((t) => (t.total != null ? t.total : (t.perDay ? t.perDay * days : 1))));
      const fromDaily = Math.max(0, ...(P.dailyTiers || []).map((t) => (t.gives && t.gives[k]) || 0)) * days;
      pool += (init + fromCharge + fromDaily) * def.face;
    });
    return pool;
  }

  function search(name, qty, ctx, opts) {
    opts = opts || {};
    const days = ctx.days;
    const stock = opts.stock || { coupons: {} };
    qty = Math.max(1, Math.floor(qty || 1));

    const lib = E.buildLibrary();
    const t = lib.get(name);
    if (!t) return { err: `没找到「${name}」这个目标` };

    const rs = E.routesFor(t, ctx).filter((r) => !r.hidden);
    if (!rs.length) return { err: `「${name}」本期只有概率直出，没有可精测的途径` };
    const route = rs[0];
    const baseYb = route.costEv.yb * qty;
    const names = new Array(qty).fill(name);

    const pool = couponFacePool(stock, days);
    const lb = Math.max(0, (baseYb - pool) / 100);

    const cands = [];
    let pruned = 0;
    let best = Infinity;

    for (let act = 1; act <= days; act++) {
      /* 下界剪枝：任何方案的实付都不可能低于 (券前需要 − 券面池) */
      if (lb > best + 1e-9) { pruned += 1; continue; }

      const r = S.build(names, { days, stock, forceAct: act });
      if (!r) { pruned += 1; continue; }

      const crys = (r.need && r.need['狂欢水晶球']) || 0;
      const opts2 = [{ src: 'build', charge: r.charge, money: r.charge.money, yb: r.charge.yb }];

      /* 水晶球必须走充值档，不能用纯凑额替代 */
      if (!crys) {
        [['cost', '最省'], ['cnt', '笔数最少'], ['reb', '返利最多']].forEach(([mode]) => {
          const c = R.solve(r.netSpend, days, mode);
          if (!c) return;
          if (c.yb + 1e-9 < r.netSpend) { pruned += 1; return; }
          opts2.push({
            src: mode,
            charge: { picks: c.picks.map((p) => ({ t: p.tier, n: p.n, alt: !!p.tier.altBind })),
              money: c.money, yb: c.yb, gives: null },
            money: c.money, yb: c.yb,
          });
        });
      }

      let pick = null;
      opts2.forEach((o) => {
        if (!isFinite(o.money)) { pruned += 1; return; }
        if (!pick || o.money < pick.money - 1e-9
          || (Math.abs(o.money - pick.money) < 1e-9 && (o.yb > pick.yb))) pick = o;
      });
      if (!pick) { pruned += 1; continue; }

      /* 1 天集中 / 每日定额 这两个口径一定保留，其余超过当前最优的丢掉 */
      const keep = act === 1 || act === days;
      if (!keep && pick.money > best + 1e-9) { pruned += 1; continue; }
      best = Math.min(best, pick.money);

      const bt = buyText(r);
      cands.push({
        act, money: pick.money, yb: pick.yb,
        charges: (pick.charge.picks || []).reduce((a, p) => a + p.n, 0),
        netSpend: r.netSpend,
        charge: pick.charge,
        chgText: bt.chg, buyText: bt.buys,
        couponText: couponText(r),
        couponSave: r.couponSave,
        tierText: fmtGives(r.tierReward) || '无',
        rest: Math.max(0, pick.yb - r.netSpend),
        src: pick.src,
        ok: r.ok,
      });
    }

    if (!cands.length) return { err: '没找到可行方案（元宝/天数不足）' };

    const sortMoney = cands.slice().sort((a, b) => a.money - b.money || a.act - b.act);
    const bestRow = sortMoney[0];
    const calm = cands.find((c) => c.act === days) || sortMoney[sortMoney.length - 1];
    const fast = cands.find((c) => c.act === 1) || null;

    const rows = [{ ...bestRow, tag: '最省', why: '把档位返利和抵价券吃满的那个天数分布' }];
    if (calm && calm.act !== bestRow.act) {
      rows.push({ ...calm, tag: '省心·每日定额', why: `摊到 ${calm.act} 天，每天都有消费，不用盯日子` });
    }
    if (fast && fast.act !== bestRow.act && (!calm || fast.act !== calm.act)) {
      rows.push({ ...fast, tag: '快出·1 天集中', why: '一天花完，当天就把高档位奖励一次性拿完' });
    }

    return {
      name, qty, baseYb, baseYuan: baseYb / (100 * (P.meta.rmbPer100 || 1)),
      routeLabel: route.label, cur: route.curName, curQty: route.curQty, mid: route.chain,
      rows, lb, pruned, cands: cands.length,
      pool,
    };
  }

  return { search, couponFacePool, fmtGives };
})();
