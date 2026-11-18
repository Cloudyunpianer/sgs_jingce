/* 自检：node tools/check.js
   覆盖：单目标成本 / 多目标合并 / 四类划分 / 券守恒 / 倍率单调 / 反查 ≤ 单买
        / 单买兜底（灯·玉）/ 结余券换购守恒 / 组合倍率加权 */
const fs = require('fs');
const path = require('path');
global.window = {};
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, 'js', f), 'utf8');
eval(rd('data.js') + '\n' + rd('engine.js') + '\n' + rd('plan.js') + '\n'
  + rd('classify.js') + '\n' + rd('rates.js') + '\n' + rd('mincost.js'));

const EN = global.window.E;
const P = global.window.PRESET;
const S = global.window.SCHED;
const T = global.window.TARGETS;
const R = global.window.RATES;
const M = global.window.MINCOST;

const ctx = { days: 9, params: { qifuExtraKnot: P.params.qifuExtraKnot, ratio: 100 } };
const lib = EN.buildLibrary();
const money = (n) => Math.round(n).toLocaleString();

let fail = 0;
const eq = (name, got, want) => {
  const ok = Math.abs(got - want) < 1e-6;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${got}${ok ? '' : '  (期望 ' + want + ')'}`);
};
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ': ' + extra : ''}`);
};
const eqs = (name, got, want) => {
  const good = got === want;
  if (!good) fail++;
  console.log(`${good ? '✓' : '✗'} ${name}: ${got}${good ? '' : '  (期望 ' + want + ')'}`);
};

console.log('目标总数:', lib.size, '\n');

/* ---------- 单个目标：道具 → 元宝（券前） ---------- */
const names = ['威曹彰', '谋钟会', '任婉', '谋程普', '春宵彩翼*任婉',
  '锦笼连姝*刘衿刘佩', '蒯祺', '树影曳情*环怀瑾'];
names.forEach((n) => {
  const t = lib.get(n);
  if (!t) { console.log('!! 未找到', n); fail++; return; }
  const rs = EN.routesFor(t, ctx).filter((r) => !r.hidden);
  if (!rs.length) { console.log('!! 无确定路线', n); fail++; return; }
  const b = rs[0];
  console.log(`${n.padEnd(18)} 需 ${String(b.curQty).padStart(7)} ${b.curName.padEnd(6)}` +
    ` 买 ${String(b.buyQty == null ? '-' : b.buyQty).padStart(6)}` +
    ` = ${money(b.costEv.yb).padStart(9)} 元宝  [${b.basis}]`);
});

/* ---------- 不变量 ---------- */
console.log('\n--- 规则校验 ---');
const jade = EN.jadePlan(20, ctx);
eq('20 宝玉需开盒数', jade.boxes, 1000);
eq('20 宝玉 = 1000 盒 / 50', jade.boxes / 20, 50);
eq('20 宝玉不含随机掉落', jade.jade, 20);

const wcb = lib.get('威曹彰');
const wcbRoute = EN.routesFor(wcb, ctx).filter((r) => !r.hidden)[0];
eq('威曹彰 需要 20 宝玉', wcbRoute.curQty, 20);

const mzh = lib.get('谋钟会');
const mzhRoute = EN.routesFor(mzh, ctx).filter((r) => !r.hidden)[0];
eq('谋钟会 需要 120 令', mzhRoute.curQty, 120);
eq('谋钟会 免费 24+1 令', mzhRoute.freeQty, 25);
eq('谋钟会 需买 95 令', mzhRoute.buyQty, 95);

/* 免费只抵一次 */
const p2 = EN.plan([lib.get('谋钟会'), lib.get('崔芷')], ctx, {});
eq('两武将 240 令', p2.lines[0].curQty, 240);
eq('两武将 免费只抵 25', p2.lines[0].freeQty, 25);
eq('两武将 需买 215', p2.lines[0].buyQty, 215);

/* 宝玉合并 */
const p3 = EN.plan([lib.get('威曹彰'), lib.get('威刘备')], ctx, {});
eq('威曹彰+威刘备 45 玉', p3.lines[0].curQty, 45);
eq('45 玉 = 2250 盒', p3.lines[0].chain[1].qty, 2250);

