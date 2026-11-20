# 代码结构

给想改代码的人。整个项目约 4,900 行，无框架、无打包、无 TypeScript，改完刷新浏览器就生效。

---

## 分层

```
currency.js   品类归一（专名 → 引擎 key）        窗口对象 CUR
   │
data.js       纯数据（PRESET）
   │
   ├─ engine.js     目标 → 中间道具 → 元宝      窗口对象 E
   ├─ plan.js       元宝 → 排程 → 券 → 充值      窗口对象 SCHED
   │
   ├─ classify.js   归类 + 分途径汇总             窗口对象 TARGETS
   ├─ rates.js      倍率表 + 组合 + 凑额 DP       窗口对象 RATES
   ├─ mincost.js    最低消费反查                  窗口对象 MINCOST
   │
   ├─ parser.js     公告 md 解析（可选）
   └─ ui.js         所有 DOM 操作
```

`index.html` 里的加载顺序不能乱——每个模块是 IIFE，加载时就把 `window.PRESET` 等抓进闭包了：

```html
currency.js → data.js → engine.js → plan.js → classify.js → rates.js → mincost.js → parser.js → ui.js
```

所有模块都挂在 `window` 上（`window.E` / `window.SCHED` / ...），因为要能 `file://` 直接开，不能用 ES module（跨域限制）。`tools/check.js` 也是靠 `eval` 这几个文件 + 伪造 `global.window` 来跑断言的。

---

## 核心数据流

```
选中目标 ["威曹彰", "谋钟会"]
  │
  ├─ E.buildLibrary()        所有目标 → Map<name, {name, cat, srcs}>
  ├─ E.routesFor(t, ctx)     每个目标的所有获取路线 + 券前元宝
  │
  └─ S.build(names, {days, stock})
       ├─ needOf()           合并同池需求（灯/令/盒/券...）
       ├─ 迭代 4 轮
       │    ├─ comboSweep()  礼包组合扫
       │    ├─ 排程枚举       活跃天数 × 每天冲到哪档
       │    ├─ settle()      抵价券结算
       │    └─ tierSum()     档位返利 → 回冲下一轮需求
       ├─ chargePlan()       充值组合 DP（先逐档定 A/B 路线，再凑额；含水晶球约束）
       ├─ 外层不动点          充值返到的券+道具喂回上一轮重算，只减不增，选自洽解
       └─ → { money, netSpend, couponSave, charge, chargeBack, audit, ... }
```

---

## 各模块职责

### `engine.js` — 路线引擎

| API | 作用 |
|---|---|
| `E.fmt(n)` | 数字格式化（千分位 / 万） |
| `E.buildLibrary()` | 扫描所有 systems / 直售 / 消费奖励，建目标索引，末尾按来源重分类皮肤 |
| `E.routesFor(target, ctx)` | 一个目标的所有路线（按券前元宝排序） |
| `E.buyCost(sys, units, ctx)` | 某个系统买 N 个单位的最优买法（单抽 / 十连 / 礼包） |
| `E.knotPlan(knots, ctx)` | 结数 → 灯数（1:1） |

路线对象关键字段：`label`（怎么拿）、`mid`（中间道具数组）、`yb`（券前元宝）、`basis`（`exact` / `avg` / `prob`）、`hidden`（概率路线不进方案）。

### `plan.js` — 排程引擎

| API | 作用 |
|---|---|
| `S.build(names, opts)` | 主入口，返回完整方案 |
| `S.rows(plan)` | 逐日展开（日期、充值、消费、买什么、领什么） |
| `S.needOf(...)` | 单目标 → 中间道具需求 |
| `S.ledger(plan, stock)` | 抵价券流水（获得 / 用掉 / 结余） |
| `S.condRows(plan, names)` | 条件奖励三态标注 |
| `S.freeRows(names)` | 免费到手 |
| `S.leftoverPlan(led)` | 结余券换购灯 / 玉 |
| `S.knotLamps(n)` | 同 engine 的 1:1 口径 |

`S.build` 返回里最重要的几个：`money`（要充多少人民币）、`netSpend`（实付元宝）、`couponSave`（券抵）、`charge.picks`（充值组合）、`audit`（核对表数据）。

**改这里要小心**：`audit` 的字段名被 UI 和 check.js 同时依赖。

### `classify.js` — 归类与汇总

四个分类是硬编码的：`qifu` / `jade` / `naxian` / `other`，判定逻辑在 `catOf()`：

```js
kind === 'knot'    → qifu
kind === 'box' / 'sale' 且池子是宝玉 → jade
kind === 'progress' 且 sysId 是纳贤 → naxian
其余 → other
```

`T.build(ctx, lib)` 产出带分类的目标数组（带缓存，ctx 变了要 `T.reset()`）；`T.summary(names, arr)` 产出右栏那张四行表。

