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
/* 34（原 43）：自洽校验从「只比档位返」改成「比档位返 + 夺宝兑换」后，
   夺宝换来的令不再被误判成「假设超过实际」，收敛解被保留，少买 9 个令。
   核对表仍是 50+25+1+10+34=120，方案完整。 */
eq('期初 50 令后只需买 34 令', sNx.audit[0].buy, 34);
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

/* 网页版公告页复制的 innerText 没有 "# " 前缀，标题行形如
   "11.21-11.28 小雪活动…"。以前只认 # 行导致标题解析为空、apply 时
   保留上一期标题（日期更新了标题却没换）。这里守一条兜底断言。 */
const NO_HASH_TEXT = [
  '官网首页',
  '游戏公告',
  '11.21-11.28 小雪活动 新将陆文漪孙和 草船借箭活动上线',
  '',
  '活动时间：2026-11-21 00:00:00 ~ 2026-11-28 23:59:59',
  '单笔充值6000元宝，可领取奖励：纳贤令*6，每日限完成1次。',
  '累计纳贤陆文漪*120，可领取奖励：陆文漪，限完成1次。',
].join('\n');
const NH = window.PARSER.parse(NO_HASH_TEXT).model.meta;
ok('无#标题行兜底解析', /小雪活动/.test(NH.title || ''), '标题=' + (NH.title || '(空)'));
eqs('无#标题文本日期', NH.start, '2026-11-21');

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
  { file: '20260910_1235_5818.md', days: 5, targets: 32, money: 1042, note: '秋日活动' },
  { file: '20260916_7285_4514.md', days: 9, targets: 61, money: 3000, note: '中秋砸蛋' },
  { file: '20260922_3527_1115.md', days: 3, targets: 18, money: 1594, note: '金秋预热' },
  { file: '20260929_3980_1514.md', days: 10, targets: 60, money: 5978, note: '金秋盛典' },
  { file: '20261113_2450_3910.md', days: 5, targets: 32, money: 1072, note: '初冬纳贤' },
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
    /* 右栏「到账」= 可花总额 = 本金 + 红包返利 + 福喵返利（+ 首充双倍）。
       返利这次真进预算了（绑定元宝不在回冲品类里，不会双算），所以：
       ① 到账 = 本金 + 红包 + 福喵 + 首充双倍 = spendableYb；
       ② 红包返利确实来自走的 A 路线的 gives；③ 福喵返利非负、有上限。 */
    const chg = plan.charge;
    const arrival = chg.arrivalYb != null ? chg.arrivalYb : chg.yb;
    const rebate = chg.rebateYb || 0;
    const fm = chg.fumiaoYb || 0;
    const fd = chg.firstDoubleYb || 0;
    /* 红包可能来自 gives（可重复）或 onceGives（整期限1次，只计1份）。
       两者都要算进 A 路线返利，否则限1次的红包会被误判成「凭空的钱」。 */
    const bindFromA = (chg.picks || []).filter((x) => !x.alt && x.t)
      .reduce((a, x) => a + ((x.t.gives || {})['绑定元宝'] || 0) * x.n
        + (x.n > 0 ? ((x.t.onceGives || {})['绑定元宝'] || 0) : 0), 0);
    const fmCap = P.fumiao && P.fumiao.enabled ? P.fumiao.cap : 0;
    ok(`${sp.note} 右栏到账口径自洽`,
      Math.abs(arrival - chg.yb - rebate - fm - fd) < 1e-6
        && Math.abs((chg.spendableYb != null ? chg.spendableYb : arrival) - arrival) < 1e-6
        && Math.abs(rebate - bindFromA) < 1e-6
        && fm >= -1e-6 && fm <= (fmCap || Infinity) * (P.meta.days || 99) + 1e-6
        && arrival + 1e-6 >= chg.yb,
      `到账 ${money(arrival)} = 本金 ${money(chg.yb)} + 红包 ${money(rebate)} + 福喵 ${money(fm)}，A 路线给 ${money(bindFromA)}`);
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
    /* 福喵纳财：公告写了「每日消费返利、上限 1w」就不能再当未建模玩法。
       返利比例必须逐项解析出来，且 3 局 / 充值 600 / 消费 1w 三档齐全——
       手搓攻略「每天消费 1w 次日返 1200」正是靠 5%+5%+2%。 */
    const hasFm = /福喵/.test(txt);
    const fm = P.fumiao;
    const kinds = (fm && fm.tasks || []).map((t) => t.kind);
    ok(`${sp.note} 福喵返利建模`,
      !hasFm || (!!fm && fm.cap > 0 && ['games', 'charge', 'spend'].every((k) => kinds.includes(k))),
      fm ? `上限 ${fm.cap}/日 · ${kinds.join('/')}` : '公告有福喵但未建模');
    if (hasFm) ok(`${sp.note} 福喵不再列为未建模`,
      !(window.PRESET.unsupported || []).some((u) => /福喵/.test(u.name)));
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