/* 概率路线不参与 */
const firstRoute = EN.routesFor(wcb, ctx)[0];
eq('最优路线不是概率路线', firstRoute.hidden ? 1 : 0, 0);

/* 祈福：确定值 vs 均值 */
const q = EN.knotPlan(200, ctx, 17);
console.log(`  祈福 200 结 → 确定 ${q.lampsExact} 灯 / 均值 ${q.lampsAvg} 灯 / 买 ${q.buy} 灯`);
eq('200 结按累计档位 = 200 灯', q.lampsExact, 200);

/* ---------- 多目标方案 ---------- */
console.log('\n--- 多目标合并 ---');
const sel = ['威曹彰', '任婉', '谋程普', '锦笼连姝*刘衿刘佩'].map((n) => lib.get(n));
const plan = EN.plan(sel, ctx, {});
plan.lines.forEach((l) => {
  console.log(`${l.items.join('+').padEnd(20)} ${(l.chain || []).map((c) =>
    (c.buy ? '买' : '') + c.qty + c.cur).join(' → ')}`);
});
console.log('合计', money(plan.totalEv), '元宝 ≈ ¥' + money(plan.totalEv / 100));

const cp = EN.chargePlan(Math.round(plan.totalEv), ctx);
console.log('充值建议（有档位奖励）:', cp.picks.map((p) => p.need + '×' + p.n).join(' + '));
console.log('合计充值', money(cp.total), '元宝 = ¥' + money(cp.total / 100));

/* ============================================================
   回归：券后实付（走完整排程）必须一字不变
   ============================================================ */
console.log('\n--- 回归（券后实付，¥） ---');
const REG = [['威曹彰', 768], ['谋钟会', 262], ['任婉', 614], ['春宵彩翼*任婉', 280], ['谋程普', 328]];
REG.forEach(([n, want]) => {
  const r = S.build([n], { days: 9, stock: {} });
  eq(`${n} 需充值`, r.money, want);
});

/* ============================================================
   断言 1：四类划分覆盖全部目标
   ============================================================ */
console.log('\n--- 断言 1：四类覆盖 ---');
const arr = T.build(ctx, lib);
eq('分类层目标数 = 库目标数', arr.length, lib.size);
ok('四类顺序固定', T.CATS.map((c) => c.key).join(',') === 'qifu,jade,naxian,other',
  T.CATS.map((c) => c.name).join('/'));

const LEGAL = T.CATS.map((c) => c.key);
let badCat = 0;
let routeCnt = 0;
const perCat = { qifu: 0, jade: 0, naxian: 0, other: 0 };
arr.forEach((t) => {
  t.routes.forEach((r) => {
    routeCnt++;
    if (!LEGAL.includes(r.cat)) badCat++;
  });
  if (t.best) perCat[t.best.cat]++;
});
ok('所有路线都落在四类内', badCat === 0, `路线 ${routeCnt} 条，越界 ${badCat} 条`);
T.CATS.forEach((c) => ok(`分类「${c.name}」有目标`, perCat[c.key] > 0, `${perCat[c.key]} 个`));
ok('分类计数之和 = 有路线的目标数', T.CATS.reduce((a, c) => a + perCat[c.key], 0) === arr.filter((t) => t.best).length,
  `${T.CATS.reduce((a, c) => a + perCat[c.key], 0)} / ${arr.filter((t) => t.best).length}`);

/* 判定细则：宝玉走商店、祈福走结、纳贤走令、夺宝走其他 */
eqs('威曹彰 主力分类 = 宝玉', arr.find((t) => t.name === '威曹彰').best.cat, 'jade');
eqs('任婉 主力分类 = 祈福', arr.find((t) => t.name === '任婉').best.cat, 'qifu');
eqs('谋钟会 主力分类 = 纳贤', arr.find((t) => t.name === '谋钟会').best.cat, 'naxian');
eqs('夺宝进度归「其他」', T.catOf({ kind: 'progress', sysId: 'db_ljjp' }), 'other');
eqs('纳贤进度归「纳贤」', T.catOf({ kind: 'progress', sysId: 'naxian' }), 'naxian');

