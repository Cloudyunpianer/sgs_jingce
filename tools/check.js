/* 自检：node tools/check.js
   覆盖：单目标成本 / 多目标合并 / 四类划分 / 券守恒 / 倍率单调 / 反查 ≤ 单买
        / 单买兜底（灯·玉）/ 结余券换购守恒 / 组合倍率加权 */
const fs = require('fs');
const path = require('path');
global.window = {};
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, 'js', f), 'utf8');
eval(rd('currency.js') + '\n' + rd('data.js') + '\n' + rd('engine.js') + '\n' + rd('plan.js') + '\n'
  + rd('classify.js') + '\n' + rd('rates.js') + '\n' + rd('mincost.js') + '\n' + rd('parser.js'));

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
   回归：中间产物回冲 + 双倍箱不叠加之后的券后实付
   数值较 0.7.x 有升有降，两边都是修 bug：
     涨 —— 双倍箱「换绑元」时不再同时白送道具包，旧值靠双算虚低；
     降 —— 充值返的灯/令真的回冲需求了，不再「账本记着、方案照买」。
   ============================================================ */
console.log('\n--- 回归（券后实付，¥） ---');
const REG = [['威曹彰', 832], ['谋钟会', 256], ['任婉', 646], ['春宵彩翼*任婉', 298], ['谋程普', 328]];
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
[['威曹彰', 832], ['谋钟会', 256], ['任婉', 646]].forEach(([n, reg]) => {
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
/* 四目标混池最容易暴露「档位返利震荡」：少买 → 档位掉 → 返利没了 → 缺口。
   收敛后必须一件不缺，否则页面会一边给总价、一边提示「还要：祈福灯 4」。 */
ok('四目标混池不缺料', rL.ok === true && (rL.shortItems || []).length === 0,
  (rL.shortItems || []).map((x) => `${x.label} 缺 ${x.lack}`).join('、') || '无缺口');
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
eq('期初 50 令后只需买 43 令', sNx.audit[0].buy, 43);
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

/* ---------- 断言 7：换期解析器（去专名 / 补六块 / 白送口径） ---------- */
console.log('\n--- 断言 7：换期解析（虚构一期，全部用非本期专名） ---');
const md = [
  '# 测试期 1.1-1.7',
  '',
  '活动时间：2026-01-01 00:00:00 ~ 2026-01-07 23:59:59',
  '',
  '**测试礼盒**',
  '',
  '每开启一次礼盒必定获得灵韵*250，并随机获得以下道具。',
  '',
  '| 道具 | 概率 | 备注 |',
  '| --- | --- | --- |',
  '| 测试武将 | 0.5% | 重复返还大将军印*1 |',
  '| 传世宝玉×2 | 1.2% |  |',
  '| 宝玉碎片×5 | 13% |  |',
  '| 皮肤包 | 10% |  |',
  '',
  '每累计开启测试宝箱*50，可获得奖励：传世宝玉*1，限完成20次。',
  '',
  '**珍宝商店更新**',
  '',
  '| 道具名 | 消耗宝玉 | 可兑换次数 |',
  '| --- | --- | --- |',
  '| 测试武将 | 20 | 1 |',
  '',
  '累计参与测试夺宝80次（消耗测试夺宝券*400），可领取奖励：高级转生丹*1，限完成1次。',
  '',
  '累计参与测试夺宝160次（消耗测试夺宝券*800），可领取奖励：测试皮肤，限完成1次。',
  '',
  '## 二、纳贤活动',
  '',
  '累计纳贤测试将*120，可领取奖励：测试将、大将军印*1，4选1，限完成1次。',
  '',
  '## 三、钜惠商城',
  '',
  '| 商品名称 | 说明 | 售价 |',
  '| --- | --- | --- |',
  '| 测试福利勋章 | 限购买1次。购买后可获得测试福利勋章*1。 | 5888元宝 |',
  '| 纳贤令礼包 | 购买后可获得纳贤令*1。 | 1000元宝 |',
  '',
  '**测试福利勋章**',
  '',
  '| 登录天数 | 奖励1 | 奖励2 |',
  '| --- | --- | --- |',
  '| 第1天 | 纳贤令*2 | 测试夺宝券*20 |',
  '',
  '## 四、充值活动',
  '',
  '单笔充值1200元宝，可领取奖励：测试抵价券（3000-2500）*1，纳贤令*2，限完成1次。',
  '',
  '单笔充值3000元宝，可领取奖励：纳贤令*3，每日限完成1次。',
  '',
  '累计充值达到10000元宝，可领取奖励：测试宝箱*1，限完成1次。',
  '',
  '## 五、消费活动',
  '',
  '每日消费达到3888元宝，可领取奖励：测试夺宝券*5、纳贤令*1，每日限完成1次。',
  '',
  '累计消费达到30000元宝，可领取奖励：传世宝玉*3，限完成1次。',
  '',
  '## 六、测试砸蛋',
  '',
  '| 道具 | 概率 |',
  '| --- | --- |',
  '| 测试皮肤 | 0.5% |',
].join('\n');

const PARSED = window.PARSER.parse(md);
const PM = PARSED.model;
const box = (PM.systems || []).filter((s) => s.kind === 'box');
eqs('礼盒识别数', box.length, 1);
eqs('礼盒名（非本期专名）', box[0] && box[0].name, '测试礼盒');
eqs('礼盒必定掉落', Object.keys(box[0] && box[0].always || {}).length, 1);
eqs('珍宝助力上限', box[0] && box[0].mile.cap, 20);
eqs('宝玉商店项数', (PM.shops.jade || []).length, 1);
eqs('夺宝转盘数（去专名）', Object.keys(PM.shops.duobao || {}).length, 1);
eqs('夺宝进度档数', (Object.values(PM.shops.duobao || {})[0] || []).length, 2);
eqs('纳贤进度项数', (PM.shops.naxian || []).length, 1);
eqs('抵价券面额 key', Object.keys(PM.coupons || {})[0], '券2500');
eqs('抵价券 min', PM.coupons['券2500'] && PM.coupons['券2500'].min, 3000);
eqs('单笔充值档数', PM.chargeTiers.length, 2);
ok('单笔 1200 带券', JSON.stringify(PM.chargeTiers.find((t) => t.need === 1200).gives) === '{"券2500":1,"纳贤令":2}',
  JSON.stringify(PM.chargeTiers.find((t) => t.need === 1200).gives));
eqs('累计充值单独存放', PM.cumCharge.length, 1);
eqs('每日消费档数', PM.dailyTiers.length, 1);
eqs('累计消费档数（含宝玉）', PM.cumSpend.length, 1);
eqs('累计消费给宝玉', (PM.cumSpend[0] && PM.cumSpend[0].gives['传世宝玉']) || 0, 3);
ok('勋章产出进「需购买」而非白送', PM.boughtGains.length > 0 && !PM.freeGains.some((f) => f.from === '测试福利勋章'),
  `bought=${PM.boughtGains.length} free=${PM.freeGains.length}`);
ok('券名归一：测试夺宝券 → 狂欢夺宝券',
  PM.boughtGains.some((b) => b.cur === '狂欢夺宝券') && PM.dailyTiers.some((d) => d.gives['狂欢夺宝券'] === 5));
ok('未建模玩法被标记', PM.unsupported.some((u) => u.name === '幸运砸蛋'),
  PM.unsupported.map((u) => u.name).join('、') || '（无）');

/* ---------------- 真实样本回归：官网公告 → 导入 → 出方案 ----------------
   样本放在 samples/，全部来自官网原文转 markdown，不含任何本期专名依赖。
   只断言「能跑通 + 关键量不漂」，具体金额变动时同步更新这里的期望值。 */
const SAMPLE_DIR = path.join(root, 'samples');
const SAMPLES = [
  { file: '20260904_8061_5810.md', days: 9, targets: 68, money: 6007, note: '开学焕新' },
  { file: '20260910_1235_5818.md', days: 5, targets: 32, money: 1212, note: '秋日活动' },
  { file: '20260916_7285_4514.md', days: 9, targets: 61, money: 3000, note: '中秋砸蛋' },
  { file: '20260922_3527_1115.md', days: 3, targets: 18, money: 1594, note: '金秋预热' },
  { file: '20260929_3980_1514.md', days: 10, targets: 60, money: 5978, note: '金秋盛典' },
  { file: '20261113_2450_3910.md', days: 5, targets: 32, money: 1152, note: '初冬纳贤' },
];
console.log('\n— 真实样本回归 —');
SAMPLES.forEach((sp) => {
  const p = path.join(SAMPLE_DIR, sp.file);
  if (!fs.existsSync(p)) { ok(`${sp.note} 样本存在`, false, p); return; }
  const txt = fs.readFileSync(p, 'utf8');
  const parsed = window.PARSER.parse(txt);
  window.PARSER.apply(parsed.model);
  EN.reset();
  T.reset();
  const l = EN.buildLibrary();
  const names = [...l.keys()].slice(0, 3);
  const plan = S.build(names, { days: P.meta.days, stock: { coupons: {}, yb: 0, items: {} } });
  eqs(`${sp.note} 天数`, P.meta.days, sp.days);
  eqs(`${sp.note} 目标数`, l.size, sp.targets);
  eqs(`${sp.note} 三目标总价`, Math.round(plan.money), sp.money);
  ok(`${sp.note} 目标都有渠道`, (plan.noRoute || []).length === 0, (plan.noRoute || []).join('、'));

  /* --- 中间产物闭环：四道闸 --- */
  ok(`${sp.note} 到账够花`,
    plan.charge.yb + 1e-6 >= plan.netSpend,
    `到账 ${money(plan.charge.yb)} ≥ 净消费 ${money(plan.netSpend)}`);
  {
    /* 右栏「到账」和倍率表同为「总元宝」口径：可花本金 + 单笔档返的绑元。
       有双倍箱的期，倍率表按理论最优选 B（绑元）、方案按目标需求选路线，
       两者路线可能不同，总额也就不同——不强求相等，但到账必须自洽：
       ① 到账 = 可花本金 + 返利；② 返利确实来自走的 A 路线的 gives；
       ③ 返利没混进可花余额（否则「余」双算）。 */
    const chg = plan.charge;
    const arrival = chg.arrivalYb != null ? chg.arrivalYb : chg.yb;
    const rebate = chg.rebateYb || 0;
    const bindFromA = (chg.picks || []).filter((x) => !x.alt && x.t && x.t.gives)
      .reduce((a, x) => a + (x.t.gives['绑定元宝'] || 0) * x.n, 0);
    ok(`${sp.note} 右栏到账口径自洽`,
      Math.abs(arrival - chg.yb - rebate) < 1e-6
        && Math.abs(rebate - bindFromA) < 1e-6
        && arrival + 1e-6 >= chg.yb,
      `到账 ${money(arrival)} = 可花 ${money(chg.yb)} + 返利 ${money(rebate)}，A 路线给 ${money(bindFromA)}`);
  }
  ok(`${sp.note} 逐项不缺料`,
    plan.audit.every((a) => a.total >= a.need - 1e-6),
    plan.audit.map((a) => `${a.label} ${a.total}/${a.need}`).join(' '));
  ok(`${sp.note} 返利假设不超过实际`,
    plan.chargeBackOk !== false,
    Object.keys(plan.chargeBack || {}).filter((k) => plan.chargeBack[k] > 0)
      .map((k) => `${k} 假设${plan.chargeBack[k]}/实际${plan.charge.gives[k] || 0}`).join(' ') || '本轮无回冲');
  {
    /* 海纳百川 / 特惠精选福袋：公告只写「累计纳贤*N，可领取奖励：A、B、…，6选1」，
       没有武将名可抓。以前靠沿用内置名单，换期后名单里全是上一期的将。
       现在必须从公告现解析，且每个候选都要真进目标库。 */
    const nxS = P.systems.find((s) => s.id === 'naxian') || {};
    const hy = nxS.haiyou || [];
    ok(`${sp.note} 多选一解析到候选`, hy.length > 0 && hy.every((h) => h.items.length > 0 && h.n > 0),
      hy.map((h) => `${h.items.length}选1×${h.cap}@${h.n}令`).join(' ') || '无');
    const missing = [];
    hy.forEach((h) => h.items.forEach((nm) => { if (!l.get(nm)) missing.push(nm); }));
    ok(`${sp.note} 福袋候选都在库`, missing.length === 0, missing.join('、') || '全在');
  }

  {
    /* 充值返利里的「绑定元宝 / 红包」必须进表。
       以前 isCurrency 不认绑定元宝、toGives 又不认红包，600 档 giving 成空，
       倍率算成 1.00×——等于「充 600 送 600 绑元」这半个本金白扔。 */
    const bind = P.chargeTiers.filter((t) => (t.gives['绑定元宝'] || 0) > 0);
    /* 只认「可领取奖励：…绑定元宝…」这种真返利；双倍箱的 alt 写的是「或绑元×N」，不算 */
    const hasBindText = /可领取奖励[：:][^。]*绑定元宝/.test(txt);
    ok(`${sp.note} 绑元返利进表`, !hasBindText || bind.length > 0,
      bind.map((t) => `${t.need}档+${t.gives['绑定元宝']}`).join(' ') || '公告有绑元但表里没有');
    /* 红包按概率表期望折，不能按 0 也不能按最低值 */
    Object.keys(P.redPackets || {}).forEach((k) => {
      const rp = P.redPackets[k];
      ok(`${sp.note} ${k} 按期望 ${rp.ev} 折`, rp.ev >= rp.min && rp.ev <= rp.max && rp.ev > 0,
        `区间 ${rp.min}~${rp.max}，期望 ${rp.ev}`);
    });
  }

  {
    /* 纳贤两套池子要分得开：
       标准纳贤 = 指定武将（累计纳贤<将名>*N），通用纳贤 = 全池共享后 k 选 1。
       以前两者都叫「海纳百川」，列表里看不出走的是哪条。 */
    const nxS = P.systems.find((s) => s.id === 'naxian') || {};
    const hy = nxS.haiyou || [];
    ok(`${sp.note} 通用纳贤带来源池`,
      hy.every((h) => h.pool && !/^标准/.test(h.pool)),
      hy.map((h) => `${h.pool}:${h.items.length}选1`).join(' ') || '无通用纳贤');
    const nm = [...l.keys()].find((x) => {
      const t = l.get(x);
      return (t.srcs || []).some((s) => s.sys === 'naxian');
    });
    if (nm) {
      const ctxX = { days: P.meta.days, params: { qifuExtraKnot: P.params.qifuExtraKnot, ratio: 100 } };
      const rs = EN.routesFor(l.get(nm), ctxX).filter((r) => !r.hidden);
      const names = rs.map((r) => r.sysName);
      ok(`${sp.note} 纳贤路线名不重样`, new Set(names).size === names.length, names.join(' / '));
    }
  }

  {
    /* 折算单价：纳贤令按标准标价 1000，不能被「每日前两次 200」的限购特惠拉低；
       夺宝券按既定 60，不能被「888 元宝 15 券」这类限购礼包拆成 59 / 3.1 */
    const u = R.unitTable();
    ok(`${sp.note} 纳贤令折算价不打折`, !u.纳贤令 || u.纳贤令 >= 800, `unit=${u.纳贤令}`);
    ok(`${sp.note} 夺宝券折算价按 60`, Math.round(u['狂欢夺宝券'] || 0) === 60, `unit=${u['狂欢夺宝券']}`);
  }

  {
    /* 每日累计充值的门槛要能对上实际可充档位：
       公告写 5888，游戏里只有 6000 这一档，折成 ¥58.88 会显示成 59。 */
    (P.dailyCumCharge || []).forEach((t) => {
      const hit = P.chargeTiers.some((c) => c.need === t.need);
      ok(`${sp.note} 每日累计充值门槛对得上档位`, hit, `${t.need} 元宝（原始 ${t.raw || t.need}）`);
    });
  }
  {
    /* 结余券的「换灯 / 换玉」必须当期真有单买通道才算数：
       没有灯包、也没有礼盒时，那条路线是凭空捏的，残值应判 0。 */
    const cat = S.catalog();
    const hasLamp = cat.some((p) => p.gives && p.gives['祈福灯'] > 0);
    const hasBox = cat.some((p) => p.gives && p.gives['盒'] > 0);
    const lf = S.leftoverPlan(S.ledger(plan, { coupons: {} }));
    ok(`${sp.note} 券残值判定与当期通道一致`, lf.dead === (!hasLamp && !hasBox),
      `灯包=${hasLamp} 盒包=${hasBox} → ${lf.dead ? '不计残值' : '可换购'}（结余 ${lf.n} 张）`);
  }
  {
    /* 抵价券：省下的钱必须等于「用掉的张数 × 面额」。
       以前按单件判门槛，1000 元宝的商品永远够不到「3000-2500」，
       券成批闲置；现在按「当单总额 = 单价 × 数量」拆单。 */
    const used = plan.coupons || {};
    const wantSave = Object.keys(used)
      .reduce((a, k) => a + used[k] * (((P.coupons || {})[k] || {}).face || 0), 0);
    ok(`${sp.note} 券面额与省下的钱对得上`,
      Math.abs((plan.couponSave || 0) - wantSave) < 1e-6,
      `${money(plan.couponSave || 0)} = ${Object.keys(used).map((k) => `${k}×${used[k]}`).join(' ') || '未用券'}`);
  }
  {
    /* 累计充值档：没达到门槛就不该发。最低一档都没到，返利必须为空。 */
    const tiers = (P.cumCharge || []).filter((t) => Object.keys(t.gives || {}).length);
    const minNeed = tiers.length ? Math.min(...tiers.map((t) => t.need)) : Infinity;
    const got = plan.cumChargeGives || {};
    ok(`${sp.note} 累计档未达标不发`,
      plan.charge.yb >= minNeed - 1e-6 || Object.keys(got).length === 0,
      `充值 ${money(plan.charge.yb)} / 最低档 ${money(minNeed)} → ${JSON.stringify(got)}`);
  }
  {
    /* 走「换绑元」的档位，不能再把道具包算进产出（双倍箱二选一） */
    const altKeys = new Set();
    plan.charge.picks.filter((p) => p.alt).forEach((p) => Object.keys(p.t.gives || {}).forEach((k) => altKeys.add(k)));
    const aOnly = new Set();
    plan.charge.picks.filter((p) => !p.alt).forEach((p) => Object.keys(p.t.gives || {}).forEach((k) => aOnly.add(k)));
    const leaked = [...altKeys].filter((k) => !aOnly.has(k) && (plan.charge.gives[k] || 0) > 0);
    ok(`${sp.note} 双倍箱不叠加`, leaked.length === 0, leaked.join('、') || '无泄漏');
  }
  {
    /* 夺宝转盘：每个档位都要带 gives 字段，方案层才知道「打多少次要多少券、换回什么」。
       以前只存了 item 名，「纳贤令*5」的数量整个丢掉，券等于白返。
       注意：很多期的夺宝档给的是皮肤/宝箱，折算不了，gives 是空对象——那是正常的，
       这里只断言「字段在」，不断言「有值」。 */
    const pools = P.systems.filter((s) => s.pool === 'duobao');
    const all = [];
    pools.forEach((s) => (s.progress || []).forEach((x) => all.push(x)));
    const missing = all.filter((x) => !('gives' in x) || !('tickets' in x));
    const valued = all.filter((x) => x.gives && Object.keys(x.gives).length);
    ok(`${sp.note} 夺宝档位带奖励与券耗`, missing.length === 0,
      missing.length ? `缺字段 ${missing.length} 档`
        : `${all.length} 档，其中 ${valued.length} 档可折价：${valued.map((x) => `${x.tickets}券→${JSON.stringify(x.gives)}`).join(' ')}`);
  }
  {
    /* 夺宝兑换出来的量不能超过「实际返到的券能换到的」，
       否则就是凭空造出纳贤令 */
    const db = plan.duobao || {};
    const pool = db.pool || 0;
    const spent = db.used || 0;
    ok(`${sp.note} 夺宝兑换不超券量`,
      spent <= pool + 1e-6,
      `用 ${spent} 张 / 可支配 ${pool} 张 → ${JSON.stringify(db.got || {})}`);
  }
  {
    /* 每日累计充值档：门槛看「当天充值额」，充 60 元那天 6000 档和 5888 门槛都要发。
       以前 5888 被当成独立充值档，等于「额外再掏 58.88 元买 10 令」。 */
    const dc = P.dailyCumCharge || [];
    if (dc.length) {
      const perDay = {};
      plan.charge.picks.forEach((p) => {
        const y = p.t.need + (p.alt && p.t.alt ? (p.t.alt['绑定元宝'] || 0) : 0);
        (p.days || []).forEach((d) => { perDay[d] = (perDay[d] || 0) + y; });
      });
      const hitDays = Object.keys(perDay).filter((d) => dc.some((t) => perDay[d] + 1e-6 >= t.need)).length;
      const dcGot = {};
      dc.forEach((t) => Object.keys(t.gives).forEach((k) => { dcGot[k] = (dcGot[k] || 0) + t.gives[k] * hitDays; }));
      const realGot = plan.charge.gives || {};
      /* 实际发放量必须 ≥ 按天推算的量（多算不能有，少算说明漏发） */
      const over = Object.keys(dcGot).filter((k) => (dcGot[k] || 0) > (realGot[k] || 0) + 1e-6);
      ok(`${sp.note} 每日累计充值按天发放`, over.length === 0,
        over.length ? over.map((k) => `${k} 应发${dcGot[k]}/实发${realGot[k] || 0}`).join(' ')
          : `达标 ${hitDays} 天 → ${JSON.stringify(dcGot)}`);
    }
  }
});

console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