/* ---------------- 断言 7：锁定充值时的收敛与候选选择（¥132 回归） ---------------- */
console.log('\n--- 断言 7：锁定充值收敛 ---');
{
  /* 初冬这单：用户锁定 ¥132（1200 档×1 + 6000 档×2）要星曹仁。
     两个独立的 bug 叠加会报「还差 67352 元宝」：
       ① build() 锁定后所有候选 money 都是 132，只比 money 就永远挑第 0 轮
          （返利还没回冲、need 最大的那个）。
       ② solveOnce 的自洽校验拿 used（含夺宝兑换的令）去比 rw（只含档位返的令），
          收敛解被误判「假设>实际」剔除，又退回第 0 轮。
     任一处回归都会让锁定方案报价虚高一倍以上。 */
  const md132 = 'samples/20261113_2450_3910.md';
  if (fs.existsSync(md132)) {
    const txt132 = fs.readFileSync(md132, 'utf8');
    const ps = window.PARSER.parse(txt132);
    window.PARSER.apply(ps.model);
    EN.reset(); T.reset();
    const tiers = window.PRESET.chargeTiers;
    const idxOf = (need) => tiers.findIndex((t) => t.need === need);
    const lock = [{ i: idxOf(1200), n: 1 }, { i: idxOf(6000), n: 2 }];
    const r = window.SCHED.build(['星曹仁'], {
      days: window.PRESET.meta.days, stock: {}, lockCharge: lock,
    });
    eq('¥132 锁定仍锁在原组合', Math.round(r.money), 132);
    eq('¥132 锁定方案完整不缺件', r.shortItems.length, 0);
    ok('¥132 锁定收敛到回冲后的解',
      r.charge && Math.abs(r.netSpend - 24052) < 1e-6,
      `净消费 ${Math.round(r.netSpend)}（回归前 80552 / 修复中间态 35552）`);
    ok('¥132 锁定已选出夺宝回冲解',
      ((r.audit[0] || {}).buy) === 49,
      `买 ${(r.audit[0] || {}).buy} 令（回归前 66 / 收敛后 49）`);
    /* 红包返利 6770 + 福喵返利 ~4754 都进可花总额，缺口从 10852 清零。
       这两笔是公告明确的真实收益，之前只展示不进预算，才报「还差一万多」。 */
    ok('¥132 锁定返利已进可花总额',
      r.charge && r.charge.fumiaoYb > 0 && r.charge.rebateYb > 0
        && r.charge.spendableYb > r.charge.yb,
      `本金 ${money(r.charge.yb)} + 红包 ${money(r.charge.rebateYb)} + 福喵 ${money(r.charge.fumiaoYb)} = 可花 ${money(r.charge.spendableYb)}`);
    ok('¥132 锁定缺口清零（不再报还差一万多）',
      (r.overBudget || 0) < 1e-6,
      `净消费 ${money(r.netSpend)} - 可花 ${money(r.charge.spendableYb)} = 缺口 ${money(r.overBudget || 0)}`);
    ok('¥132 锁定首充双倍默认不开启',
      (r.charge.firstDoubleYb || 0) === 0,
      `首充双倍 ${money(r.charge.firstDoubleYb || 0)}（公告未写明，默认关）`);
  }
}

