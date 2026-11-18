/* ============================================================
   分类层 —— 把「武将获取」按 祈福 / 宝玉 / 纳贤 / 其他 四类拆开
   口径不变：只算「目标 → 需要多少个中间道具 → 买这些道具花多少元宝」
   券前元宝 = 中间道具的购买成本，不含抵价券与档位回冲（券后实付在右栏方案里）
   ============================================================ */

window.TARGETS = (function () {
  const P = window.PRESET;
  const E = window.E;

  /* 四类：固定顺序、固定配色（顺序即汇总表顺序） */
  const CATS = [
    { key: 'qifu', name: '祈福', color: '#9b3b57', soft: '#fbf0f3', mid: '祈福灯 → 同心结 → 祈福商城' },
    { key: 'jade', name: '宝玉', color: '#2f6f9e', soft: '#eff5fa', mid: '珍宝礼盒 → 传世宝玉 → 珍宝商店' },
    { key: 'naxian', name: '纳贤', color: '#2f7d5f', soft: '#eef7f2', mid: '纳贤令 → 累计 100/120 达标' },
    { key: 'other', name: '其他', color: '#8a6b3f', soft: '#fbf5ea', mid: '锦绣绸缎 / 水晶球 / 签筒如意莲 / 直售' },
  ];
  const CAT = {};
  CATS.forEach((c) => { CAT[c.key] = c; });

  /* 路线 → 四类。判定：
     jade    : 珍宝商店（礼盒 → 宝玉）
     qifu    : 祈福商城（灯 → 同心结 → 结换将）
     naxian  : 纳贤令累计进度（含海纳百川 6 选 1）
     other   : 其余（夺宝进度、锦绣、签筒、水晶球、直售、消费热力） */
  function catOf(r) {
    if (!r) return 'other';
    if (r.kind === 'jade') return 'jade';
    if (r.kind === 'knot') return 'qifu';
    if (r.kind === 'progress') return r.sysId === 'naxian' ? 'naxian' : 'other';
    return 'other';
  }

  /* 中间道具链压缩：去掉「元宝」终点，同种道具的「需购买」并入前一段 */
  function midChain(chain) {
    const out = [];
    (chain || []).forEach((c) => {
      if (!c || c.cur === '元宝' || c.cur === '实付元宝') return;
      if (c.cur === '直售礼包' || c.cur === '皮肤券') return;
      const last = out[out.length - 1];
      if (c.buy) {
        if (last && last.cur === c.cur) { last.buy = c.qty; return; }
      }
      out.push({ cur: c.cur, qty: c.qty, buy: c.buy ? c.qty : null });
    });
    return out;
  }

  /* 全部目标 + 每条路线的分类标签 */
  let _cache = null;
  let _key = '';

  /* 单买兜底路线：祈福 → 单买灯，宝玉 → 单买玉。
     不限购、不用凑礼包、不赌掉落，价格按 data.singles 的单价。 */
  function singleRoute(kind, label, qty, cur, cat) {
    const s = (P.singles || {})[cur] || { price: 0, unit: '' };
    return {
      key: kind, kind, sysId: kind, sysName: '单买',
      cat, catName: CAT[cat].name,
      cur: cur, qty, mid: [{ cur, qty, buy: qty }],
      buy: qty, free: 0,
      yb: qty * s.price, unity: s.price,
      basis: 'exact', label, note: s.src || '单买兜底',
      manual: true, raw: null,
    };
  }

  function withSingles(routes, t) {
    if (!routes.length) return routes;
    const base = routes[0];
    if (base.cat === 'qifu') {
      const m = base.mid.find((x) => x.cur === '祈福灯');
      /* 单买只买「需要买的那部分」，白送的灯不重复计价 */
      const q = base.buy != null ? base.buy : (m ? m.qty : 0);
      if (q > 0 && !routes.some((r) => r.kind === 'single-lamp')) {
        routes.push(singleRoute('single-lamp', '单买祈福灯', q, '祈福灯', 'qifu'));
      }
    } else if (base.cat === 'jade') {
      const m = base.mid.find((x) => x.cur === '传世宝玉' || x.cur === '盒' || x.cur === '礼盒');
      const jades = m ? (m.cur === '传世宝玉' ? m.qty : m.qty / 50) : 0;
      if (jades > 0 && !routes.some((r) => r.kind === 'single-jade')) {
        routes.push(singleRoute('single-jade', '单买传世宝玉', jades, '传世宝玉', 'jade'));
      }
    }
    return routes;
  }

  function build(ctx, lib) {
    const k = ctx.days + '|' + JSON.stringify(ctx.params) + '|' + (lib ? lib.size : 0);
    if (_cache && _key === k) return _cache;

    const out = [];
    (lib || E.buildLibrary()).forEach((t) => {
      const all = E.routesFor(t, ctx).filter((r) => !r.hidden);
      const routes = all.map((r) => ({
        key: r.key, kind: r.kind, sysId: r.sysId, sysName: r.sysName,
        cat: catOf(r), catName: CAT[catOf(r)].name,
        cur: r.curName, qty: r.curQty, mid: midChain(r.chain),
        buy: r.buyQty, free: r.freeQty,
        yb: r.costEv.yb, unity: r.costEv.uni,
        basis: r.basis, label: r.label, note: r.note || '', raw: r,
      }));
      routes.sort((a, b) => a.yb - b.yb);
      withSingles(routes, t);
      routes.sort((a, b) => a.yb - b.yb);
      out.push({
        name: t.name, cat: t.cat, routes,
        best: routes.length ? routes[0] : null,
        wayKeys: [...new Set(routes.map((r) => r.cat))],
      });
    });
    _cache = out; _key = k;
    return out;
  }

  /* 分途径汇总：给定选中的目标名，按四类汇总券前成本 */
  function summary(names, arr) {
    const sel = new Set(names || []);
    const scoped = sel.size ? arr.filter((t) => sel.has(t.name)) : arr;
    const rows = CATS.map((c) => ({
      key: c.key, name: c.name, color: c.color, soft: c.soft,
      n: 0, qty: 0, unit: '', multi: false, yb: 0, list: [], min: null,
    }));
    const byKey = {};
    rows.forEach((r) => { byKey[r.key] = r; });

    scoped.forEach((t) => {
      /* 选中时：该目标在此分类下若有路线就算进来（同一目标可出现多行）
         未选中时：只看每个目标的主力路线，当作全局总览 */
      const rs = sel.size ? t.routes : (t.best ? [t.best] : []);
      /* 单买兜底单独记一份，不占「路线数」，也不改券前合计 */
      (t.routes || []).forEach((r) => {
        if (!r.manual) return;
        const row = byKey[r.cat];
        if (!row) return;
        if (!row.single || r.yb < row.single.yb) {
          row.single = { label: r.label, qty: r.qty, cur: r.cur, yb: r.yb, unit: r.unity };
        }
      });
      const seen = new Set();
      rs.forEach((r) => {
        if (seen.has(r.cat)) return;
        seen.add(r.cat);
        const row = byKey[r.cat];
        if (!row) return;
        row.n += 1;
        row.yb += r.yb;
        row.list.push(t.name);
        if (!row.min || r.yb < row.min.yb) row.min = { name: t.name, yb: r.yb };
        /* 「需中间道具」取实际要买的那个中间道具（有 buy 标记的那段） */
        const m0 = r.mid.find((x) => x.buy != null) || r.mid[0];
        if (m0) {
          if (!row.unit) { row.unit = m0.cur; row.qty = m0.qty; }
          else if (row.unit === m0.cur) row.qty += m0.qty;
          else row.multi = true;
        } else row.multi = true;
      });
    });

    const live = rows.filter((r) => r.n > 0 && isFinite(r.yb));
    /* 未选中时看「全库最便宜的那条路」，比合计更有意义 */
    if (!sel.size) rows.forEach((r) => { if (r.min) { r.yb = r.min.yb; r.minOnly = true; } });
    let starKey = null;
    if (live.length) {
      /* 0 元宝（活动白嫖/皮肤券）不参与「最省」评比，否则永远 0 分 */
      const best = rows.filter((r) => r.n > 0 && r.yb > 0).slice().sort((a, b) => a.yb - b.yb)[0];
      starKey = best ? best.key : null;
    }
    rows.forEach((r) => {
      r.star = r.key === starKey && live.length > 1;
      r.yuan = r.yb / (100 * (P.meta.rmbPer100 || 1));
      r.singleText = r.single
        ? `${r.single.qty} ${r.single.cur} · ${E.fmt(r.single.yb)} 元宝`
        : '';
      if (!r.n) { r.midText = '—'; r.note = ''; return; }
      if (r.minOnly) { r.midText = `${r.n} 个目标`; r.note = `最低 ${r.min.name}`; return; }
      r.midText = r.multi || !r.unit ? `${r.n} 项` : `${E.fmt(r.qty)} ${r.unit}`;
      r.note = r.star ? '最省' : (r.list.slice(0, 2).join('、') + (r.list.length > 2 ? '…' : ''));
    });
    rows.forEach((r) => { r.full = r.list.join('、'); });
    return { rows, starKey, total: rows.reduce((a, r) => a + (isFinite(r.yb) ? r.yb : 0), 0), mode: sel.size ? 'sel' : 'all' };
  }

  return { CATS, CAT, catOf, midChain, build, summary, reset: () => { _cache = null; } };
})();