/* 分途径汇总：四行齐全 */
const sm = T.summary(['威曹彰', '谋钟会', '任婉'], arr);
eq('汇总固定四行', sm.rows.length, 4);
ok('汇总标出最省', !!sm.starKey, sm.rows.find((r) => r.star).name);
ok('汇总券前元宝 = 三条主力路线之和',
  Math.abs(sm.rows.reduce((a, r) => a + r.yb, 0)
    - ['威曹彰', '谋钟会', '任婉'].map((n) => arr.find((t) => t.name === n).best.yb).reduce((a, b) => a + b, 0)) < 1e-6);

/* ============================================================
   断言 2：券守恒 获得 = 用掉 + 结余
   ============================================================ */
console.log('\n--- 断言 2：券守恒 ---');
const stock = { yb: 0, coupons: { 券1111: 4, 券2888: 2, 券6665: 1 } };
[['威曹彰'], ['任婉', '谋钟会'], ['春宵彩翼*任婉', '锦笼连姝*刘衿刘佩']].forEach((ns) => {
  const r = S.build(ns, { days: 9, stock });
  const led = S.ledger(r, stock);
  led.rows.forEach((x) => {
    ok(`券守恒 ${ns.join('+')} ${x.key}`,
      x.got === x.used + x.left && x.left >= 0,
      `获得 ${x.got}（期初 ${x.init} + 每日 ${x.daily} + 充值 ${x.charge}）= 用 ${x.used} + 余 ${x.left}`);
  });
  ok(`总券守恒 ${ns.join('+')}`, led.got === led.used + led.left,
    `${led.got} = ${led.used} + ${led.left}`);
});
/* 用掉的券不能超过获得的 */
const rC = S.build(['任婉'], { days: 9, stock: { coupons: {} } });
const ledC = S.ledger(rC, { coupons: {} });
ok('期初为 0 时用券全来自产出', ledC.rows.every((x) => x.used <= x.charge + x.daily),
  ledC.rows.map((x) => `${x.key}:${x.used}/${x.charge + x.daily}`).join(' '));

/* ============================================================
   断言 3：倍率表单调性
   ============================================================ */
console.log('\n--- 断言 3：倍率单调 ---');
const tl = R.tierList(9);
ok('倍率全部 ≥ 1.00', tl.every((t) => t.ratio >= 1 - 1e-9),
  tl.map((t) => t.ratio.toFixed(2)).join(' / '));
const byNeed = {};
tl.forEach((t) => { byNeed[t.need] = Math.max(byNeed[t.need] || 0, t.total); });
const needs = Object.keys(byNeed).map(Number).sort((a, b) => a - b);
let mono = true;
for (let i = 1; i < needs.length; i++) if (byNeed[needs[i]] <= byNeed[needs[i - 1]]) mono = false;
ok('档位越高，合计价值越高', mono,
  needs.map((n) => `${n}→${Math.round(byNeed[n])}`).join(' '));

const rk = R.rank(9);
ok('性价比排行降序', rk.every((t, i) => i === 0 || rk[i - 1].ratio >= t.ratio - 1e-9),
  rk.slice(0, 3).map((t) => `¥${t.rmb}:${t.ratio.toFixed(2)}x`).join(' > '));
ok('倍率 = 合计价值 / 档位元宝', tl.every((t) => Math.abs(t.ratio - t.total / t.need) < 1e-9));

/* 凑额推荐：不超支 */
const dp = R.recommend(400000, 9);
ok('凑额有解', dp.length > 0, dp.map((d) => `${d.tag} ¥${d.money}`).join(' | '));
dp.forEach((d) => ok(`凑额「${d.tag}」覆盖目标`,
  d.yb >= 400000 && d.money <= dp[0].money + 100 + 1e-9,
  `¥${d.money} → ${money(d.yb)} 元宝`));

/* ============================================================
   断言 4：反查结果 ≤ 单买
   ============================================================ */