{
  /* 限1次的活动红包不能被按天重复参与（小雪期用户报障）：
     单笔 3000 同时挂「纳贤令×3 / 每日限1次」和「大红包 / 限完成1次」。
     以前合并进 gives，¥30×7 会把 6150 红包算成 43050，倍率虚高到 4.33×。 */
  const mini = [
    '## 充值活动',
    '单笔充值3000元宝，可领取奖励：纳贤令*3，每日限完成1次。',
    '单笔充值3000元宝，可领取奖励：绑定元宝*6150，限完成1次。',
    '',
    '**测试红包**',
    '',
    '| 金额 | 概率 |',
    '| --- | --- |',
    '| 绑定元宝*5000 | 100% |',
  ].join('\n');
  const ps = window.PARSER.parse(mini);
  const tier = ps.model.chargeTiers.find((t) => t.need === 3000);
  ok('限1次红包从主档分离到 onceGives',
    tier && (tier.gives['绑定元宝'] || 0) === 0
      && ((tier.onceGives || {})['绑定元宝'] || 0) === 6150,
    `gives=${JSON.stringify(tier && tier.gives)} onceGives=${JSON.stringify(tier && tier.onceGives)}`);
  ok('可重复奖励仍留在主档 gives',
    tier && (tier.gives['纳贤令'] || 0) === 3 && tier.perDay === 1,
    `纳贤令 ${tier && tier.gives['纳贤令']} perDay ${tier && tier.perDay}`);

  /* 走一遍真实解析链路验证倍率表口径：apply→breakdown。
     为避免污染后续样本，先备份相关全局，验完恢复。 */
  const backup = {
    chargeTiers: P.chargeTiers, redPackets: P.redPackets, coupons: P.coupons,
    systems: P.systems, dailyTiers: P.dailyTiers, cumSpend: P.cumSpend,
    cumCharge: P.cumCharge, units: R.unitTable(),
  };
  window.PARSER.apply(ps.model);
  R.resetUnit(); EN.reset(); T.reset();
  const r7 = R.combo([{ need: 3000, n: 7 }], 8);
  const bd7 = R.breakdown(r7, 8);
  eq('¥30×7 红包只计1份不重复参与', Math.round(bd7.b.bang), 6150);
  eq('¥30×7 纳贤令仍按7份累乘', Math.round(bd7.b.naxian), 21000);
  ok('¥30×7 倍率回落到合理区间',
    bd7.ratioAll < 3 && bd7.ratioAll > 1,
    `${bd7.ratioAll.toFixed(2)}×（回归前 4.33×）`);
  /* 恢复全局，避免影响 check.js 后续若有断言 */
  P.chargeTiers = backup.chargeTiers; P.redPackets = backup.redPackets;
  P.coupons = backup.coupons; P.systems = backup.systems;
  P.dailyTiers = backup.dailyTiers; P.cumSpend = backup.cumSpend;
  P.cumCharge = backup.cumCharge; R.resetUnit(); EN.reset(); T.reset();
}

