/* ============================================================
   公告 md 解析器 v2
   ------------------------------------------------------------
   设计原则：
   1) 不认专名，只认「表格形状 + 固定句式」——寒露夺宝券 / 重阳夺宝券
      都通过 CUR.canon() 收敛成引擎认识的品类 key；
   2) 每块解析都产出报告行，解析不到就明确记进 model.miss，
      不再静默沿用上一期的数据；
   3) 「真白送」与「买个东西才有的领取表」严格分开：
      表头「登录天数 / 累计登录」= 需购买；表头「天数」= 活跃任务，真白送。
   ============================================================ */
window.PARSER = (function () {
  const CUR = window.CUR;

  /* ---------------- 基础工具 ---------------- */
  const lines = (t) => t.replace(/\r/g, '').replace(/\uFEFF/g, '').split('\n');
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  /* 单元格去掉 markdown 加粗标记——公告里表头常写成 **登录天数**，
     不去掉会导致「表头形状」判断全部失效 */
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim().replace(/\*\*/g, ''));
  const pct = (s) => { const m = /([\d.]+)\s*%/.exec(s || ''); return m ? +m[1] : null; };
  const num = (s) => { const m = /(\d[\d,]*)/.exec(String(s || '').replace(/[，,]/g, '')); return m ? +m[1].replace(/,/g, '') : null; };
  const isTY = (s) => /通用元宝/.test(String(s || ''));
  const clean = (s) => String(s || '').replace(/[*_`]/g, '').replace(/[。，,、\s]+$/, '').trim();

  function tables(ls) {
    const out = [];
    for (let i = 0; i < ls.length - 1; i++) {
      if (isRow(ls[i]) && isSep(ls[i + 1])) {
        const head = cells(ls[i]);
        const rows = [];
        let j = i + 2;
        while (j < ls.length && isRow(ls[j])) { rows.push(cells(ls[j])); j++; }
        out.push({ head, rows, idx: i });
        i = j;
      }
    }
    return out;
  }

  function sections(ls) {
    const out = [];
    let cur = { title: '', idx: -1, end: ls.length };
    ls.forEach((l, i) => {
      const m = /^##\s+(.+?)\s*$/.exec(l);
      if (m) { cur.end = i; out.push(cur); cur = { title: m[1].replace(/\*/g, '').trim(), idx: i, end: ls.length }; }
    });
    out.push(cur);
    return out;
  }

  /* "纳贤令*3" → {name:'纳贤令', n:3} */
  function nq(s) {
    const m = /^(.+?)\s*[*×]\s*(\d+)$/.exec(String(s || '').trim());
    if (m) return { name: m[1].trim(), n: +m[2] };
    return { name: clean(s), n: 1 };
  }
  function nqList(str) {
    return String(str || '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean).map(nq);
  }

  /* 本期红包的期望值（元宝）。红包是随机开出的绑定元宝，
     公告会给一张概率表，按期望折算比按最低值更接近长期成本。
     由 scanRedPackets() 在 parse 开始时填好，toGives 直接查。 */
  let RED_EV = {};

  /* 红包概率表 → { 初冬红包: { ev, min, max, rows } }
     表长这样（标题「**初冬红包**」下面）：
       | 绑定元宝*3000 | 50% |                                        */
  function scanRedPackets(ls) {
    const out = {};
    let cur = null;
    ls.forEach((raw) => {
      const line = raw.trim();
      const h = /^\*\*(.+?)\*\*\s*$/.exec(line);
      if (h) { cur = /红包$/.test(h[1].trim()) ? h[1].trim() : null; return; }
      if (!cur) return;
      const m = /绑定元宝\s*\*\s*(\d+)[^|]*\|\s*(\d+(?:\.\d+)?)\s*%/.exec(line);
      if (!m) return;
      const e = out[cur] = out[cur] || { name: cur, rows: [], ev: 0, min: 0, max: 0 };
      e.rows.push({ yb: +m[1], pct: +m[2] });
    });
    Object.keys(out).forEach((k) => {
      const e = out[k];
      if (!e.rows.length) { delete out[k]; return; }
      const w = e.rows.reduce((a, r) => a + r.pct, 0) || 1;
      e.ev = Math.round(e.rows.reduce((a, r) => a + r.yb * r.pct, 0) / w);
      e.min = Math.min(...e.rows.map((r) => r.yb));
      e.max = Math.max(...e.rows.map((r) => r.yb));
    });
    return out;
  }

  /* 奖励文案 → gives（只留可计算品类；券按面额拆 key；礼盒统一记「盒」）
     括号处理：自选箱「（A*1、B*2，2选1）」取第一项；券面额「（3000-2888）」保留。 */
  function toGives(str, opt) {
    const g = {};
    let s = String(str || '').replace(/[（(]([^）)]*)[)）]/g, (m, inner) => {
      if (/选1|选一/.test(inner)) return '、' + inner.split(/[、,，]/)[0];
      if (/^\s*\d+\s*-\s*\d+\s*$/.test(inner)) return m;
      return '';
    });
    s = s.replace(/选1|选一/g, '');
    nqList(s).forEach((it) => {
      const cp = CUR.coupon(it.name);
      if (cp) { g[cp.key] = (g[cp.key] || 0) + it.n; return; }
      if (/礼盒$/.test(it.name)) { g['盒'] = (g['盒'] || 0) + it.n; return; }
      /* 绑定元宝是「能直接花掉的钱」，不是普通道具：
         单笔充值 600 送 600 绑元，等于这一档实际只花了一半本金。
         以前被 isCurrency 挡掉（它不在品类表里），600 档 giving 成空。 */
      if (/^绑定元宝$/.test(CUR.canon(it.name))) {
        g['绑定元宝'] = (g['绑定元宝'] || 0) + it.n;
        return;
      }
      /* 红包：随机开出绑定元宝，按本期概率表的期望值折 */
      if (/红包$/.test(it.name)) {
        const rp = RED_EV[it.name];
        if (rp && rp.ev > 0) { g['绑定元宝'] = (g['绑定元宝'] || 0) + rp.ev * it.n; return; }
      }
      const c = CUR.canon(it.name);
      if (CUR.isCurrency(it.name)) { g[c] = (g[c] || 0) + it.n; return; }
      if (/纳贤令$/.test(it.name)) { g['纳贤令'] = (g['纳贤令'] || 0) + it.n; return; }
      if (opt && opt.keep) g[it.name] = (g[it.name] || 0) + it.n;
    });
    return g;
  }

  function bareName(x) {
    return String(x || '')
      .replace(/\s*[（(][^）)]*(?:折|原价)[^）)]*[）)]\s*$/, '')
      .replace(/[。，,、\s]+$/, '')
      .trim();
  }

  /* ============================================================
     解析
     ============================================================ */
  function parse(text) {
    const ls = lines(text);
    const rep = [];
    const miss = [];
    const model = {
      meta: {}, systems: [], shops: {},
      coupons: {}, chargeTiers: [], cumCharge: [], dailyTiers: [], cumSpend: [],
      dailyCumCharge: [],
      bundles: [], freeGains: [], boughtGains: [], directSales: [],
      unsupported: [], curLabel: {}, naxianDaily: [], redPackets: {},
    };

    /* 红包概率表要先扫出来：后面 toGives 遇到「xx红包」要按期望折成绑元 */
    RED_EV = scanRedPackets(ls);
    model.redPackets = RED_EV;

    const tbs = tables(ls);
    const secs = sections(ls);
    const secOf = (idx) => { const s = secs.find((x) => idx >= x.idx && idx < x.end); return s ? s.title : ''; };
    const secLines = (re) => { const s = secs.find((x) => re.test(x.title)); return s ? ls.slice(s.idx, s.end) : []; };
    /* 所有命中章节合并（同一期可能出现「消费排行榜」+「消费活动」两段） */
    const secText = (re) => secs.filter((s) => re.test(s.title)).map((s) => ls.slice(s.idx, s.end).join('\n')).join('\n');

    /* ---------- 标题 / 日期 ---------- */
    const title = (ls.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
    if (title) model.meta.title = title;
    const dm = /(\d{4}-\d{2}-\d{2})[^\n]*?~\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    if (dm) { model.meta.start = dm[1]; model.meta.end = dm[2]; }

    /* ---------- 1. 珍宝礼盒 ---------- */
    const jadeSec = secs.find((s) => /珍宝|礼盒/.test(s.title));
    tbs.forEach((t) => {
      if (t.head[0] !== '道具' || !/概率/.test(t.head[1] || '')) return;
      if (jadeSec && !(t.idx >= jadeSec.idx && t.idx < jadeSec.end)) return;   // 排除概率公示段
      let name = null, always = null;
      for (let k = t.idx; k >= Math.max(0, t.idx - 10); k--) {
        const m = /^\*\*(.+?礼盒)\*\*/.exec(ls[k].trim());
        if (m) { name = m[1]; break; }
        const a = /每开启一次礼盒必定获得(.+?)[。，]/.exec(ls[k]);
        if (a && !always) always = toGives(a[1], { keep: true });
      }
      if (!name) return;
      const table = t.rows.map((r) => [r[0], pct(r[1]) || 0, toGives(r[0], { keep: true })]);
      model.systems.push({
        id: 'box_' + model.systems.filter((s) => s.kind === 'box').length,
        kind: 'box', name, unit: '盒', pool: 'jade',
        buys: [], always: always || { 灵韵: 250 }, table,
        mile: { every: 50, give: { 传世宝玉: 1 }, cap: 20 },
      });
      rep.push(`礼盒「${name}」：${table.length} 项掉落`);
    });

    const mileRe = /每累计开启(.+?)宝箱\*(\d+)[，,]?\s*可获得奖励：(.+?)[，,]\s*限完成(\d+)次/g;
    let mm;
    while ((mm = mileRe.exec(text))) {
      const who = mm[1].trim(), every = +mm[2];
      const rw = nqList(mm[3])[0], cap = +mm[4];
      const box = model.systems.find((s) => s.kind === 'box' && s.name.includes(who));
      if (box) {
        box.mile = { every, give: { [CUR.canon(rw.name)]: rw.n }, cap };
        rep.push(`助力「${who}」：每 ${every} 盒 → ${rw.name}×${rw.n}，上限 ${cap} 次`);
      }
    }

    /* ---------- 2. 兑换商店（按表头形状识别） ---------- */
    const shopDefs = [
      { key: 'jade', test: (h) => /消耗宝玉/.test(h.join('')) },
      { key: 'qifu', test: (h) => /同心结/.test(h.join('')) },
      { key: 'ruyi', test: (h) => /兑换所需/.test(h[1] || '') },
      { key: 'jinxiu', test: (h) => /兑换价格/.test(h[1] || '') && !/限定皮肤碎片/.test(h[1] || '') },
      { key: 'crystal', test: (h) => /水晶球/.test(h.join('')) },
    ];
    shopDefs.forEach((def) => {
      const hit = tbs.filter((tb) => def.test(tb.head));
      if (!hit.length) return;
      const tb = hit[hit.length - 1];
      const items = tb.rows.map((r) => {
        const tag = /（(.+?)）/.exec(r[0]);
        const nm = bareName(r[0]);
        return {
          name: nm, cost: num(r[1]), limit: num(r[2]) || 1, tag: tag ? tag[1] : '',
          cat: def.key === 'jinxiu' ? (/水晶/.test(nm) ? '动态水晶' : '皮肤')
            : def.key === 'ruyi' ? (/转生丹|福袋|金印|招募令|宝箱/.test(nm) ? '道具' : '武将')
              : '武将',
        };
      }).filter((x) => x.cost);
      model.shops[def.key] = items;
      rep.push(`${def.key} 商店：${items.length} 项`);
    });

    /* ---------- 3. 祈福：累计积分 → 同心结 ---------- */
    const knotRe = /祈福积分达到(\d+)[，,]\s*可领取奖励：(.+?)[，,]\s*限完成1次/g;
    const knot = [];
    while ((mm = knotRe.exec(text))) {
      const km = /同心结\*(\d+)/.exec(mm[2]);
      knot.push([+mm[1], km ? +km[1] : 0]);
    }
    if (knot.length) {
      model.shops.qifuMile = knot;
      rep.push(`累计祈福：${knot.length} 档（含同心结 ${knot.filter((x) => x[1]).length} 档）`);
    }

    /* ---------- 4. 纳贤进度 ----------
       两类纳贤要分开，不能混成一个名字：

       ① 标准纳贤 —— 「累计纳贤<将名>*<n>，…，4选1」
          指定池子，抽够次数必得那位武将（含 3 个陪跑），进度按武将各算各的。
       ② 通用纳贤 —— 「累计纳贤*<n>，可领取奖励：A、B…，k选1，限完成m次」
          没有指定将名，进度是全池共享的，达标后从候选里挑一个。
          这一类的来源要看所在小标题：海纳百川 / 特惠精选，各自的池子和限次都不一样。

       多选一的首项若是「xx福袋」，再展开成福袋里那份名单（特惠精选纳贤福袋 15 选 1）。 */
    const nx = [];
    const haiyou = [];
    const bags = {};
    text.split(/[。\n]/).forEach((ln) => {
      const b = /([^\s，,：:。*]*福袋)\s*[：:]\s*([^。]*?)[，,]?\s*任选其一/.exec(ln);
      if (!b) return;
      bags[clean(b[1])] = nqList(b[2]).map((x) => x.name).filter((x) => !/^大将军印/.test(x));
    });
    /* 按 **小标题** 切段：多选一的来源就是它所在那一段的标题 */
    const nxSegs = [];
    let nxCur = { head: '', body: [] };
    ls.forEach((raw) => {
      const line = raw.trim();
      const h = /^\*\*(.+?)\*\*\s*$/.exec(line);
      if (h) { nxSegs.push(nxCur); nxCur = { head: clean(h[1]), body: [] }; return; }
      nxCur.body.push(line);
    });
    nxSegs.push(nxCur);

    const nxRe = /累计纳贤\s*([^*，,。]*?)\s*\*(\d+)\s*[，,]\s*可领取奖励[：:]\s*([^。]*)/g;
    nxSegs.forEach((seg) => {
      const bodyText = seg.body.join('\n');
      if (!/累计纳贤/.test(bodyText)) return;
      nxRe.lastIndex = 0;
      while ((mm = nxRe.exec(bodyText))) {
        const who = clean(mm[1] || '');
        const n = +mm[2];
        const reward = mm[3];
        /* 有将名 → 标准纳贤：抽这位武将的专属池 */
        if (who) { nx.push({ item: who, n, pool: seg.head || '纳贤' }); continue; }
        /* 无将名 → 通用纳贤（k 选 1），来源取小标题 */
        const capM = /限完成\s*(\d+)\s*次/.exec(reward);
        const head = reward.replace(/[，,]\s*\d+\s*选\s*1[\s\S]*$/, '');
        const raw = nqList(head).map((x) => x.name).filter((x) => !/^大将军印/.test(x));
        const items = [];
        raw.forEach((x) => { (bags[x] || [x]).forEach((y) => items.push(y)); });
        const pool = seg.head || '通用纳贤';
        if (items.length) haiyou.push({ n, items, cap: capM ? +capM[1] : 1, pool });
      }
    });
    if (nx.length) { model.shops.naxian = nx; rep.push(`标准纳贤：${nx.length} 位武将`); }
    else miss.push('纳贤进度');
    model.haiyou = haiyou;
    if (haiyou.length) {
      rep.push(`通用纳贤（k选1）：${haiyou.map((h) => `${h.pool} ${h.items.length}选1×${h.cap}（${h.n}令）`).join('、')}`);
    }

    /* ---------- 5. 签筒 ---------- */
    const tubeTab = tbs.find((t) => /总签数/.test(t.head.join('')));
    if (tubeTab) {
      const tubes = [];
      tubeTab.rows.forEach((r) => {
        if (r[2] === '大奖') tubes.push({ name: r[0], N: num(r[1]), jackpot: nq(r[3]).name, lian: {} });
        else if (['大吉', '中吉', '小吉'].includes(r[0]) && tubes.length) {
          tubes[tubes.length - 1].lian[r[0]] = { amount: num(r[2]), count: num(r[3]) };
        }
      });
      model.shops.tubes = tubes;
      rep.push(`签筒：${tubes.length} 个`);
    }

    /* ---------- 6. 夺宝进度（去专名） ---------- */
    const dbSec = {};
    let curHead = '';
    ls.forEach((line) => {
      const h = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
      if (h) curHead = h[1];
      const mt = /累计参与(.+?)夺宝(\d+)次[（(]消耗(.+?)夺宝券\*(\d+)[）)][，,]\s*可领取奖励：(.+?)[，,]/.exec(line);
      if (mt) {
        const key = (curHead || '默认').replace(/——.*$/, '');
        /* item 是「这个档给什么」的展示名，沿用老口径（截到第一个逗号）；
           gives 是给方案层算账用的，要整句奖励，否则「纳贤令*5」后面的项全丢 */
        const body = line.replace(/^[\s\S]*?可领取奖励：/, '')
          .replace(/[。]\s*$/, '')
          .replace(/[，,]\s*(?:限完成\d+次).*$/, '');
        const gives = toGives(body);
        (dbSec[key] = dbSec[key] || []).push({
          n: +mt[2], item: nq(mt[5]).name, tickets: +mt[4],
          gives, label: body.slice(0, 24),
        });
      }
    });
    if (Object.keys(dbSec).length) {
      model.shops.duobao = dbSec;
      const cnt = Object.values(dbSec).reduce((a, v) => a + v.length, 0);
      rep.push(`夺宝进度：${Object.keys(dbSec).length} 个转盘 / ${cnt} 档`);
      const first = Object.keys(dbSec)[0];
      if (first && /夺宝$/.test(first)) model.curLabel[CUR.K.duobao] = first + '券';
    } else miss.push('夺宝转盘');

    /* ---------- 7. 皮肤直售 ---------- */
    tbs.forEach((t) => {
      if (!/^(商品名称|皮肤名称)$/.test(t.head[0] || '')) return;
      const ctx = ls.slice(Math.max(0, t.idx - 20), t.idx).join('');
      if (!/皮肤直售|皮肤特惠直售/.test(ctx)) return;
      const rows = t.rows.map((r) => {
        const nm = /皮肤：(.+?)、/.exec(r[1] || '') || /皮肤：(.+)$/.exec(r[1] || '');
        return { name: (nm ? nm[1].trim() : bareName(r[0])), price: num(r[2]) || 0, cat: '皮肤' };
      }).filter((x) => x.name && x.price);
      if (rows.length) { model.directSales = rows; rep.push(`皮肤直售：${rows.length} 项`); }
    });

    /* ---------- 8. 商城商品表（限时商品 / 免单商城 / 礼包上架） ---------- */
    tbs.forEach((t) => {
      const h0 = t.head[0] || '', h2 = t.head[2] || '';
      if (!/^(商品名称|商品|名称)$/.test(h0) || !/售价|初始售价/.test(h2)) return;
      const secTitle = secOf(t.idx);
      t.rows.forEach((r) => {
        const name = clean(r[0]);
        const desc = r[1] || '';
        const raw = r[2] || '';
        const price = num(raw);
        if (!name || !price) return;

        const got = /购买后可获得(.+?)[。；]/.exec(desc);
        let gives = got ? toGives(got[1]) : {};
        let luck = false;
        if (!Object.keys(gives).length && /可随机获得/.test(desc)) {
          const m2 = /随机获得(.+?)等道具/.exec(desc);
          if (m2) { gives = toGives(m2[1]); luck = !!Object.keys(gives).length; }
        }
        const perDayM = /每日限购买(\d+)次/.exec(desc);
        const totalM = /限购买(\d+)次/.exec(desc);
        const condM = /累计充值(\d+)元宝可购买/.exec(desc);
        const chainM = /须购买升级礼包\((\d+)\)后/.exec(desc);

        model.bundles.push({
          name, price, cur: isTY(raw) ? '通用元宝' : '元宝',
          gives, luck,
          perDay: perDayM ? +perDayM[1] : 0,
          total: totalM ? +totalM[1] : 0,
          cond: condM ? +condM[1] : 0,
          chain: chainM ? +chainM[1] : 0,
          byTable: /根据累计登录天数可领取/.test(desc) ? name : '',
          src: secTitle || '商城',
        });
      });
    });
    if (model.bundles.length) rep.push(`商城商品：${model.bundles.length} 项`);

    model.bundles.forEach((b) => {
      const ks = Object.keys(b.gives);
      if (ks.length === 1 && b.gives[ks[0]] === 1 && !b.total && !b.perDay) b.single = ks[0];
    });

    /* ---------- 9. 登录领取表：需购买的勋章 / 撒券 ---------- */
    const gainsByTable = {};
    tbs.forEach((t) => {
      if (!/登录天数|累计登录/.test(t.head[0] || '')) return;
      let name = null;
      for (let k = t.idx; k >= Math.max(0, t.idx - 6); k--) {
        const m = /^\*\*(.+?)\*\*/.exec(ls[k].trim());
        if (m) { name = m[1]; break; }
      }
      if (!name) return;
      const acc = {};
      t.rows.forEach((r) => {
        for (let i = 1; i < r.length; i++) {
          nqList(r[i]).forEach((it) => {
            const cp = CUR.coupon(it.name);
            const c = cp ? cp.key : CUR.canon(it.name);
            if (cp || CUR.isCurrency(it.name)) acc[c] = (acc[c] || 0) + it.n;
          });
        }
      });
      gainsByTable[name] = { name, gains: acc, idx: t.idx };
    });
    Object.values(gainsByTable).forEach((tb) => {
      const prod = model.bundles.find((b) => b.name === tb.name);
      Object.entries(tb.gains).forEach(([cur, qty]) => {
        if (prod) model.boughtGains.push({ cur, qty, from: tb.name, price: prod.price, money: prod.cur });
        else model.freeGains.push({ cur, qty, from: tb.name });
      });
    });
    if (model.boughtGains.length) rep.push(`需购买的勋章/礼包：${model.boughtGains.length} 条产出`);

    /* ---------- 10. 真白送：活跃活动表（表头「天数」） ---------- */
    tbs.forEach((t) => {
      if (t.head[0] !== '天数') return;
      const acc = {};
      t.rows.forEach((r) => {
        for (let i = 1; i < r.length; i++) {
          nqList(r[i]).forEach((it) => { if (CUR.isCurrency(it.name)) { const c = CUR.canon(it.name); acc[c] = (acc[c] || 0) + it.n; } });
        }
      });
      Object.entries(acc).forEach(([cur, qty]) => model.freeGains.push({ cur, qty, from: '活跃任务' }));
    });
    /* 七日活跃任务表（表头含「任务描述」，单元格错位，按「含 * 的格」取奖励） */
    tbs.forEach((t) => {
      if (!/任务描述/.test(t.head.join(''))) return;
      const acc = {};
      t.rows.forEach((r) => {
        for (let i = 1; i < r.length; i++) {
          const c = r[i];
          if (!c || !/[*×]/.test(c)) continue;
          nqList(c).forEach((it) => {
            if (CUR.isCurrency(it.name)) { const k = CUR.canon(it.name); acc[k] = (acc[k] || 0) + it.n; }
            else if (/纳贤令$/.test(it.name)) {
              const who = CUR.exclusiveLing(it.name);
              const k = '专属:' + who;
              acc[k] = (acc[k] || 0) + it.n;
            }
          });
        }
      });
      Object.entries(acc).forEach(([cur, qty]) => {
        if (/^专属:/.test(cur)) model.freeGains.push({ cur: '纳贤令', qty, from: '七日任务·' + cur.slice(4), only: [cur.slice(4)] });
        else model.freeGains.push({ cur, qty, from: '七日活跃任务' });
      });
    });

    if (model.freeGains.length) rep.push(`真白送：${model.freeGains.map((x) => x.cur + '×' + x.qty).join('、')}`);

    /* ---------- 11. 单笔充值 ---------- */
    const cText = secText(/充值/) || text;
    const oneRe = /单笔充值(?:达到或超过)?(\d+)元宝[，,]\s*可领取奖励：(.+?)[。]/g;
    const seen = {};
    while ((mm = oneRe.exec(cText))) {
      const need = +mm[1], tail = mm[2];
      const before = cText.slice(Math.max(0, mm.index - 40), mm.index);
      const perDayM = /每日限完成(\d+)次/.exec(tail);
      const totalM = /限完成(\d+)次/.exec(tail);
      const body = tail
        .replace(/[，,]\s*每日限完成\d+次.*$/, '')
        .replace(/[，,]\s*(?:累计)?限完成\d+次.*$/, '')
        .replace(/[（(]\s*\d+\/\d+\s*重置[^）)]*[）)]\s*$/, '');
      const gives = toGives(body);
      const onlyDayM = /仅限\s*\d+\/(\d+)/.exec(before);
      const fromDayM = /(\d+)\/\d+\s*[~～]\s*\d+\/\d+\s*参与/.exec(before);
      const key = need + '|' + JSON.stringify(gives) + '|' + (onlyDayM ? onlyDayM[1] : '') + (fromDayM ? fromDayM[1] : '');
      if (seen[key]) continue;
      seen[key] = 1;
      model.chargeTiers.push({
        need, gives,
        perDay: perDayM ? +perDayM[1] : 0,
        total: perDayM ? undefined : (totalM ? +totalM[1] : 1),
        onlyDay: onlyDayM ? +onlyDayM[1] : 0,
        fromDay: fromDayM ? +fromDayM[1] : 0,
        note: body.slice(0, 40),
      });
    }
    /* 「额外赠」段：同 need 且都无日期限定时，并入主档 */
    {
      const byNeed = {};
      model.chargeTiers = model.chargeTiers.filter((t) => {
        const p = byNeed[t.need];
        if (!p) { byNeed[t.need] = t; return true; }
        if ((t.onlyDay || t.fromDay) || (p.onlyDay || p.fromDay)) return true;
        Object.entries(t.gives).forEach(([k, v]) => { p.gives[k] = (p.gives[k] || 0) + v; });
        return false;
      });
    }
    if (model.chargeTiers.length) rep.push(`单笔充值：${model.chargeTiers.length} 档`); else miss.push('单笔充值');

    /* ---------- 12. 累计充值 / 充值返券（单独存，不混进单笔档） ---------- */
    const dailyChgSeen = new Set();
    const dailySeen = new Set();
    /* 「每日重置，累计充值X」不是一次性累计档，也不是「花 X 元宝买一个档」，
       而是**每天充值额达到 X 就送**，和单笔充值档叠加。
       以前塞进 chargeTiers 当独立档，等于把「充 60 元顺带领 10 令」
       算成「额外再掏 58.88 元买 10 令」，整期少算 40 多个纳贤令。 */
    const dailyChgRe = /每日重置[，,]\s*累计充值(?:达到)?(\d+)元宝[，,]\s*可领取奖励：(.+?)[。]/g;
    while ((mm = dailyChgRe.exec(text))) {
      const gives = toGives(mm[2].replace(/[，,]\s*(?:每日)?限完成\d+次.*$/, ''));
      model.dailyCumCharge.push({
        need: +mm[1], gives, note: mm[2].slice(0, 36),
      });
      dailyChgSeen.add(+mm[1] + '|' + JSON.stringify(gives));
    }
    const cumRe = /累计充值(?:达到)?(\d+)元宝[，,]\s*可领取奖励：(.+?)[。]/g;
    while ((mm = cumRe.exec(cText))) {
      const tail = mm[2];
      const totalM = /限完成(\d+)次/.exec(tail);
      const body = tail.replace(/[，,]\s*(?:累计)?限完成\d+次.*$/, '');
      /* 已经被「每日重置」那条收走的不再重复记成一次性档 */
      if (dailyChgSeen.has(+mm[1] + '|' + JSON.stringify(toGives(body)))) continue;
      model.cumCharge.push({
        need: +mm[1], gives: toGives(body),
        total: totalM ? +totalM[1] : 1, note: body.slice(0, 36),
      });
    }
    rep.push(`累计充值：${model.cumCharge.length} 档`);

    /* ---------- 13. 每日消费 / 累计消费 ---------- */
    const sText = secText(/消费/) || text;
    const dayRe = /每日(?:消费达到|重置，消费)(\d+)元宝[，,]\s*可领取奖励：(.+?)[。]/g;
    const pushDaily = (need, body) => {
      const gives = toGives(body);
      const key = need + '|' + JSON.stringify(gives);
      if (dailySeen.has(key)) return;
      dailySeen.add(key);
      model.dailyTiers.push({ need, gives, note: body.slice(0, 36) });
    };
    while ((mm = dayRe.exec(sText))) {
      pushDaily(+mm[1], mm[2].replace(/[，,]\s*每日限完成\d+次.*$/, ''));
    }
    /* 章节标题里没有「消费」两个字的（如「初冬特惠」）会整段漏掉，
       这里再扫一遍全文兜底：「每日重置，消费X元宝」是独立的一档。 */
    const dailySpendRe = /每日重置[，,]\s*消费(?:达到)?(\d+)元宝[，,]\s*可领取奖励：(.+?)[。]/g;
    while ((mm = dailySpendRe.exec(text))) {
      pushDaily(+mm[1], mm[2].replace(/[，,]\s*(?:每日)?限完成\d+次.*$/, ''));
    }
    const cumSRe = /累计消费(?:达到)?(\d+)元宝[，,]\s*可领取奖励：(.+?)[。]/g;
    while ((mm = cumSRe.exec(sText))) {
      const body = mm[2].replace(/[，,]\s*限完成\d+次.*$/, '');
      model.cumSpend.push({ need: +mm[1], gives: toGives(body), note: body.slice(0, 36) });
    }
    rep.push(`消费档位：每日 ${model.dailyTiers.length} 档 / 累计 ${model.cumSpend.length} 档`);
    if (!model.dailyTiers.length) miss.push('每日消费');

    /* ---------- 14. 抵价券面额 ---------- */
    const cpRe = /抵价券\s*[（(]\s*(\d+)\s*-\s*(\d+)\s*[）)]/g;
    while ((mm = cpRe.exec(text))) {
      const face = +mm[2], min = +mm[1];
      if (face && min && face <= min) model.coupons['券' + face] = { face, min, name: `抵价券 ${min}-${face}` };
    }
    if (Object.keys(model.coupons).length) rep.push(`抵价券：${Object.values(model.coupons).map((c) => c.name).join('、')}`);
    else miss.push('抵价券');

    /* ---------- 15. 未建模玩法 ---------- */
    const KINDS = [
      [/砸蛋/, '幸运砸蛋'], [/绘卷/, '群英绘卷'], [/连连看/, '欢乐连连看'],
      [/福喵/, '福喵纳财'], [/积惠特卖/, '积惠特卖'], [/幸运夺宝/, '幸运夺宝'],
      [/排行榜/, '排行榜'], [/祈愿/, '祈愿'],
    ];
    secs.forEach((s) => {
      KINDS.forEach(([re, name]) => {
        if (re.test(s.title) && !model.unsupported.some((u) => u.name === name)) {
          model.unsupported.push({ name, section: s.title });
        }
      });
    });
    if (model.unsupported.length) rep.push(`未纳入精算：${model.unsupported.map((u) => u.name).join('、')}`);

    /* ---------- 15.1 定向纳贤令 ----------
       「特惠精选纳贤令」「谋杨奉纳贤令」只对指定池生效，和通用纳贤令不是一回事。
       直接当纳贤令会高估返利（选池外武将时报价虚低），所以不折算，只标出来。 */
    const directLing = new Set();
    (text.match(/[\u4e00-\u9fa5]{2,6}纳贤令/g) || []).forEach((s) => {
      const who = s.replace(/纳贤令$/, '').trim();
      /* 剥掉「玩家可使用纳贤令」这类句子碎片，只留真正的池名前缀 */
      if (!who || /使用|获得|购买|领取|消耗|专属|玩家|商城|可|或|该|在|于|的/.test(who)) return;
      directLing.add(who);
    });
    if (directLing.size) {
      const label = [...directLing].map((x) => x + '纳贤令').join(' / ');
      if (!model.unsupported.some((u) => u.name === label)) {
        model.unsupported.push({ name: label, section: '定向道具' });
      }
      rep.push(`定向纳贤令未折算：${[...directLing].join('、')}（只对指定池生效）`);
    }

    /* ---------- 16. 纳贤价格机制 ---------- */
    const nxPrice = /每日前两次[^。]*?第一次仅消耗(\d+)元宝[，,]\s*第二次仅消耗(\d+)元宝/.exec(text);
    if (nxPrice) {
      model.naxianDaily = [
        { qty: 1, price: +nxPrice[1], perDay: 1, label: '每日第1次特惠' },
        { qty: 1, price: +nxPrice[2], perDay: 1, label: '每日第2次特惠' },
      ];
      rep.push(`纳贤特惠：每日前两次 ${nxPrice[1]} / ${nxPrice[2]} 元宝`);
    }

    model.miss = miss;
    return { model, report: rep };
  }

  /* ============================================================
     应用到 PRESET：全量替换（解析不到就清空，绝不沿用上一期）
     ============================================================ */
  function apply(model) {
    const P = window.PRESET;
    const log = [];

    if (model.meta) {
      if (model.meta.title) P.meta.title = model.meta.title;
      if (model.meta.start) P.meta.start = model.meta.start;
      if (model.meta.end) P.meta.end = model.meta.end;
      if (P.meta.start && P.meta.end) {
        const d = (new Date(P.meta.end) - new Date(P.meta.start)) / 86400000;
        if (d >= 0) P.meta.days = Math.round(d) + 1;
      }
      P.meta.imported = true;
    }

    CUR.setLabels(model.curLabel || {});
    P.curLabel = model.curLabel || {};

    /* ---- systems：整体重建 ---- */
    const built = [];
    const oldSys = (kind) => (P.systems || []).find((s) => s.kind === kind) || {};

    /* 单品类礼包 → 该系统自己的购买渠道（引擎折算卡片价要用） */
    const buysFor = (key) => (model.bundles || []).filter((b) => {
      const ks = Object.keys(b.gives);
      return ks.length === 1 && b.gives[key] > 0;
    }).map((b) => ({
      qty: b.gives[key], price: b.price, cur: b.cur,
      perDay: b.perDay > 0 ? b.perDay : undefined,
      maxTotal: b.total > 0 ? b.total : undefined,
      label: b.name,
    }));

    (model.systems || []).forEach((s) => built.push(s));

    /* 礼盒：本期没有礼包表就给「200 / 盒、10000 / 50 盒」的常规价 */
    {
      const bb = buysFor('盒');
      built.filter((s) => s.kind === 'box').forEach((s) => {
        s.buys = bb.length ? bb : [
          { qty: 1, price: 200, label: '单盒 200 元宝' },
          { qty: 50, price: 10000, label: '大礼包 50 盒' },
        ];
      });
    }

    if (model.shops.qifuMile) {
      const old = oldSys('qifu');
      built.push({
        id: 'qifu', kind: 'qifu', name: '祈福', unit: '灯', pool: 'knot',
        buys: buysFor('祈福灯').length ? buysFor('祈福灯') : (old.buys || []),
        table: old.table || [],
        knotMile: model.shops.qifuMile, shopRef: 'qifu',
      });
    } else log.push('本期末解析到祈福 → 已清空');

    {
      const old = oldSys('progress');
      const buys = [];
      (model.bundles || []).forEach((b) => {
        if (b.single && b.single === CUR.K.ling) buys.push({ qty: 1, price: b.price, cur: b.cur, label: b.name });
        else if (b.gives[CUR.K.ling] > 0 && Object.keys(b.gives).length === 1) {
          buys.push({
            qty: b.gives[CUR.K.ling], price: b.price, cur: b.cur,
            perDay: b.perDay > 0 ? b.perDay : undefined,
            maxTotal: b.total > 0 ? b.total : undefined,
            label: b.name,
          });
        }
      });
      (model.naxianDaily || []).forEach((b) => buys.push(b));
      built.push({
        id: 'naxian', kind: 'progress', name: '纳贤', unit: '令', pool: 'naxian',
        freeCur: '纳贤令', freePer: 1,
        buys: buys.length ? buys : (old.buys || []),
        progress: (model.shops.naxian || []).map((x) => ({ item: x.item, n: x.n })),
        /* 多选一进度按本期解析结果走：解析不到就清空，
           否则换期后会沿用上一期的海纳百川名单（名单里全是上期武将） */
        haiyou: model.haiyou || [], table: old.table || [],
      });
    }

    if (model.shops.jinxiu && model.shops.jinxiu.length) {
      const old = oldSys('jinxiu');
      built.push({
        id: 'jinxiu', kind: 'jinxiu', name: '锦绣霓裳', unit: '锦绣', pool: 'satin',
        buys: buysFor('锦绣').length ? buysFor('锦绣') : (old.buys || []),
        table: old.table || [], satinEv: old.satinEv || 0.84,
        pity: 'jinxiu', shopRef: 'jinxiu',
      });
    } else log.push('本期末解析到锦绣 → 已清空');

    const dbs = model.shops.duobao || {};
    Object.keys(dbs).forEach((k, i) => {
      built.push({
        id: 'db_' + (i + 1), kind: 'gacha', name: k, unit: '抽', pool: 'duobao',
        freeCur: CUR.K.duobao, freePer: 5,
        buys: buysFor(CUR.K.duobao),
        table: [['其他道具', 99.5, {}]], pity: 'duobao',
        progress: dbs[k].map((x) => ({
          n: x.n, item: x.item,
          gives: x.gives || null, tickets: x.tickets || 0,
        })),
      });
    });
    if (!Object.keys(dbs).length) log.push('本期末解析到夺宝 → 已清空');

    (model.shops.tubes || []).forEach((t, i) => {
      /* 签种 = 签筒名去掉序号（金瑶签1 → 金瑶签），价格从商城表按名字找 */
      const signName = String(t.name || '').replace(/\d+$/, '');
      const prod = signName && (model.bundles || []).find((b) => b.name === signName);
      built.push({
        id: 'tube_' + i, kind: 'tube', name: t.name, unit: '签', pool: 'lian',
        buys: prod && prod.price ? [{
          qty: 1, price: prod.price, cur: prod.cur,
          maxTotal: prod.total || 0, label: signName,
        }] : [],
        tube: {
          jackpot: t.jackpot, N: t.N, prizes: 1,
          sign: signName ? { name: signName, price: prod ? prod.price : 0, cur: prod ? prod.cur : '元宝' } : null,
          lian: {
            big: t.lian['大吉'] ? t.lian['大吉'].amount : 2000,
            mid: t.lian['中吉'] ? t.lian['中吉'].amount : 1500,
            small: t.lian['小吉'] ? t.lian['小吉'].amount : 1000,
            nBig: t.lian['大吉'] ? t.lian['大吉'].count : 5,
            nMid: t.lian['中吉'] ? t.lian['中吉'].count : 25,
            nSmall: t.lian['小吉'] ? t.lian['小吉'].count : 69,
          },
        },
      });
    });

    P.systems = built;

    /* ---- shops ---- */
    ['jade', 'qifu', 'ruyi', 'jinxiu', 'crystal'].forEach((id) => {
      const sp = (P.shops || []).find((s) => s.id === id);
      if (!sp) return;
      const items = model.shops[id] || [];
      sp.items = items;
      log.push(`商店 ${id}：${items.length ? items.length + ' 项' : '置空'}`);
    });

    /* ---- 券 ---- */
    P.coupons = Object.keys(model.coupons || {}).length ? model.coupons : {};
    if (!Object.keys(P.coupons).length) log.push('本期末解析到抵价券 → 券体系置空');

    /* ---- 充值 / 消费 ---- */
    P.chargeTiers = (model.chargeTiers || []).slice();
    P.cumCharge = (model.cumCharge || []).slice();
    /* 每日累计充值的门槛要吸附到「实际能充的档位」。
       公告常写 5888 元宝这种数，但充值档只有 6000 这一档，
       5888 折成人民币是 58.88，显示出来就变成 ¥59 —— 游戏里根本没有 59 元。
       向上取最近能充到的档（5888 → 6000 = ¥60），判定口径不变
       （档位金额都是固定面额，不存在「充 5900 够 5888 但不够 6000」的情形）。 */
    const chNeeds = P.chargeTiers.map((x) => x.need).filter((n) => n > 0).sort((a, b) => a - b);
    P.dailyCumCharge = (model.dailyCumCharge || []).map((t) => {
      const up = chNeeds.find((n) => n >= t.need);
      if (!up || up === t.need) return t;
      return Object.assign({}, t, {
        raw: t.need, need: up,
        note: `${t.note || ''}（公告门槛 ${t.need}，实际按 ${up} 元宝档 / ¥${up / 100} 判定）`,
      });
    });
    if (P.dailyCumCharge.some((t) => t.raw)) {
      log.push(`每日累计充值门槛已吸附到实际档位：${P.dailyCumCharge
        .filter((t) => t.raw).map((t) => `${t.raw}→${t.need}`).join('、')}`);
    }
    P.dailyTiers = (model.dailyTiers || []).slice();
    P.cumSpend = (model.cumSpend || []).slice();
    P.redPackets = model.redPackets || {};
    if (!P.chargeTiers.length) log.push('本期末解析到充值档位 → 置空');
    Object.keys(P.redPackets).forEach((k) => {
      const r = P.redPackets[k];
      log.push(`红包：${k} 按期望 ${r.ev} 元宝折（区间 ${r.min}~${r.max}）`);
    });

    /* ---- 商城礼包 ---- */
    P.extraPacks = (model.bundles || [])
      .filter((b) => !b.byTable && Object.keys(b.gives).length)
      .map((b, i) => ({
        id: 'pk' + i, name: b.name, price: b.price, cur: b.cur,
        gives: b.gives, perDay: b.perDay, total: b.total, chain: b.chain,
        note: b.luck ? '随机福袋' : '', lucky: b.luck,
      }));

    P.freeGains = model.freeGains || [];
    P.boughtGains = model.boughtGains || [];
    P.directSales = (model.directSales || []).map((s) => ({ name: s.name, price: s.price, cat: s.cat }));
    P.unsupported = model.unsupported || [];

    /* 商品目录 / 路线 / 宝玉分配都有惰性缓存，换期必须清掉，否则沿用上一期的价格表 */
    if (window.E && window.E.reset) window.E.reset();
    if (window.SCHED && window.SCHED.reset) window.SCHED.reset();
    if (window.TARGETS && window.TARGETS.reset) window.TARGETS.reset();

    return { ok: true, log };
  }

  return { parse, apply };
})();
