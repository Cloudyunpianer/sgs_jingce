/* ============================================================
   公告 md 解析器（换期时用，尽力而为 + 可人工修正 JSON）
   ============================================================ */
window.PARSER = (function () {
  const lines = (t) => t.replace(/\r/g, '').replace(/\uFEFF/g, '').split('\n');
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
  const pct = (s) => { const m = /([\d.]+)\s*%/.exec(s || ''); return m ? +m[1] : null; };
  const int = (s) => { const m = /(\d[\d,]*)/.exec(s || ''); return m ? +m[1].replace(/,/g, '') : null; };

  /* 找所有表格：[{head:[], rows:[[]], idx}] */
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

  /* "传世宝玉*10" → {name:'传世宝玉', n:10} */
  function qty(s) {
    const m = /^(.+?)\s*[*×]\s*(\d+)$/.exec((s || '').trim());
    if (m) return { name: m[1].trim(), n: +m[2] };
    return { name: (s || '').trim(), n: 1 };
  }

  /* 去掉商店名里的折扣后缀，如「春宵彩翼*任婉(8折)」 */
  function bareName(x) {
    return String(x || '')
      .replace(/\s*[（(][^）)]*(?:折|原价)[^）)]*[）)]\s*$/, '')
      .replace(/[。，,、\s]+$/, '')
      .trim();
  }

  /* 礼盒掉落表的 gives 推导 */
  function givesOf(name, note) {
    if (/^传世宝玉/.test(name) || /^宝玉碎片/.test(name)) {
      const q = qty(name);
      return { [q.name === '宝玉碎片' ? '宝玉碎片' : '传世宝玉']: q.n };
    }
    if (/招募令|皮肤包|锦囊袋|将印|灵韵|水晶碎片|鲜花|点将卡|手气卡|换将卡|功勋/.test(name)) return {};
    if (note && /重复返还/.test(note)) return { [name]: 1 };
    return { [name]: 1 };
  }

  function parse(text) {
    const ls = lines(text);
    const rep = [];
    const model = { systems: [], shops: {}, meta: {} };

    /* ---- 标题 / 日期 ---- */
    const title = (ls.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
    if (title) model.meta.title = title;
    const dm = /(\d{4}-\d{2}-\d{2})[^\n]*?~\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    if (dm) { model.meta.start = dm[1]; model.meta.end = dm[2]; }

    const tbs = tables(ls);

    /* ---- 珍宝礼盒：表头 道具/概率/备注 ---- */
    const boxTabs = tbs.filter((t) => t.head[0] === '道具' && t.head[1] === '概率' && /备注/.test(t.head[2] || ''));
    boxTabs.forEach((t) => {
      // 往上找 **XX礼盒**
      let name = null;
      for (let k = t.idx; k >= Math.max(0, t.idx - 8); k--) {
        const m = /^\*\*(.+?礼盒)\*\*/.exec(ls[k].trim());
        if (m) { name = m[1]; break; }
      }
      if (!name) return;
      const table = t.rows.map((r) => [r[0], pct(r[1]) || 0, givesOf(r[0], r[2])]);
      model.systems.push({
        id: 'box_' + name, kind: 'box', name, unit: '盒', pool: 'jade',
        buys: [{ qty: 1, price: 200, label: '单盒 200元宝' }, { qty: 50, price: 10000, label: '大礼包 50盒' }],
        always: {}, table,
        mile: { every: 50, give: { 传世宝玉: 1 }, cap: 20 },
      });
      rep.push(`礼盒「${name}」：${table.length} 项掉落`);
    });

    /* ---- 每50盒返宝玉（助力） ---- */
    const mileRe = /每累计开启(.+?)宝箱\*(\d+)[，,]?\s*可获得奖励：(.+?)[，,]\s*限完成(\d+)次/g;
    let m;
    while ((m = mileRe.exec(text))) {
      const who = m[1].trim(), every = +m[2], reward = qty(m[3].replace(/^.*?：/, '')), cap = +m[4];
      model.systems.forEach((s) => {
        if (s.name.includes(who)) {
          s.mile = { every, give: { [reward.name]: reward.n }, cap };
          rep.push(`助力「${who}」：每 ${every} 盒 → ${reward.name}×${reward.n}，上限 ${cap} 次`);
        }
      });
    }

    /* ---- 珍宝商店 ---- */
    const jadeTab = tbs.find((t) => /消耗宝玉/.test(t.head.join('')));
    if (jadeTab) {
      model.shops.jade = jadeTab.rows.map((r) => {
        const cost = int(r[1]);
        const tag = /（(.+?)）/.exec(r[1]);
        return { name: bareName(r[0]), cost, limit: int(r[2]) || 1, tag: tag ? tag[1] : '', cat: '武将' };
      }).filter((x) => x.cost);
      rep.push(`珍宝商店：${model.shops.jade.length} 项`);
    }

    /* ---- 祈福：累计积分 → 同心结 ---- */
    const knotRe = /祈福积分达到(\d+)[，,]\s*可领取奖励：(.+?)[，,]\s*限完成1次/g;
    const knot = [];
    while ((m = knotRe.exec(text))) {
      const n = +m[1];
      const km = /同心结\*(\d+)/.exec(m[2]);
      knot.push([n, km ? +km[1] : 0]);
    }
    if (knot.length) { model.shops.qifuMile = knot; rep.push(`累计祈福：${knot.length} 档（含同心结 ${knot.filter((x) => x[1]).length} 档）`); }

    /* ---- 祈福商城 ---- */
    const qfTab = tbs.find((t) => /祈福商店/.test(t.head.join('')));
    if (qfTab) {
      model.shops.qifu = qfTab.rows.map((r) => {
        const tag = /（(.+?)）/.exec(r[0]);
        return { name: bareName(r[0]), cost: int(r[1]), limit: int(r[2]) || 1, tag: tag ? tag[1] : '', cat: '武将' };
      }).filter((x) => x.cost);
      rep.push(`祈福商城：${model.shops.qifu.length} 项`);
    }

    /* ---- 纳贤进度 ---- */
    const nxRe = /累计纳贤(.+?)\*(\d+)[，,]\s*可领取奖励：(.+?)[，,]?\s*限完成1次/g;
    const nx = [];
    while ((m = nxRe.exec(text))) {
      nx.push({ item: m[1].trim(), n: +m[2], reward: m[3], pool: /谋钟会/.test(m[1]) ? 'mzh' : undefined });
    }
    if (nx.length) { model.shops.naxian = nx; rep.push(`纳贤进度：${nx.length} 项`); }

    /* ---- 签筒 ---- */
    const tubeTab = tbs.find((t) => /总签数/.test(t.head.join('')));
    if (tubeTab) {
      const tubes = [];
      tubeTab.rows.forEach((r) => {
        if (r[2] === '大奖') {
          tubes.push({ name: r[0], N: int(r[1]), jackpot: qty(r[3]).name, lian: {} });
        } else if (['大吉', '中吉', '小吉'].includes(r[0]) && tubes.length) {
          const cur = tubes[tubes.length - 1];
          cur.lian[r[0]] = { amount: int(r[2]), count: int(r[3]) };
        }
      });
      model.shops.tubes = tubes;
      rep.push(`签筒：${tubes.length} 个`);
    }

    /* ---- 如意商城 ---- */
    const ryTab = tbs.find((t) => /消耗如意莲/.test(t.head.join('')));
    if (ryTab) {
      model.shops.ruyi = ryTab.rows.map((r) => ({ name: bareName(r[0]), cost: int(r[1]), limit: int(r[2]) || 1, cat: /转生丹|福袋|金印|招募令/.test(r[0]) ? '道具' : '武将' }))
        .filter((x) => x.cost);
      rep.push(`如意商城：${model.shops.ruyi.length} 项`);
    }

    /* ---- 锦绣商店 ---- */
    const jxTab = tbs.filter((t) => t.head[0] === '道具' && /兑换价格/.test(t.head[1] || '') && !/祈福|水晶球|如意莲/.test(t.head.join('')));
    if (jxTab.length) {
      const t = jxTab[jxTab.length - 1];
      model.shops.jinxiu = t.rows.map((r) => {
        const tag = /（(.+?)）/.exec(r[0]);
        return { name: bareName(r[0]), cost: int(r[1]), limit: int(r[2]) || 1, tag: tag ? tag[1] : '', cat: /水晶/.test(r[0]) ? '动态水晶' : '皮肤' };
      }).filter((x) => x.cost);
      rep.push(`锦绣商店：${model.shops.jinxiu.length} 项`);
    }

    /* ---- 夺宝进度（按小标题分转盘） ---- */
    const dbSec = {};
    let curHead = '';
    ls.forEach((line) => {
      const h = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
      if (h) curHead = h[1];
      const mt = /累计参与狂欢夺宝(\d+)次[（(]消耗狂欢夺宝券\*(\d+)[）)][，,]\s*可领取奖励：(.+?)[，,]/.exec(line);
      if (mt) {
        const key = curHead || '默认';
        (dbSec[key] = dbSec[key] || []).push({ n: +mt[1], item: qty(mt[3]).name });
      }
    });
    if (Object.keys(dbSec).length) {
      model.shops.duobao = dbSec;
      const cnt = Object.values(dbSec).reduce((a, v) => a + v.length, 0);
      rep.push(`夺宝进度：${Object.keys(dbSec).length} 个转盘 / ${cnt} 档`);
    }

    /* ---- 水晶球兑换 ---- */
    const crTab = tbs.find((t) => /消耗狂欢水晶球/.test(t.head.join('')));
    if (crTab) {
      model.shops.crystal = crTab.rows.map((r) => ({ name: bareName(r[0]), cost: int(r[1]), limit: int(r[2]) || 1, cat: '武将' })).filter((x) => x.cost);
      rep.push(`水晶球兑换：${model.shops.crystal.length} 项`);
    }

    /* ---- 皮肤直售 ---- */
    const saleTab = tbs.find((t) => {
      if (t.head[0] !== '商品名称') return false;
      const ctxTxt = ls.slice(Math.max(0, t.idx - 16), t.idx).join('');
      return /皮肤特惠直售|皮肤直售/.test(ctxTxt);
    });
    if (saleTab) {
      model.shops.sales = saleTab.rows.map((r) => {
        const nm = /皮肤：(.+?)、/.exec(r[1] || '') || /皮肤：(.+)$/.exec(r[1] || '');
        return { name: (nm ? nm[1].trim() : r[0]).replace(/[。，,、\s]+$/, ''), price: int(r[2]) || 0, cat: '皮肤' };
      }).filter((x) => x.name && x.price);
      rep.push(`皮肤直售：${model.shops.sales.length} 项`);
    }

    /* ---- 白送道具：狂欢福利勋章 / 狂欢钜惠勋章（登录天数表） ---- */
    const gains = {};
    const addGain = (n, q) => { if (n && q > 0) gains[n] = (gains[n] || 0) + q; };
    tbs.forEach((t) => {
      if (String(t.head[0]).indexOf('登录天数') < 0) return;
      t.rows.forEach((r) => {
        for (let i = 1; i < r.length; i++) {
          const q = qty(r[i]);
          if (q && q.n) addGain(q.name, q.n);
        }
      });
    });
    const FREE_OK = ['纳贤令', '狂欢夺宝券', '锦绣', '祈福灯', '凡木签', '武将招募令'];
    const fg = FREE_OK.filter((k) => gains[k]).map((k) => ({ cur: k, qty: gains[k], from: '登录勋章' }));
    if (fg.length) {
      model.freeGains = fg;
      rep.push(`白送道具：${fg.map((x) => x.cur + '×' + x.qty).join('、')}`);
    }

    return { model, report: rep };
  }

  /* ---------------- 应用解析结果 ---------------- */
  function apply(model) {
    const P = window.PRESET;
    if (model.meta) {
      if (model.meta.title) P.meta.title = model.meta.title;
      if (model.meta.start) P.meta.start = model.meta.start;
      if (model.meta.end) P.meta.end = model.meta.end;
      if (P.meta.start && P.meta.end) {
        const d = (new Date(P.meta.end) - new Date(P.meta.start)) / 86400000;
        if (d >= 0) P.meta.days = Math.round(d) + 1;
      }
    }
    if (model.systems && model.systems.length) {
      model.systems.forEach((nb) => {
        const ob = P.systems.find((s) => s.kind === 'box' && s.name === nb.name);
        if (ob && ob.buys) nb.buys = ob.buys;   // 保留 1111 礼包等购买渠道
      });
      P.systems = P.systems.filter((s) => s.kind !== 'box').concat(model.systems);
    }
    const S = model.shops || {};
    const shop = (id) => P.shops.find((s) => s.id === id);
    if (S.jade) shop('jade').items = S.jade;
    if (S.qifu) shop('qifu').items = S.qifu;
    if (S.ruyi) shop('ruyi').items = S.ruyi;
    if (S.jinxiu) shop('jinxiu').items = S.jinxiu;
    if (S.crystal) shop('crystal').items = S.crystal;
    if (S.qifuMile) {
      const q = P.systems.find((s) => s.id === 'qifu');
      q.knotMile = S.qifuMile;
    }
    if (S.naxian) {
      const nx = P.systems.find((s) => s.id === 'naxian');
      nx.progress = S.naxian.map((x) => ({ item: x.item, n: x.n, pool: x.pool }));
    }
    if (S.duobao) {
      const mapName = (k) => (/刘衿|锦笼/.test(k) ? 'db_ljjp' : /威曹彰|赤焰/.test(k) ? 'db_wcz' : /返场|自选/.test(k) ? 'db_fc' : null);
      Object.entries(S.duobao).forEach(([k, arr]) => {
        const id = mapName(k);
        const sys = id && P.systems.find((s) => s.id === id);
        if (sys) sys.progress = arr.map((x) => ({ n: x.n, item: x.item }));
      });
    }
    if (S.tubes) {
      S.tubes.forEach((t) => {
        const sys = P.systems.find((s) => s.name === t.name);
        if (!sys) return;
        sys.tube.jackpot = t.jackpot;
        sys.tube.N = t.N;
        sys.tube.prizes = 1;
        sys.tube.lian = {
          big: t.lian['大吉'] ? t.lian['大吉'].amount : 2000,
          mid: t.lian['中吉'] ? t.lian['中吉'].amount : 1500,
          small: t.lian['小吉'] ? t.lian['小吉'].amount : 1000,
          nBig: t.lian['大吉'] ? t.lian['大吉'].count : 5,
          nMid: t.lian['中吉'] ? t.lian['中吉'].count : 25,
          nSmall: t.lian['小吉'] ? t.lian['小吉'].count : 69,
        };
      });
    }
    if (S.sales) {
      P.directSales = S.sales.map((s) => ({ name: s.name, price: s.price, cat: s.cat }));
    }
    // 白送道具按本期解析结果覆盖；没解析到就清空，避免沿用上一期的免费量
    P.freeGains = model.freeGains || [];
    return true;
  }

  return { parse, apply };
})();