{
  /* 小雪期用户报障：倍率表「推荐」方案会把单一档位买到天花板（¥30×8、
     ¥128×6），其中 ¥128/¥328/¥648 只有绑定元宝、倍率恒定 2.0×，纯属凑金额，
     用户要求「只买到有意义的档位」。修复：每档算推荐上限 prefCap——
     纯绑元档限 1 次，带券/令的每日档可买多次（≤3），靠多档组合堆金额。 */
  const xue = 'samples/20261121_xiaoxue.md';
  const xueAlt = 'G:/download/2026-11-20 11.21-11.28 小雪活动 新将陆文漪&孙和 侯昭宁限定&李昭仪传说 草船借箭活动上线.md';
  const src = fs.existsSync(xue) ? xue : (fs.existsSync(xueAlt) ? xueAlt : null);
  if (src) {
    const txt = fs.readFileSync(src, 'utf8');
    const ps = window.PARSER.parse(txt);
    const backup = {
      chargeTiers: P.chargeTiers, redPackets: P.redPackets, coupons: P.coupons,
      systems: P.systems, dailyTiers: P.dailyTiers, cumSpend: P.cumSpend,
      cumCharge: P.cumCharge, fumiao: P.fumiao, jadeSpend: P.jadeSpend, units: R.unitTable(),
    };
    window.PARSER.apply(ps.model);
    R.resetUnit(); EN.reset(); T.reset();
    const days = P.meta.days;
    const tiers = R.tierList(days);

    const t128 = tiers.find((t) => t.need === 12800);
    const t30 = tiers.find((t) => t.need === 3000);
    const t328 = tiers.find((t) => t.need === 32800);
    const t648 = tiers.find((t) => t.need === 64800);

    /* 自选福袋按最高价值折算（用户口径）：¥128 档的「小雪武将自选福袋」
       名单里有「武将招募令*10」，折成定向招募令 10 个 = 10000 元宝，归 sel15 列。
       这档从此「每次充值有对应道具拿」，不再被误判为无额外奖励的纯绑元档。 */
    ok('¥128 档自选福袋折算进 gives',
      (P.chargeTiers[t128.i].gives || {})['定向招募令'] === 10,
      `¥128 gives=${JSON.stringify(P.chargeTiers[t128.i].gives)}`);
    const bd128 = R.breakdown(R.combo([{ i: t128.i, n: 1 }], days), days);
    /* 本期无「15选1」玩法（hasSel15=false），福袋折出的定向招募令归到 other 列，
       不再显示在 15-1；有 15选1 的期仍归 sel15。两种口径下福袋价值都必须进倍率。 */
    const bagCol = P.meta.hasSel15 ? bd128.b.sel15 : bd128.b.other;
    ok('¥128 倍率含福袋价值（不再恒定 2.0×）',
      bagCol >= 10000 && bd128.ratioAll > 2.6,
      `${P.meta.hasSel15 ? '15-1' : '其他'}=${money(bagCol)} 倍率=${bd128.ratioAll.toFixed(2)}×`);
    ok('福袋折算只作用于充值档，不污染消费档',
      !P.dailyTiers.some((t) => Object.keys(t.gives || {}).some((k) => /定向/.test(k))),
      '消费档的定向福袋保留 only 口径，不折成通用令回冲');

    /* 推荐上限：真·纯绑元大档（¥328/¥648）限 1 次；
       ¥128 因有福袋额外奖励、¥30 因有券令，都是「有意义」档，可买多次。 */
    ok('纯绑元大档 prefCap=1（¥328/¥648）',
      t328 && t328.prefCap === 1 && t648 && t648.prefCap === 1,
      `¥328 prefCap=${t328 && t328.prefCap} / ¥648 prefCap=${t648 && t648.prefCap}`);
    ok('¥128 有福袋后 prefCap>1（变成有意义档）',
      t128 && t128.prefCap > 1,
      `¥128 prefCap=${t128 && t128.prefCap}（真实 cap=${t128 && t128.cap}）`);
    ok('带券令的每日档 prefCap>1（¥30 仍可买多次）',
      t30 && t30.prefCap > 1,
      `¥30 prefCap=${t30 && t30.prefCap}（真实 cap=${t30 && t30.cap}）`);
    ok('真实 cap 未被改动（全买满链路不受影响）',
      t30 && t30.cap > t30.prefCap,
      `¥30 真实 cap=${t30 && t30.cap} > 推荐 prefCap=${t30 && t30.prefCap}`);

    /* bestMix 各预算档的方案：任何单档购买数不得超过 prefCap */
    const maxBudget = Math.max(200, (P.chargeTiers || []).reduce((a, t) => {
      const cap = t.total > 0 ? t.total : (t.perDay ? t.perDay * days : 1);
      return a + (t.need / 100) * cap;
    }, 0));
    const pool = R.bestMix(days, maxBudget, 260, { minShare: 0 });
    let worst = 0, worstLabel = '';
    pool.forEach((x) => (x.combo.picks || []).forEach((pp) => {
      const tc = tiers.find((t) => t.i === pp.tier.i);
      const lim = tc ? tc.prefCap : 1;
      if (pp.n > lim && pp.n - lim > worst) {
        worst = pp.n - lim;
        worstLabel = `¥${pp.tier.rmb}×${pp.n} > prefCap ${lim}`;
      }
    }));
    ok('阶梯方案：没有任何档位超过推荐上限',
      worst === 0,
      worst ? worstLabel : `已检查 ${pool.length} 个方案，单档最高不超 prefCap`);
    const bigPile = pool.find((x) => (x.combo.picks || []).some((pp) => pp.tier.need >= 32800 && pp.n > 1));
    ok('阶梯方案：纯绑元大档（¥328/¥648）没有重复购买',
      !bigPile,
      bigPile ? bigPile.combo.picks.map((pp) => `¥${pp.tier.rmb}×${pp.n}`).join('+') : '¥328/¥648 均各≤1次');
    const meaningful128 = pool.some((x) => (x.combo.picks || []).some((pp) => pp.tier.need === 12800 && pp.n > 1));
    ok('阶梯方案：¥128 有福袋后允许重复买（凑有意义档）',
      meaningful128,
      meaningful128 ? '已出现 ¥128×2 及以上的阶梯组合' : '未出现（可能被更高倍率档挤掉，非错误）');

    /* 消费节奏对比：一次性 vs 分天，判断哪种能拿到更多每日档奖励 */
    const rhythms = S.spendRhythm(50000, days);
    eq('消费节奏给出三种策略', rhythms.length, 3);
    const lump = rhythms.find((x) => x.key === 'lump');
    const even = rhythms.find((x) => x.key === 'even');
    const top = rhythms.find((x) => x.key === 'top');
    ok('一次性花完只吃一次每日档', lump && lump.daysUsed === 1,
      `一次性用 ${lump && lump.daysUsed} 天，命中 ${lump && lump.hitCount} 档`);
    ok('分天花命中档位多于一次性', even && lump && even.hitCount > lump.hitCount,
      `一次性 ${lump && lump.hitCount} 档 vs 平摊 ${even && even.hitCount} 档`);
    ok('顶门槛策略不劣于平摊', top && even && top.hitCount >= even.hitCount,
      `顶门槛 ${top && top.hitCount} 档 vs 平摊 ${even && even.hitCount} 档`);
    /* 总消费不足以单日顶最高档时，顶门槛不能退化成一次性 */
    const small = S.spendRhythm(21000, days);
    const smallTop = small.find((x) => x.key === 'top');
    const smallLump = small.find((x) => x.key === 'lump');
    ok('低预算时顶门槛不退化成一次性',
      smallTop && smallTop.daysUsed > 1 && smallTop.hitCount > smallLump.hitCount,
      `顶门槛用 ${smallTop && smallTop.daysUsed} 天命中 ${smallTop && smallTop.hitCount} 档，一次性 ${smallLump && smallLump.hitCount} 档`);

    /* 消费送宝玉：整期累计消费到 3万/6万/10万/20万 → 送传世宝玉 3/3/4/10。
       这些档写在《传世宝玉》章节，标题不含「消费」，旧解析整段漏掉，
       导致工具不知道「消费能换玉」、更不会提示补到宝玉档。 */
    eq('小雪期解析出 4 档消费送宝玉', (P.jadeSpend || []).length, 4);
    eqs('宝玉档门槛 3万→3玉',
      (P.jadeSpend[0].need === 30000 && P.jadeSpend[0].gives['传世宝玉'] === 3), true);
    eqs('宝玉档门槛 20万→10玉',
      (P.jadeSpend[3].need === 200000 && P.jadeSpend[3].gives['传世宝玉'] === 10), true);
    /* 补档分析：净消费 2.5 万，下一档是 3 万，补 5000 拿 3 玉 */
    const jt = S.spendJadeTopup(25000);
    ok('补档分析：给出下一档与差额',
      jt.on && jt.next && jt.next.need === 30000 && Math.round(jt.next.gap) === 5000,
      `下一档 ${jt.next && jt.next.need}，差 ${jt.next && Math.round(jt.next.gap)}`);
    eq('补档分析：补 5000 得 3 玉', jt.topup.jade, 3);
    ok('补档分析：已达成档标记正确',
      S.spendJadeTopup(30000).tiers[0].reached === true
        && S.spendJadeTopup(30000).tiers[1].reached === false,
      '3 万达成第 1 档、未达成第 2 档');
    ok('补档分析：全额拿满后无下一档',
      S.spendJadeTopup(200000).next === null,
      '20 万后 next=null');
    ok('消费送宝玉不混入 cumSpend 回冲',
      !(P.cumSpend || []).some((t) => t.gives && t.gives['传世宝玉']),
      `cumSpend ${(P.cumSpend || []).length} 档，无一含宝玉`);

    /* 专属纳贤令字段判断（用户强调「首发武将有专属令、注意字段选择」）：
       「陆文漪纳贤令」必须识别成「专令:陆文漪」只对陆文漪生效，
       不能误折成通用纳贤令（那样任何武将都能用，报价虚低）。 */
    ok('专令：礼包里的陆文漪纳贤令识别为专属令',
      S.catalog().some((p) => (p.gives || {})['专令:陆文漪'] > 0)
        && !S.catalog().some((p) => /纳贤折扣礼包/.test(p.name || '') && (p.gives || {})['纳贤令'] > 0),
      `catalog 专令礼包：${S.catalog().filter((p) => (p.gives || {})['专令:陆文漪'] > 0).map((p) => p.name).join('、')}`);
    ok('专令：复合档白送专属令带 only 字段',
      (P.freeGains || []).some((f) => f.cur === '专令:陆文漪' && (f.only || []).includes('陆文漪')),
      `专令白送 ${(P.freeGains || []).filter((f) => /^专令:/.test(f.cur)).reduce((a, f) => a + f.qty, 0)} 个`);
    /* 首发将低价：陆文漪有专属令抵扣，应比同池的李昭仪（无专属令）便宜 */
    const rLwy = S.build(['陆文漪'], { days: P.meta.days, stock: { coupons: {}, yb: 0, items: {} } });
    const rLzy = S.build(['李昭仪'], { days: P.meta.days, stock: { coupons: {}, yb: 0, items: {} } });
    const aLwy = (rLwy.audit || []).find((a) => a.key === '纳贤令');
    ok('专令：陆文漪纳贤令有白送抵扣',
      aLwy && aLwy.free > 0,
      `陆文漪 free=${aLwy && aLwy.free}，李昭仪 free=${((rLzy.audit || []).find((a) => a.key === '纳贤令') || {}).free}`);
    ok('专令：专属令不误折通用（李昭仪无白送令）',
      ((rLzy.audit || []).find((a) => a.key === '纳贤令') || {}).free === 0,
      `李昭仪报价 ¥${Math.round(rLzy.money)} > 陆文漪 ¥${Math.round(rLwy.money)}`);

    /* 草船借箭：概率武将期望定价（用户给的 9 张人工精测图）
       公告箭矢概率表加权 = 150/抽，保底 80；孙和 12000 箭矢 = 期望 80 抽。
       孙和/徐馨进目标库、noRoute 不误报，覆盖情况由 ccbjPlan 给出。 */
    ok('草船：公告箭矢期望=150、保底=80（对齐人工图）',
      P.ccbj && P.ccbj.arrow.ev === 150 && P.ccbj.arrow.min === 80,
      `ev=${P.ccbj && P.ccbj.arrow.ev}, min=${P.ccbj && P.ccbj.arrow.min}`);
    ok('草船：概率武将进目标库且不误报无渠道',
      EN.buildLibrary().has('孙和') && EN.buildLibrary().has('徐馨')
        && !(S.build(['孙和'], { days: P.meta.days, stock: { coupons: {}, yb: 0, items: {} } }).noRoute || []).includes('孙和'),
      '孙和/徐馨在库，选中后 noRoute 不含孙和');
    /* 期望抽数：孙和 12000/150=80；草人不足时给出补档步骤 */
    const ccEmpty = S.ccbjPlan(['孙和'], { charge: { yb: 0 }, netSpend: 0 }, 8);
    ok('草船：孙和期望抽数=80、空方案判定不足',
      ccEmpty.targets[0].drawsEv === 80 && ccEmpty.targets[0].covered === false,
      `drawsEv=${ccEmpty.targets[0].drawsEv}, status=${ccEmpty.targets[0].status}`);
    ok('草船：缺口给出补档步骤（充3万+消2万可覆盖）',
      ccEmpty.targets[0].topup && ccEmpty.targets[0].topup.steps.length > 0
        && ccEmpty.targets[0].topup.chargeYb === 30000,
      `补档：${ccEmpty.targets[0].topup && ccEmpty.targets[0].topup.steps.map((s) => s.type + s.need).join('+')}`);
    /* 草人产出一档不混进普通需求：草船武将报价为 0（消费副产品），不虚增价格 */
    ok('草船：概率武将不虚增报价（消费副产品）',
      S.build(['孙和'], { days: P.meta.days, stock: { coupons: {}, yb: 0, items: {} } }).money === 0,
      '单孙和报价 ¥0（靠方案消费产草人覆盖，不单独计价）');

    /* 恢复全局 */
    P.chargeTiers = backup.chargeTiers; P.redPackets = backup.redPackets;
    P.coupons = backup.coupons; P.systems = backup.systems;
    P.dailyTiers = backup.dailyTiers; P.cumSpend = backup.cumSpend;
    P.cumCharge = backup.cumCharge; P.fumiao = backup.fumiao;
    P.jadeSpend = backup.jadeSpend;
    R.resetUnit(); EN.reset(); T.reset();
  }
}

