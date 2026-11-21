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

  /* 网页 innerText 里的表格是 tab 分隔、且没有 markdown 的 |---|---| 分隔行，
     而 tables()/cells() 只认管道表格。若直接喂网页文本，所有表格型板块
     （如意/锦绣/宝玉商店、商城商品、草船兑换、签筒、礼包产出…）会全部解析失败，
     目标因此没有购买路线 → 界面全显示「未满足确定途径」、无法报价。
     这里把「连续 ≥2 行的 tab 行块」转成 markdown 管道表格（补上分隔行）；
     单行 tab 行是「武将技能\t【才韵】」这类键值对，非表格，原样保留。
     对本来就是 markdown 的文本完全不动（幂等）。 */
  function normalizeTabTables(ls) {
    const out = [];
    let i = 0;
    const toPipe = (line) => '| ' + line.split('\t').map((c) => c.trim()).join(' | ') + ' |';
    while (i < ls.length) {
      /* 网页章节标题「四、草船借箭」缺 markdown 的 ## 前缀，
         sections() 只认 ## → 章节定位（草船/充值/消费 secLines）全失效。
         中文数字序号 + 顿号开头的短行补上 ## （markdown 原文已带 ## 则幂等）。 */
      if (/^[一二三四五六七八九十]+、[^\t]{2,30}$/.test(ls[i].trim())) {
        out.push('## ' + ls[i].trim());
        i++;
        continue;
      }
      if (ls[i].indexOf('\t') < 0) { out.push(ls[i]); i++; continue; }
      const start = i;
      while (i < ls.length && ls[i].indexOf('\t') >= 0) i++;
      const block = ls.slice(start, i);
      if (block.length < 2) { out.push.apply(out, block); continue; }
      const ncol = block[0].split('\t').length;
      out.push(toPipe(block[0]));
      out.push('| ' + Array(ncol).join('--- | ') + '--- |');
      for (let k = 1; k < block.length; k++) out.push(toPipe(block[k]));
    }
    return out;
  }

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

  /* 自选福袋名单 → { 福袋名: {品类, 数量} }
     公告里福袋名单长这样：
       「小雪武将自选福袋：陶璜、崔烈、…、武将招募令*10，任选其一。」
     充值得这种福袋时，玩家从名单里挑一项。按用户口径取「最高价值项」折算：
     名单里带数字的道具（武将招募令*10）有商城价、价值明确，优先取；
     纯武将名（无定价）退而取定向武将，归到 sel15 定向列。 */
  let BAG_VAL = {};
  function scanBags(ls) {
    const out = {};
    ls.forEach((raw) => {
      const ln = raw.trim();
      const m = /([^\s：:，,。*]*福袋)\s*[：:]\s*([^。]*?)[，,]?\s*任选其一/.exec(ln);
      if (!m) return;
      const name = clean(m[1]);
      const items = nqList(m[2]);
      /* 取带明确数量的道具项：优先「招募令*N」（单价 1000），其次任意「XX*N」 */
      const numeric = items
        .map((x) => ({ name: x.name, n: x.n, raw: x }))
        .filter((x) => x.n > 1);
      const best = numeric.sort((a, b) => b.n * (b.name === '武将招募令' ? 1000 : 1)
        - a.n * (a.name === '武将招募令' ? 1000 : 1))[0];
      if (best) out[name] = { kind: best.name, n: best.n };
      else out[name] = { kind: '定向武将', n: 1, who: items.map((x) => x.name) };
    });
    return out;
  }

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

  /* 专属纳贤令 → 带归属的品类 key「专令:武将」。
     「陆文漪纳贤令」「店兑换陆文漪纳贤令」只能用于该武将的专属纳贤进度，
     和通用纳贤令不是一回事。旧版 toGives 把 /纳贤令$/ 一律折成通用令，
     导致专属令被当成全武将通用的令（字段判断错误）。这里先归一出武将名：
     剥掉「店兑换 / 特惠精选 / 定向」等渠道前缀，只留真正的武将名。
     「特惠精选纳贤令」是 k 选 1 定向令，走单独的 sel15 口径，不在这里。 */
  function exclusiveHero(raw) {
    const who = CUR.exclusiveLing(raw);
    if (!who || /特惠精选|定向|专属/.test(who)) return null;
    return who.replace(/^(店兑换|商城兑换|兑换)/, '').trim() || null;
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
      /* 自选福袋：玩家从名单里挑一项。按最高价值项折算（用户口径）。
         名单里有「武将招募令*10」这类有商城价的道具 → 折成「定向招募令」；
         只有武将名 → 折成「定向武将」。二者都归倍率表 sel15 定向列。
         只对 opt.bags 开启的调用生效——目前仅「单笔充值」档用，
         消费/累计档的福袋是「只对指定将有用」的定向奖励，有独立的 only 口径，
         折成通用令会污染精测回冲（曾让初冬报价从 1072 虚涨到 1140）。 */
      const bag = opt && opt.bags ? (BAG_VAL[it.name] || BAG_VAL[clean(it.name)]) : null;
      if (bag) {
        const key = bag.kind === '纳贤令' ? '定向武将'
          : (bag.kind === '武将招募令' ? '定向招募令'
            : (bag.kind === '定向武将' ? '定向武将' : bag.kind));
        g[key] = (g[key] || 0) + bag.n * it.n;
        return;
      }
      const c = CUR.canon(it.name);
      if (CUR.isCurrency(it.name)) { g[c] = (g[c] || 0) + it.n; return; }
      /* 专属令优先于通用令判断：先认出「XX纳贤令」的武将归属，
         再决定是专令还是通用令——字段顺序错了就会把专属令折成通用令。 */
      if (/纳贤令$/.test(it.name)) {
        const hero = exclusiveHero(it.name);
        const key = hero ? '专令:' + hero : '纳贤令';
        g[key] = (g[key] || 0) + it.n;
        return;
      }
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
    const ls = normalizeTabTables(lines(text));
    const rep = [];
    const miss = [];
    const model = {
      meta: {}, systems: [], shops: {},
      coupons: {}, chargeTiers: [], cumCharge: [], dailyTiers: [], cumSpend: [],
      dailyCumCharge: [],
      /* 消费送宝玉：累计消费到门槛送传世宝玉（3万/6万/10万/20万 → 3/3/4/10 玉）。
         这类档位写在「传世宝玉」章节，标题不含「消费」，会被 secText(/消费/) 整段漏掉。
         单独建模成 P.jadeSpend，供消费规划提示「补到对应档位」；
         不混进 cumSpend——那些宝箱档 gives 为空，混进来会改变精测回冲与价格基线。 */
      jadeSpend: [],
      /* 草船借箭：概率抽取活动。草人=抽数（来自每日任务），每抽掉箭矢期望值，
         箭矢可去兑换商店必得武将（孙和 12000 / 徐馨 10000）。
         概率武将如孙和/徐馨记为「期望定价」目标：元宝成本 = 需抽数 × 每抽元宝，
         需抽数 = 兑换箭矢 / 箭矢期望。单列字段，不混进普通商店避免基线漂移。 */
      ccbj: null,
      bundles: [], freeGains: [], boughtGains: [], directSales: [],
      unsupported: [], curLabel: {}, naxianDaily: [], redPackets: {},
      /* 福喵纳财：每日消费返绑定元宝。原版只识别活动名、丢进 unsupported，
         手搓攻略「每天消费1w、次日返1200」整条收益链就没进精算。 */
      fumiao: null,
    };

    /* 红包概率表要先扫出来：后面 toGives 遇到「xx红包」要按期望折成绑元 */
    RED_EV = scanRedPackets(ls);
    model.redPackets = RED_EV;
    /* 自选福袋名单：后面 toGives 遇到「xx福袋」按名单最高价值项折算 */
    BAG_VAL = scanBags(ls);
    model.bagValues = BAG_VAL;

    const tbs = tables(ls);
    const secs = sections(ls);
    const secOf = (idx) => { const s = secs.find((x) => idx >= x.idx && idx < x.end); return s ? s.title : ''; };
    const secLines = (re) => { const s = secs.find((x) => re.test(x.title)); return s ? ls.slice(s.idx, s.end) : []; };
    /* 所有命中章节合并（同一期可能出现「消费排行榜」+「消费活动」两段） */
    const secText = (re) => secs.filter((s) => re.test(s.title)).map((s) => ls.slice(s.idx, s.end).join('\n')).join('\n');

    /* ---------- 标题 / 日期 ----------
       官网公告 md 用 "# 标题"；但油猴从网页 copy 的 innerText 没有 # 前缀，
       标题行形如「11.21-11.28 小雪活动 新将…活动上线」。以前只认 # 行，
       导致网页文本导入后 meta.title 为空、apply 时保留上一期标题，界面显示
       「日期已更新成小雪、标题还是双十一」的错位。这里加两级兜底：
       ① # 行；② 含 M.D-M.D 日期范围且较长的行（网页文本标题特征）。 */
    let title = (ls.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
    if (!title) {
      const tline = ls.find((l) => {
        const s = l.trim();
        if (s.length < 12 || /^活动时间|^官网首页|^返回|^当前位置|^资讯详情|^游戏公告/.test(s)) return false;
        return /\d{1,2}[.\-]\d{1,2}\s*[-~至]\s*\d{1,2}[.\-]\d{1,2}/.test(s) && /[^0-9.\-~\s]/.test(s);
      });
      if (tline) title = tline.trim();
    }
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

    /* ---------- 2.5 草船借箭：草人（抽）→ 箭矢（期望）→ 兑换武将 ----------
       识别三张表：每日任务（获得草人）、抽取掉落箭矢概率、箭矢兑换。
       概率武将（孙和/徐馨）本公告只给出「掉落概率 + 重复返还箭矢」，
       真正的保底路径是兑换商店（孙和 12000 / 徐馨 10000 箭矢）。
       箭矢期望 = Σ(箭矢数 × 概率)，人工精测口径取期望；这里同时记 min 保底。 */
    const ccLines = secLines(/草船借箭/);
    if (ccLines.length) {
      const ccTbs = tables(ccLines);
      const cc = { grass: { game: 1, charge: [], spend: [] }, arrow: { prob: [], ev: 0, min: 0 }, exchange: [], dropBack: [] };

      /* 每日任务表：列名含「获得草人」；行形如「累计充值5000元宝 | … | 10」 */
      const grassTb = ccTbs.find((t) => t.head.some((h) => /草人/.test(h)));
      if (grassTb) {
        grassTb.rows.forEach((r) => {
          const label = r[0] || '';
          const q = num(r[r.length - 2]) || num(r[r.length - 1]) || 0;
          if (!q) return;
          if (/游戏/.test(label)) cc.grass.game = q;
          else if (/充值/.test(label)) cc.grass.charge.push({ need: num(label), qty: q });
          else if (/消费/.test(label)) cc.grass.spend.push({ need: num(label), qty: q });
        });
        cc.grass.charge.sort((a, b) => a.need - b.need);
        cc.grass.spend.sort((a, b) => a.need - b.need);
      }

      /* 箭矢概率表：head = 数量 / 概率（pct() 解析 20.00%） */
      const probTb = ccTbs.find((t) => /数量/.test(t.head[0] || '') && /概率/.test(t.head[1] || ''));
      if (probTb) {
        probTb.rows.forEach((r) => {
          const q = num(r[0]), p = pct(r[1]);
          if (q && p != null) cc.arrow.prob.push({ qty: q, p });
        });
        if (cc.arrow.prob.length) {
          cc.arrow.ev = Math.round(cc.arrow.prob.reduce((a, x) => a + x.qty * x.p / 100, 0));
          cc.arrow.min = Math.min.apply(null, cc.arrow.prob.map((x) => x.qty));
        }
      }

      /* 概率额外掉落：武将名 / 概率 / 重复返还箭矢 → 孙和+400、徐馨+300 等。
         这张表的武将名单同时充当「箭矢兑换表里哪些是武将」的白名单——
         兑换表里还有宝箱/转生丹/招募令等道具，不能用「非宝箱」粗暴排除。 */
      const dropTb = ccTbs.find((t) => /道具/.test(t.head[0] || '') && /概率/.test(t.head[1] || '') && /注明/.test(t.head[2] || ''));
      if (dropTb) {
        dropTb.rows.forEach((r) => {
          const nm = bareName(r[0]), p = pct(r[1]);
          const back = /箭矢[*×](\d+)/.exec(r[2] || '');
          if (nm && p != null && back) cc.dropBack.push({ name: nm, p, arrows: +back[1] });
        });
      }
      const heroSet = new Set(cc.dropBack.map((x) => x.name));

      /* 箭矢兑换表：道具名 / 消耗箭矢 / 限制兑换次数。只留「概率掉落名单」里的武将。
         这样董絮/孙和/徐馨等进目标，宝箱/转生丹/招募令等道具被干净排除。 */
      const exTb = ccTbs.find((t) => /道具名/.test(t.head[0] || '') && /箭矢/.test(t.head[1] || ''));
      if (exTb) {
        exTb.rows.forEach((r) => {
          const nm = bareName(r[0]), cost = num(r[1]), limit = num(r[2]) || 1;
          if (!nm || !cost) return;
          if (heroSet.size && !heroSet.has(nm)) return;   // 非概率掉落武将 = 道具，跳过
          cc.exchange.push({ name: nm, arrows: cost, limit });
        });
      }

      if (cc.exchange.length || cc.arrow.prob.length) {
        model.ccbj = cc;
        rep.push(`草船借箭：草人任务 充${cc.grass.charge.length}/消${cc.grass.spend.length} 档，箭矢期望 ${cc.arrow.ev}（保底 ${cc.arrow.min}），兑换武将 ${cc.exchange.length} 位`);
      }
    }

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
              const hero = exclusiveHero(it.name);
              /* 用「专令:武将」统一 key；旧版写「专属:」再用 slice(4) 取名字，
                 会把「陆文漪」截成「文漪」，名字对不上就永远不抵扣。 */
              const k = hero ? '专令:' + hero : '纳贤令';
              acc[k] = (acc[k] || 0) + it.n;
            }
          });
        }
      });
      Object.entries(acc).forEach(([cur, qty]) => {
        if (/^专令:/.test(cur)) {
          const hero = cur.slice(3);
          model.freeGains.push({ cur, qty, from: '七日任务·' + hero, only: [hero] });
        } else model.freeGains.push({ cur, qty, from: '七日活跃任务' });
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
      const gives = toGives(body, { bags: true });
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
    /* 「额外赠」段：同 need 且都无日期限定时，并入主档。
       关键：限次口径不同的奖励不能一起按主档次数累乘。
       例：单笔 3000 同时有「纳贤令×3 / 每日限1次」和「小雪大红包 / 限完成1次」，
       红包期望 6150 若并进 gives，就会跟着主档 cap=8 被算成 8 份（¥30×7 报 43050）。
       整期限1次的那份移到 onceGives，无论主档买几次都只计 1 份。 */
    {
      const merged = [];
      const byNeed = {};
      model.chargeTiers.forEach((t) => {
        const p = byNeed[t.need];
        if (!p || (t.onlyDay || t.fromDay) || (p.onlyDay || p.fromDay)) {
          if (!p) byNeed[t.need] = t;
          merged.push(t);
          return;
        }
        const pOnce = !p.perDay && p.total === 1;
        const tOnce = !t.perDay && t.total === 1;
        if (pOnce !== tOnce) {
          const onceT = pOnce ? p : t;   /* 整期限1次的那份 */
          const multT = pOnce ? t : p;   /* 可累乘的那份，留作主档 */
          multT.onceGives = Object.assign(multT.onceGives || {}, onceT.gives);
          byNeed[t.need] = multT;
          if (pOnce) {
            const at = merged.indexOf(p);
            if (at >= 0) merged[at] = multT;
          }
          return;
        }
        Object.entries(t.gives).forEach(([k, v]) => { p.gives[k] = (p.gives[k] || 0) + v; });
      });
      model.chargeTiers = merged;
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

    /* ---------- 12.5 复合条件档里的专属纳贤令 ----------
       「累计充值18888元宝，且累计消费达到28888元宝，可领取奖励：…陆文漪纳贤令*3」
       「单笔充值12800元宝，且累计参与纳贤10次，可领取奖励：陆文漪纳贤令*10」
       这类句子带「且」，上面的 cumRe / chargeRe 要求「充值X元宝，可领取奖励」紧跟，
       整档匹配不到，专属令就整段丢了。
       这里单独兜底：只要是「…且…，可领取奖励：…专令…」，
       就把里面的专属令提取成带 only 的白送令（人工精测也是按「条件一达标就领」算）。
       只提专属令，不动普通令/红包，避免改变既有充值返利与价格基线。 */
    const mixRe = /(?:累计|单笔)充值\d+元宝[，,]\s*且[^，。]+[，,]\s*可领取奖励：([^。]+)[。]/g;
    while ((mm = mixRe.exec(text))) {
      const body = mm[1].replace(/[，,]\s*(?:每日)?限完成\d+次.*$/, '');
      const g = toGives(body);
      Object.keys(g).forEach((k) => {
        if (!/^专令:/.test(k)) return;
        const hero = k.slice(3);
        model.freeGains.push({ cur: k, qty: g[k], from: '复合条件档达标', only: [hero] });
      });
    }

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

    /* ---------- 13.5 消费送宝玉（整期累计，章节标题常不含「消费」） ----------
       秋华 / 小雪 / 中秋期都有「累计消费 3万/6万/10万/20万 → 传世宝玉 3/3/4/10」，
       写在《传世宝玉》章节里，上面的 sText（只取标题含消费的章节）抓不到。
       这里对全文兜底扫描「累计消费X → 宝玉」这一类，供消费规划提示补到档位。
       用 need|gives 去重，避免同一档在公告里出现两次被记两遍。 */
    const jadeSpendSeen = new Set();
    const jsRe = /累计消费(?:达到)?(\d+)元宝[，,]\s*可领取奖励：([^。]*?)[。]/g;
    while ((mm = jsRe.exec(text))) {
      const body = mm[2].replace(/[，,]\s*(?:累计)?限完成\d+次.*$/, '');
      if (!/宝玉/.test(body)) continue;
      const gives = toGives(body);
      if (!gives['传世宝玉'] && !gives['宝玉碎片']) continue;
      const need = +mm[1];
      const key = need + '|' + JSON.stringify(gives);
      if (jadeSpendSeen.has(key)) continue;
      jadeSpendSeen.add(key);
      model.jadeSpend.push({ need, gives, note: body.slice(0, 36) });
    }
    if (model.jadeSpend.length) {
      rep.push(`消费送宝玉：${model.jadeSpend.map((t) => `${t.need}→${t.gives['传世宝玉'] || t.gives['宝玉碎片']}玉`).join('、')}`);
    }

    /* ---------- 14. 抵价券面额 ---------- */
    const cpRe = /抵价券\s*[（(]\s*(\d+)\s*-\s*(\d+)\s*[）)]/g;
    while ((mm = cpRe.exec(text))) {
      const face = +mm[2], min = +mm[1];
      if (face && min && face <= min) model.coupons['券' + face] = { face, min, name: `抵价券 ${min}-${face}` };
    }
    if (Object.keys(model.coupons).length) rep.push(`抵价券：${Object.values(model.coupons).map((c) => c.name).join('、')}`);
    else miss.push('抵价券');

    /* ---------- 14.6 福喵纳财：每日消费返利 ----------
       次日按「昨日累计消费 × 返利比例」返还绑定元宝，封顶每日上限。
       比例由当日完成的任务叠加：3 局游戏 / 充值 600 / 充值 12800 / 消费 1w。
       充值侧那两档依赖逐日充值分布，方案里按「能达到即计」处理；
       这里先把规则和上限从公告解析出来，不再当未建模玩法丢掉。 */
    const fmSec = secs.find((s) => /福喵/.test(s.title));
    if (fmSec) {
      const fmText = ls.slice(fmSec.idx, fmSec.end).join('\n');
      const capM = /每日返利上限[：:]\s*(\d+)\s*元宝/.exec(fmText);
      const tasks = [];
      const gm = /完成(\d+)局游戏[^\n]*?\|\s*(\d+)%/.exec(fmText);
      if (gm) tasks.push({ kind: 'games', need: +gm[1], rate: +gm[2] / 100, label: `完成${gm[1]}局游戏` });
      const cmRe = /累计充值(\d+)元宝[^\n]*?\|\s*(\d+)%/g;
      let cm;
      while ((cm = cmRe.exec(fmText))) {
        tasks.push({ kind: 'charge', need: +cm[1], rate: +cm[2] / 100, label: `累计充值${cm[1]}` });
      }
      const sm = /累计消费(\d+)元宝[^\n]*?\|\s*(\d+)%/.exec(fmText);
      if (sm) tasks.push({ kind: 'spend', need: +sm[1], rate: +sm[2] / 100, label: `累计消费${sm[1]}` });
      if (tasks.length) {
        model.fumiao = {
          enabled: true,
          cap: capM ? +capM[1] : 10000,
          tasks,
          note: '次日按昨日累计消费×当日返利比例返还绑定元宝，不超过每日上限',
        };
        rep.push(`福喵纳财返利：上限 ${model.fumiao.cap}/日，${tasks.map((t) => `${t.label} +${Math.round(t.rate * 100)}%`).join('、')}`);
      }
    }

    /* ---------- 15. 未建模玩法 ---------- */
    const KINDS = [
      [/砸蛋/, '幸运砸蛋'], [/绘卷/, '群英绘卷'], [/连连看/, '欢乐连连看'],
      [/积惠特卖/, '积惠特卖'], [/幸运夺宝/, '幸运夺宝'],
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
      /* 已经折算成「专令:武将」的专属令，不再当「未折算定向令」误报 */
      if (exclusiveHero(s)) return;
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

    /* ---- 草船借箭（概率武将期望定价的数据源） ----
       ccbjTargets 让概率武将进目标库、能被点选；它们没有直接购买渠道
       （靠方案消费产草人→抽箭矢→兑换），needOf 里自然落到 kind=null，
       由 ccbjPlan 单独判定覆盖，不会误报「本期无确定途径」。 */
    P.ccbj = model.ccbj || null;
    P.ccbjTargets = model.ccbj ? (model.ccbj.exchange || []).map((x) => ({
      name: x.name, arrows: x.arrows, limit: x.limit,
    })) : [];

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
    P.jadeSpend = (model.jadeSpend || []).slice();
    P.redPackets = model.redPackets || {};
    P.fumiao = model.fumiao || null;
    if (P.fumiao) log.push(`福喵纳财返利已建模：上限 ${P.fumiao.cap}/日`);
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