### `rates.js` — 倍率与凑额

`tierList(days)` 把 `chargeTiers` 展开成带 `ratio`（倍率）、`cap`（次数）、`tag`（首日/11-8起/每日）、`rebVal`（返利折算）的档位列表。

`combo(list, days)` 算组合倍率，`list` 里用**档位索引 `i`** 而不是 `need`——两个 ¥12 档金额相同，用金额会认错。

`solve(x, days, mode)` 是凑额 DP，`mode` 为 `cost` / `cnt` / `reb`。

### `mincost.js` — 反查

`MC.search(name, qty, ctx, {stock})`。三层枚举 + 下界剪枝，返回 `{rows: [{}], cands, pruned}`。跑得慢（单个目标几十毫秒到几百毫秒），所以只在弹窗里按需调用。

### `currency.js` — 品类归一

公告每期换专名（寒露夺宝券 / 重阳夺宝券 / 秋华夺宝券），引擎只认品类。`CUR.canon(name)` 把任意 `XX夺宝券` 收敛成 `K.duobao`，`CUR.coupon('抵价券（3000-2500）')` 按面额拆成 `{face, min, key:'券2500'}`。

内部 key 沿用 `狂欢夺宝券` / `狂欢水晶球` 这两个历史名字，是为了不动 engine / rates / plan 里几十处引用；展示时用 `CUR.show(key)` 还原成本期叫法（`P.curLabel`）。

### `parser.js` — 公告解析

`parse(md)` → `{model, report}`，`apply(model)` 把 model 全量写回 `PRESET`。

```js
model = {
  meta, systems, shops,                      // 礼盒/商店/系统
  coupons, chargeTiers, cumCharge,          // 充值
  dailyTiers, cumSpend,                     // 消费
  bundles,                                  // 商城商品（含限时商品与单件直售）
  freeGains, boughtGains,                   // 真白送 / 需购买
  directSales, unsupported, curLabel, miss,
}
```

三条不变量：

1. **不认专名**——只认表头形状和固定句式；
2. **apply 先清空**——解析不到的板块一律置空，写 `log`，绝不沿用上一期；
3. **白送口径分家**——表头 `天数` 是活跃任务（真白送），`登录天数/累计登录` 是买勋章才有的（`boughtGains`）。

解析不到的东西进 `model.miss`，UI 在导入弹窗里列出来。

### `ui.js` — 界面

没有框架，全是 `document.createElement` 和模板字符串。几百行内分块：

- `state` 全局状态（`q` / `cat` / `selected` / `pin` / `lib` / `ctx`）
- `recalc()` 唯一的重算入口
- `renderGrid()` / `renderPlan()` / `renderSummary()` / `renderOutput()` 各区块
- 六个弹窗各自的 `open*` / `render*`

**缓存坑**：`routeCache` 按「ctx 签名 + 目标名」缓存路线，改 `ctx.days` 或参数后必须 `markCtx()` 清缓存，否则数字不更新。

---

## 加一个新功能怎么下手

### 加一个目标（武将 / 皮肤）

改数据就行，见 [数据维护](data.md)。不用动代码。

### 加一种获取途径

1. `engine.js` 的 `routesFor` 里加分支，产出统一格式的 route 对象（`mid` / `yb` / `basis`）
2. `classify.js` 的 `catOf` 里加判定（如果要独立分类，还要改 `CATS` 数组和 UI 的 chips）
3. `plan.js` 的 `KEYS` 里加中间道具名（如果引入了新道具池）
4. `tools/check.js` 加断言
5. 跑回归，五个基准值不能变

### 改计算口径

几乎都在 `plan.js` 的 `build` 里。**改完必须跑 `node tools/check.js`**：回归值变了说明影响面超出预期，先想清楚是不是故意改的。

---

## 自检脚本

`tools/check.js` 用 `eval` 把 `js/*.js` 串起来跑（伪造 `window`），不依赖浏览器也不依赖 npm：

```bash
node tools/check.js
```

断言分十组：回归、四类覆盖、券守恒、倍率单调、反查 ≤ 单买、单买、换购守恒、组合倍率、期初抵扣、皮肤分类。全部 `console.log` 输出，没有测试框架。

CI 在 `.github/workflows/check.yml`，push 会自动跑（Node 18/20 两版）。

---

## 风格约定

- 中文注释，术语跟公告一致（"档位""满额""达标"）
- 金额统一 `E.fmt()`，不要自己 `toFixed`
- 元宝是整数，人民币只在最外层 `/100` 一次，中间层不要来回转
- 新增假设参数统统放 `PRESET.params`，不要散在代码里
- 不要引入依赖。这个项目的卖点之一就是双击能开