/* ---------- 网页 innerText 兼容（一键导入真实路径）----------
   从公告网页 copy 的正文：表格是 tab 分隔、章节标题「四、草船借箭」无 ## 前缀。
   parser 入口 normalizeTabTables 把它们补成管道表格 + ## 标题；否则商店/草船等
   表格型板块全解析不出来 → 目标无购买路线 → 界面全「未满足确定途径」。 */
{
  const PARSER = global.window.PARSER;
  const webText = [
    '11.28-12.5 网页innerText测试活动 换期标题识别',
    '一、草船借箭',
    '每日任务（每日重置）\t获得草人',
    '累计充值5000元宝\t10',
    '',
    '数量\t概率',
    '80\t20.00%',
    '100\t20.00%',
    '',
    '道具名\t消耗箭矢\t限制兑换次数',
    '孙和\t12000\t1',
    '二、传世宝玉',
    '道具名\t消耗宝玉\t可兑换次数',
    '传世宝玉\t500\t5',
  ].join('\n');
  const wp = PARSER.parse(webText);
  const wm = wp.model || wp;
  ok('网页innerText：tab表格转成商店数据',
    !!(wm.shops && wm.shops.jade && wm.shops.jade.length > 0),
    `jade商店 ${wm.shops && wm.shops.jade ? wm.shops.jade.length : 0} 项`);
  ok('网页innerText：无##章节标题被识别（草船概率表）',
    !!(wm.ccbj && wm.ccbj.arrow && wm.ccbj.arrow.prob.length > 0),
    `箭矢概率档 ${wm.ccbj && wm.ccbj.arrow ? wm.ccbj.arrow.prob.length : 0}`);
  ok('网页innerText：无#标题兜底取到日期标题',
    !!(wm.meta && /11\.28-12\.5/.test(wm.meta.title || '')),
    `title=${wm.meta && wm.meta.title}`);
}