console.log('\n--- 断言 4：反查 ≤ 单买 ---');
[['威曹彰', 768], ['谋钟会', 262], ['任婉', 614]].forEach(([n, reg]) => {
  const res = M.search(n, 1, ctx, { stock: { coupons: {} } });
  if (res.err) { console.log('!!', n, res.err); fail++; return; }
  const top = res.rows[0];
  const single = EN.routesFor(lib.get(n), ctx).filter((r) => !r.hidden)[0].costEv.yb / 100;
  ok(`${n} 反查 ${money(top.money)} ≤ 单买 ${money(single)}`, top.money <= single + 1e-9,
    `最省 ¥${top.money} · 券前 ${money(single)} · 下界 ¥${res.lb.toFixed(0)} · 候选 ${res.cands} 组 / 剪 ${res.pruned} 组`);
  ok(`${n} 反查不高于回归值 ¥${reg}`, top.money <= reg + 1e-9, `¥${top.money}`);
  ok(`${n} 反查 Top3 至少 2 种口径`, res.rows.length >= 2,
    res.rows.map((x) => `${x.tag} ¥${x.money}/${x.act}天`).join(' | '));
});

/* ============================================================
   断言 5：单买兜底 / 券结余换购 / 组合倍率
   ============================================================ */
console.log('\n--- 断言 5：单买 · 券结余 · 组合倍率 ---');
const LAMP = P.singles.祈福灯.price;
const JADE_P = P.singles.传世宝玉.price;

const rw = arr.find((t) => t.name === '任婉');
const lampRoute = rw.routes.find((r) => r.kind === 'single-lamp');
ok('祈福目标有「单买灯」路线', !!lampRoute,
  lampRoute ? `${lampRoute.qty} 灯 · ${money(lampRoute.yb)} 元宝` : '缺失');
if (lampRoute) {
  eq('单买灯 = 需买灯数 × 1,000', lampRoute.yb, lampRoute.qty * LAMP);
  eq('单买灯只买需买部分（扣掉白送）', lampRoute.qty, rw.best.buy);
  ok('单买不会顶掉主力路线', rw.best.kind !== 'single-lamp', rw.best.label);
}

const jw = arr.find((t) => t.name === '威曹彰');
const jadeRoute = jw.routes.find((r) => r.kind === 'single-jade');
ok('宝玉目标有「单买玉」路线', !!jadeRoute,
  jadeRoute ? `${jadeRoute.qty} 玉 · ${money(jadeRoute.yb)} 元宝` : '缺失');
if (jadeRoute) {
  eq('单买玉 = 玉数 × 10,000', jadeRoute.yb, jadeRoute.qty * JADE_P);
  ok('单买玉 ≥ 开盒主力（保底价不会更便宜）', jadeRoute.yb >= jw.best.yb - 1e-6,
    `单买 ${money(jadeRoute.yb)} vs 开盒 ${money(jw.best.yb)}`);
}

/* 结余券默认换购：每张券抵一张券的面额，不多不少 */
const rL = S.build(['威曹彰', '谋钟会', '任婉', '春宵彩翼*任婉'], { days: 9, stock: {} });
const ledL = S.ledger(rL, { coupons: {} });
const lf = S.leftoverPlan(ledL);
eq('换购张数 = 券结余张数', lf.n, ledL.left);
ok('结余券全部转成灯（张数为 0 或灯数 > 0）', ledL.left === 0 || lf.lamps > 0,
  `${ledL.left} 张 → ${lf.lamps} 灯，实付 ${money(lf.pay)}`);
eq('换购守恒：灯价值 − 实付 = 券面额',
  lf.lamps * LAMP - lf.pay, lf.face);
ok('每张券买够门槛（灯数 × 1,000 ≥ 门槛）',
  lf.rows.every((x) => x.goods >= (P.coupons[x.key] || {}).min - 1e-9),
  lf.rows.map((x) => `${x.key}:${x.per}灯/${x.goods}`).join(' '));

/* 组合倍率：加权平均，落在参与档位的区间内 */
const t6 = tl.find((t) => t.need === 600);
const t128 = tl.find((t) => t.need === 12800);
const c1 = R.combo([{ need: 12800, n: 1 }], 9);
eq('单档组合 = 该档倍率', +c1.ratio.toFixed(9), +t128.ratio.toFixed(9));
const c2 = R.combo([{ need: 600, n: 1 }, { need: 12800, n: 1 }], 9);
eq('组合本金 = 两档之和', c2.cost, 13400);
eq('组合价值 = 两档价值之和', Math.round(c2.total), Math.round(t6.total + t128.total));
ok('组合倍率落在两档之间',
  c2.ratio >= Math.min(t6.ratio, t128.ratio) - 1e-9
  && c2.ratio <= Math.max(t6.ratio, t128.ratio) + 1e-9,
  `${t6.ratio.toFixed(2)}× ~ ${t128.ratio.toFixed(2)}× → ${c2.ratio.toFixed(2)}×`);