/* ---------- 充值分析表展示口径（小雪期用户反馈）---------- */
{
  const PARSER = global.window.PARSER;
  /* 两个 ¥12 档：11/21 与 11/22，标签必须一个是「首日」一个是「11/22」，不能都叫「首日」。 */
  const md = fs.readFileSync(path.join(root, 'samples/20261121_xiaoxue.md'), 'utf8');
  const parsed = PARSER.parse(md);
  PARSER.apply(parsed.model);
  const d12 = R.tierList(P.meta.days).filter((t) => t.need === 1200);
  eqs('小雪期两个¥12档标签不重复', d12.map((t) => t.tag).sort().join('|'), '11/22|首日');
  ok('小雪期无15选1（hasSel15=false）', P.meta.hasSel15 === false,
    `hasSel15=${P.meta.hasSel15}`);
  /* 本期无 15选1 时，福袋折出的定向招募令归 other 列，不再出现在 sel15。 */
  const bd = R.breakdown(R.fullMix(P.meta.days).combo, P.meta.days);
  ok('无15选1期：定向产出归其他列、sel15为空',
    bd.b.sel15 === 0 && bd.b.other > 0 && Math.abs(bd.ratioAll - bd.ratioNo15) < 1e-9,
    `sel15=${Math.round(bd.b.sel15)} other=${Math.round(bd.b.other)}`);
  /* 方案池要够多（副产物驱动 + 多预算档），不能只有固定几个 */
  let pool = [];
  try { pool = R.bestMix(P.meta.days, 9000, 400, { minShare: 0 }); } catch (e) { pool = []; }
  ok('充值方案候选池足够大（非固定几组）', pool.length >= 40, `候选 ${pool.length} 组`);
}

console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