ok('组合次数按可买上限截断', R.combo([{ need: 1200, n: 99 }], 9).count <= 1,
  `¥12 档 cap=1，传 99 次 → ${R.combo([{ need: 1200, n: 99 }], 9).count} 次`);

const bc2 = R.bestCombos(9, 2, 4);
ok('双档组合排行有解且降序', bc2.length > 0
  && bc2.every((r, i) => i === 0 || bc2[i - 1].ratio >= r.ratio - 1e-9),
  bc2.map((r) => `${r.picks.map((p) => '¥' + p.tier.rmb).join('+')} ${r.ratio.toFixed(2)}x`).join(' | '));

/* ---------------- 断言 6：期初存货 / 祈福 1:1 / 皮肤细分 ---------------- */
console.log('\n--- 断言 6：期初存货 · 祈福 1:1 · 皮肤细分 ---');

/* 祈福：1 灯 = 1 结，固定口径 */
eqs('祈福参数固定 1 结/灯', P.params.qifuExtraKnot, 1);
eq('200 结 = 200 灯', EN.knotPlan(200, ctx).lamps, 200);
eq('850 结 = 850 灯（不再按档位打折）', EN.knotPlan(850, ctx).lamps, 850);
eq('排程侧同口径：850 结 → 850 灯', S.knotLamps(850), 850);

/* 期初存货：宝玉按 50 盒折、灯/令直接抵 */
const sBase = S.build(['威曹彰'], { days: 9, stock: {} });
const sJade = S.build(['威曹彰'], { days: 9, stock: { items: { 宝玉: 5 } } });
eq('期初 5 玉抵 250 盒', sJade.audit[0].stock, 250);
eq('期初 5 玉后只需买 750 盒', sJade.audit[0].buy, 750);
ok('期初抵扣后总花费下降', sJade.money < sBase.money,
  `¥${money(sBase.money)} → ¥${money(sJade.money)}`);
const sLamp = S.build(['任婉'], { days: 9, stock: { items: { 祈福灯: 100 } } });
eq('期初 100 灯后只需买 83 灯', sLamp.audit[0].buy, 83);
const sNx = S.build(['谋钟会'], { days: 9, stock: { items: { 纳贤令: 50 } } });
eq('期初 50 令后只需买 44 令', sNx.audit[0].buy, 44);
ok('期初 + 白送 + 档位 + 购买 = 需求', [sJade, sLamp, sNx]
  .every((r) => r.audit.every((a) => a.total >= a.need - 1e-6)),
  [sJade, sLamp, sNx].map((r) => r.audit.map((a) => `${a.label} ${a.stock}+${a.free}+${a.tier}+${a.buy}`).join('/')).join(' | '));
const sYb = S.build(['威曹彰'], { days: 9, stock: { yb: 50000 } });
ok('期初元宝先扣充值额', sYb.charge.yb <= sBase.charge.yb, `到账 ${money(sBase.charge.yb)} → ${money(sYb.charge.yb)}`);

/* 皮肤细分：转盘 / 锦绣 / 直售，不再有裸「皮肤」 */
const catCount = {};
lib.forEach((t) => { catCount[t.cat] = (catCount[t.cat] || 0) + 1; });
ok('无未细分的「皮肤」类', !catCount['皮肤'], JSON.stringify(catCount));
eqs('夺宝皮肤 → 转盘皮肤', lib.get('锦笼连姝*刘衿刘佩').cat, '转盘皮肤');
eqs('锦绣商店皮肤 → 锦绣皮肤', lib.get('春宵彩翼*任婉').cat, '锦绣皮肤');
eqs('直售皮肤 → 直售皮肤', lib.get('树影曳情*环怀瑾').cat, '直售皮肤');
ok('三类皮肤都有货', catCount['转盘皮肤'] > 0 && catCount['锦绣皮肤'] > 0 && catCount['直售皮肤'] > 0,
  `转盘 ${catCount['转盘皮肤']} / 锦绣 ${catCount['锦绣皮肤']} / 直售 ${catCount['直售皮肤']}`);

console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
