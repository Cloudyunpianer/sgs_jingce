/* ============================================================
   本期活动数据（2026-11-07 ~ 11-15 双十一狂欢）
   数据来源：官网公告 md，手工整理为可计算模型
   ============================================================ */

const JADE_SHARD = '宝玉碎片';
const JADE = '传世宝玉';

/* ---------- 珍宝礼盒公共掉落表（三个礼盒除大奖外完全一致） ---------- */
function boxTable(jackpot) {
  return [
    [jackpot, 0.005, { [jackpot]: 1 }],
    ['陆凯', 0.005, { 陆凯: 1 }],
    ['韩龙', 0.006, { 韩龙: 1 }],
    ['苏飞', 0.008, { 苏飞: 1 }],
    ['徐琨', 0.018, { 徐琨: 1 }],
    ['传世宝玉×10', 0.006, { [JADE]: 10 }],
    ['传世宝玉×5', 0.012, { [JADE]: 5 }],
    ['传世宝玉×2', 0.026, { [JADE]: 2 }],
    ['传世宝玉×1', 0.055, { [JADE]: 1 }],
    ['宝玉碎片×5', 0.130, { [JADE_SHARD]: 5 }],
    ['宝玉碎片×2', 0.280, { [JADE_SHARD]: 2 }],
    ['宝玉碎片×1', 0.750, { [JADE_SHARD]: 1 }],
    ['武将招募令', 1.5, {}],
    ['皮肤包', 3.5, {}],
    ['锦囊袋', 3.5, {}],
    ['普通将印宝箱', 3.5, {}],
    ['灵韵×500', 9.1, {}],
    ['水晶碎片', 9.2, {}],
    ['鲜花×10', 9.2, {}],
    ['点将卡', 19.733, {}],
    ['手气卡×2', 19.733, {}],
    ['换将卡', 19.733, {}],
  ];
}

/* ---------- 如意签筒的如意莲产出 ---------- */
function tubeLian(big, mid, small, nBig, nMid, nSmall) {
  return { big, mid, small, nBig, nMid, nSmall };
}

const PRESET = {
  meta: {
    id: '2026-11-07',
    title: '11.7-11.15 双十一狂欢',
    start: '2026-11-07',
    end: '2026-11-15',
    days: 9,
    rmbPer100: 1,          // 100 元宝 = 1 元
    source: 'https://x.sanguosha.com/news/20261106_6706_0917.html',
  },

  /* 单买兜底价：不限购、随时可买，不用凑礼包/不用赌开盒。
     祈福灯 = 商城单灯 1000 元宝（bulk 礼包更便宜，但有限购、要凑档）；
     传世宝玉 没有直售，按「50 盒保底 1 玉 × 200 元宝/盒」折 10,000 元宝/玉，
     即「不抽随机、纯保底」的等价单价。 */
  singles: {
    祈福灯: { price: 1000, unit: '灯', src: '祈福礼包(单灯) 1,000 元宝，不限购' },
    传世宝玉: { price: 10000, unit: '玉', src: '保底口径：1 玉 = 50 盒 × 200 元宝' },
  },

  /* 可调假设：所有未公示或需主观判断的参数集中在这里 */
  params: {
    shardPerJade: 5,       // 宝玉碎片→传世宝玉 的兑换比例（公告未公示，默认 5:1）
    qifuExtraKnot: 1,      // 祈福每灯固定 1 同心结（灯 = 结 1:1，不再用 0.75 的均值估算）
    jxXiangzhi: 200,       // 锦绣「相知」累计寻觅次数（公告未公示，默认 200）
    jxGuren: 300,          // 锦绣「故人」累计寻觅次数（达到后下一次必得，默认 300）
    duobaoPity: 100,       // 狂欢夺宝吉运满 100 后下一次必得
    fuma: false,           // 是否已激活福马（签筒大奖签翻倍，需累计充值 12800）
  },

  systems: [
    /* ================= 珍宝礼盒 ================= */
    {
      id: 'box_wcb', kind: 'box', name: '威曹彰礼盒', unit: '盒', pool: 'jade',
      buys: [
        { qty: 10, price: 1111, maxTotal: 10, label: '1111威曹彰礼包' },
        { qty: 1, price: 200, label: '单盒 200元宝' },
        { qty: 50, price: 10000, label: '大礼包 50盒' },
      ],
      always: { 灵韵: 250 },
      table: boxTable('威曹彰'),
      mile: { every: 50, give: { [JADE]: 1 }, cap: 20 },
    },
    {
      id: 'box_szh', kind: 'box', name: '神钟会礼盒', unit: '盒', pool: 'jade',
      buys: [
        { qty: 1, price: 200, label: '单盒 200元宝' },
        { qty: 50, price: 10000, label: '大礼包 50盒' },
      ],
      always: { 灵韵: 250 },
      table: boxTable('神钟会'),
      mile: { every: 50, give: { [JADE]: 1 }, cap: 20 },
    },
    {
      id: 'box_wcc', kind: 'box', name: '威曹操礼盒', unit: '盒', pool: 'jade',
      buys: [
        { qty: 1, price: 200, label: '单盒 200元宝' },
        { qty: 50, price: 10000, label: '大礼包 50盒' },
      ],
      always: { 灵韵: 250 },
      table: boxTable('威曹操'),
      mile: { every: 50, give: { [JADE]: 1 }, cap: 25 },
    },

    /* ================= 祈福 ================= */
    {
      id: 'qifu', kind: 'qifu', name: '祈福', unit: '灯', pool: 'knot',
      buys: [
        { qty: 3, price: 1111, cur: '通用元宝', perDay: 1, label: '1111祈福礼包(通用)' },
        { qty: 1, price: 600, cur: '通用元宝', perDay: 2, label: '祈福特惠小礼包(通用)' },
        { qty: 10, price: 8888, perDay: 2, label: '祈福特惠礼包(10灯)' },
        { qty: 10, price: 10000, label: '祈福礼盒(10灯)' },
        { qty: 1, price: 1000, label: '祈福礼包(单灯)' },
      ],
      table: [
        ['祈福武将', 0.10, {}], ['限定武将', 0.27, {}], ['限定皮肤', 0.70, {}],
        ['三国秀', 24.21, {}], ['普通皮肤', 26.91, {}], ['稀有皮肤', 8.10, {}],
        ['史诗皮肤', 4.09, {}], ['传说皮肤', 1.59, {}], ['热门武将', 7.91, {}],
        ['其他道具', 26.12, {}],
      ],
      /* 累计祈福积分 → 同心结（确定性收益，来源：累计祈福奖励表） */
      knotMile: [
        [12, 0], [20, 0], [32, 40], [64, 0], [100, 60], [150, 50], [200, 50],
        [250, 50], [300, 50], [350, 50], [400, 50], [450, 50], [500, 100],
        [600, 100], [700, 100], [800, 100], [900, 100], [1000, 200], [1500, 600],
      ],
      shopRef: 'qifu',
    },

    /* ================= 纳贤 ================= */
    {
      id: 'naxian', kind: 'progress', name: '纳贤', unit: '令', pool: 'naxian',
      freeCur: '纳贤令', freePer: 1,
      buys: [
        { qty: 2, price: 1111, maxTotal: 10, label: '1111纳贤礼包' },
        { qty: 1, price: 200, perDay: 1, label: '每日第1次特惠' },
        { qty: 1, price: 500, perDay: 1, label: '每日第2次特惠' },
        { qty: 2, price: 1888, perDay: 1, label: '每日纳贤礼包' },
        { qty: 8, price: 6888, cur: '通用元宝', maxTotal: 1, label: '纳贤特惠礼包(通用)' },
        { qty: 2, price: 888, cur: '通用元宝', maxTotal: 1, label: '狂欢招募礼包(通用)' },
        { qty: 1, price: 1000, label: '纳贤令 1000元宝' },
      ],
      /* 累计进度奖励（每个武将独立计数） */
      progress: [
        { item: '谋钟会', n: 120, pool: 'mzh' },
        { item: '星诸葛瑾', n: 100 },
        { item: '崔芷', n: 120 },
        { item: '谋马谡', n: 120 },
        { item: '谋邓艾', n: 120 },
        { item: '夏侯徽', n: 120 },
        { item: '傅干', n: 100 },
        { item: '马铁', n: 100 },
      ],
      /* 海纳百川：100/120 次各一档 6 选 1，限 5 次 */
      haiyou: [
        { n: 100, items: ['谋曹洪', '乐邹氏', '庞宏', '乐小乔', '星孙坚', '大将军印*1'], cap: 5 },
        { n: 120, items: ['乐貂蝉', '谋司马师', '孙霸', '黄舞蝶', '田尚衣', '大将军印'], cap: 5 },
      ],
      table: [
        ['谋钟会', 0.0625, { 谋钟会: 1 }], ['星诸葛瑾', 0.0625, { 星诸葛瑾: 1 }],
        ['崔芷', 0.0625, { 崔芷: 1 }], ['谋马谡', 0.0625, { 谋马谡: 1 }],
        ['谋邓艾', 0.0625, { 谋邓艾: 1 }], ['夏侯徽', 0.0625, { 夏侯徽: 1 }],
        ['傅干', 0.0625, { 傅干: 1 }], ['马铁', 0.0625, { 马铁: 1 }],
        ['杜夫人', 0.5, {}], ['荀谌', 0.5, {}], ['热门武将', 5, {}],
        ['其他道具', 92.375, {}],
      ],
    },

    /* ================= 锦绣霓裳 ================= */
    {
      id: 'jinxiu', kind: 'jinxiu', name: '锦绣霓裳', unit: '锦绣', pool: 'satin',
      buys: [
        { qty: 3, price: 888, maxTotal: 20, label: '1111锦绣礼包(3锦绣)' },
        { qty: 10, price: 3888, perDay: 2, label: '每日十连特惠' },
        { qty: 10, price: 5000, label: '十连' },
        { qty: 1, price: 500, label: '锦绣 500元宝' },
      ],
      table: [
        ['锦绣大奖', 0.40, {}], ['限定皮肤库', 0.27, {}], ['传说皮肤库', 1.70, {}],
        ['史诗皮肤库', 3.50, {}], ['稀有皮肤库', 12.00, {}], ['普通皮肤库', 37.00, {}],
        ['其他道具库', 37.13, {}], ['随机绸缎库', 8.00, {}],
      ],
      satinEv: 0.84,          // 每次寻觅期望绸缎（8% × 6~15 均 10.5）
      pity: 'jinxiu',
      shopRef: 'jinxiu',
    },

    /* ================= 狂欢夺宝（三转盘结构相同，仅大奖不同） ================= */
    {
      id: 'db_ljjp', kind: 'gacha', name: '狂欢夺宝·刘衿刘佩', unit: '抽', pool: 'duobao',
      freeCur: '狂欢夺宝券', freePer: 5,
      buys: [
        { qty: 3, price: 888, maxTotal: 20, label: '1111夺宝礼包(15券)' },
        { qty: 10, price: 3888, perDay: 2, label: '每日十连特惠' },
        { qty: 10, price: 5000, label: '十连(50券)' },
        { qty: 1, price: 500, label: '单抽(5券)' },
      ],
      table: [
        ['锦笼连姝*刘衿刘佩', 0.5, { '锦笼连姝*刘衿刘佩': 1 }],
        ['时欢岁好宝箱', 0.2, {}], ['立冬传说初级宝箱', 0.3, {}],
        ['其他道具', 99.0, {}],
      ],
      pity: 'duobao',
      progress: [
        { n: 80, item: '高级转生丹' },
        { n: 180, item: '锦笼连姝*刘衿刘佩' },
        { n: 240, item: '时欢岁好宝箱' },
      ],
    },
    {
      id: 'db_wcz', kind: 'gacha', name: '狂欢夺宝·威曹彰', unit: '抽', pool: 'duobao',
      freeCur: '狂欢夺宝券', freePer: 5,
      buys: [
        { qty: 3, price: 888, maxTotal: 20, label: '1111夺宝礼包(15券)' },
        { qty: 10, price: 3888, perDay: 2, label: '每日十连特惠' },
        { qty: 10, price: 5000, label: '十连(50券)' },
        { qty: 1, price: 500, label: '单抽(5券)' },
      ],
      table: [
        ['赤焰横戈*威曹彰', 0.5, { '赤焰横戈*威曹彰': 1 }],
        ['韶华佳庆宝箱', 0.2, {}], ['立冬传说初级宝箱', 0.3, {}],
        ['其他道具', 99.0, {}],
      ],
      pity: 'duobao',
      progress: [
        { n: 80, item: '高级转生丹' },
        { n: 180, item: '赤焰横戈*威曹彰' },
        { n: 240, item: '韶华佳庆宝箱' },
      ],
    },
    {
      id: 'db_fc', kind: 'gacha', name: '狂欢夺宝·精品返场', unit: '抽', pool: 'duobao',
      freeCur: '狂欢夺宝券', freePer: 5,
      buys: [
        { qty: 3, price: 888, maxTotal: 20, label: '1111夺宝礼包(15券)' },
        { qty: 10, price: 3888, perDay: 2, label: '每日十连特惠' },
        { qty: 10, price: 5000, label: '十连(50券)' },
        { qty: 1, price: 500, label: '单抽(5券)' },
      ],
      table: [
        ['狂欢传说自选宝箱', 0.5, { '狂欢传说自选宝箱': 1 }],
        ['韶华佳庆宝箱', 0.2, {}], ['立冬传说初级宝箱', 0.3, {}],
        ['其他道具', 99.0, {}],
      ],
      pity: 'duobao',
      progress: [
        { n: 80, item: '高级转生丹' },
        { n: 160, item: '狂欢传说自选宝箱' },
        { n: 240, item: '韶华佳庆宝箱' },
      ],
    },
  ],

  /* ================= 各兑换商店 ================= */
  shops: [
    {
      id: 'jade', name: '珍宝商店', currency: JADE, note: '宝玉由三个珍宝礼盒共同产出，商店共用',
      items: [
        { name: '威曹彰', cost: 20, limit: 1, tag: '8折(原25)', cat: '武将' },
        { name: '神钟会', cost: 20, limit: 1, cat: '武将' },
        { name: '威曹操', cost: 25, limit: 1, cat: '武将' },
        { name: '威刘备', cost: 25, limit: 1, cat: '武将' },
        { name: '谋庞统', cost: 25, limit: 1, cat: '武将' },
        { name: '神黄忠', cost: 20, limit: 1, cat: '武将' },
        { name: '神张飞', cost: 20, limit: 1, cat: '武将' },
        { name: '神华佗', cost: 20, limit: 1, cat: '武将' },
      ],
    },
    {
      id: 'qifu', name: '祈福商城', currency: '同心结', note: '同心结主要来自累计祈福积分',
      items: [
        { name: '徐荣', cost: 850, limit: 1, tag: '85折', cat: '武将' },
        { name: '关索', cost: 900, limit: 1, tag: '9折', cat: '武将' },
        { name: '张琪瑛', cost: 1000, limit: 1, cat: '武将' },
        { name: '曹纯', cost: 1000, limit: 1, cat: '武将' },
        { name: '威孙尚香', cost: 300, limit: 1, cat: '武将' },
        { name: '威马超', cost: 300, limit: 1, cat: '武将' },
        { name: '威孙权', cost: 300, limit: 1, cat: '武将' },
        { name: '许靖', cost: 300, limit: 1, cat: '武将' },
        { name: '关樾', cost: 300, limit: 1, cat: '武将' },
        { name: '滕芳兰', cost: 300, limit: 1, cat: '武将' },
        { name: '董贵人', cost: 200, limit: 1, cat: '武将' },
        { name: '曹芳', cost: 200, limit: 1, cat: '武将' },
        { name: '柳婒', cost: 200, limit: 1, cat: '武将' },
        { name: '张瑾云', cost: 200, limit: 1, cat: '武将' },
        { name: '刘衿刘佩', cost: 200, limit: 1, cat: '武将' },
        { name: '任婉', cost: 200, limit: 1, cat: '武将' },
      ],
    },
    {
      id: 'ruyi', name: '如意商城', currency: '如意莲', note: '如意莲来自签筒中未中大奖的签',
      items: [
        { name: '赵襄转生丹', cost: 122800, limit: 1, cat: '道具' },
        { name: '谋董承', cost: 100000, limit: 1, cat: '武将' },
        { name: '谋胡烈', cost: 100000, limit: 1, cat: '武将' },
        { name: '孟达', cost: 100000, limit: 1, cat: '武将' },
        { name: '贾充', cost: 100000, limit: 1, cat: '武将' },
        { name: '蒯祺', cost: 100000, limit: 1, cat: '武将' },
        { name: '文钦', cost: 80000, limit: 1, cat: '武将' },
        { name: 'B级将灵福袋', cost: 20000, limit: 1, cat: '道具' },
        { name: '高级转生丹', cost: 10000, limit: 1, cat: '道具' },
        { name: '枭雄金印', cost: 30000, limit: 1, cat: '道具' },
        { name: '武将招募令*10', cost: 10000, limit: 1, cat: '道具' },
      ],
    },
    {
      id: 'jinxiu', name: '锦绣商店', currency: '绸缎', note: '绸缎来自每次寻觅的随机掉落',
      items: [
        { name: '春宵彩翼*任婉', cost: 192, limit: 1, tag: '8折', cat: '皮肤' },
        { name: '春宵任婉水晶', cost: 192, limit: 1, tag: '8折', cat: '动态水晶' },
        { name: '龙陛霆威*孙綝', cost: 192, limit: 1, tag: '8折', cat: '皮肤' },
        { name: '虎贲冠勇*王昶', cost: 192, limit: 1, tag: '8折', cat: '皮肤' },
        { name: '虎贲王昶水晶', cost: 192, limit: 1, tag: '8折', cat: '动态水晶' },
        { name: '权倾龙廷*谋贾诩', cost: 400, limit: 1, cat: '皮肤' },
        { name: '权倾谋贾诩水晶', cost: 400, limit: 1, cat: '动态水晶' },
        { name: '马到功成*神马超', cost: 240, limit: 1, cat: '皮肤' },
        { name: '马到神马超水晶', cost: 240, limit: 1, cat: '动态水晶' },
        { name: '马到功成*神黄忠', cost: 240, limit: 1, cat: '皮肤' },
        { name: '马到神黄忠水晶', cost: 240, limit: 1, cat: '动态水晶' },
        { name: '情澜拾珠*夏侯徽', cost: 240, limit: 1, cat: '皮肤' },
        { name: '情澜夏侯徽水晶', cost: 240, limit: 1, cat: '动态水晶' },
        { name: '情澜拾珠*谋司马师', cost: 240, limit: 1, cat: '皮肤' },
        { name: '情澜谋司马师水晶', cost: 240, limit: 1, cat: '动态水晶' },
        { name: '暖风恋心*乐大乔', cost: 240, limit: 1, cat: '皮肤' },
        { name: '暖风恋心*乐小乔', cost: 240, limit: 1, cat: '皮肤' },
        { name: '姝丽风华*乐邹氏', cost: 240, limit: 1, cat: '皮肤' },
        { name: '姝丽风华*田尚衣', cost: 240, limit: 1, cat: '皮肤' },
      ],
    },
    {
      id: 'crystal', name: '狂欢水晶球兑换', currency: '狂欢水晶球', note: '水晶球来自单笔充值档位，属真实充值',
      items: [
        { name: '许劭', cost: 22, limit: 1, cat: '武将' },
        { name: '管宁', cost: 17, limit: 1, cat: '武将' },
        { name: '谋程普', cost: 11, limit: 1, cat: '武将' },
        { name: '谋张任', cost: 11, limit: 1, cat: '武将' },
        { name: '谋曹昂', cost: 11, limit: 1, cat: '武将' },
        { name: '张燕', cost: 11, limit: 1, cat: '武将' },
        { name: '吴班', cost: 4, limit: 1, cat: '武将' },
        { name: '胡遵', cost: 4, limit: 1, cat: '武将' },
        { name: '谋骆统', cost: 4, limit: 1, cat: '武将' },
        { name: '马邈', cost: 4, limit: 1, cat: '武将' },
        { name: '谋淳于琼', cost: 4, limit: 1, cat: '武将' },
        { name: '谯周', cost: 2, limit: 1, cat: '武将' },
        { name: '武安国', cost: 2, limit: 1, cat: '武将' },
        { name: '车胄', cost: 2, limit: 1, cat: '武将' },
      ],
    },
  ],

  /* 累计消费送宝玉（整期累计，非每日重置）：默认期为空，由公告导入时填充。
     与 cumSpend 分开，避免宝箱类空 gives 档影响回冲与价格基线。 */
  jadeSpend: [],

  /* ================= 每日消费档位（每天各限 1 次，达到即领，逐档累计） ================= */
  dailyTiers: [
    { need: 1111, gives: { 券1111: 1 }, note: '抵价券1111 + 凡木签×1' },
    { need: 3888, gives: { 狂欢夺宝券: 5, 纳贤令: 1 }, note: '夺宝券×5 + 纳贤令×1' },
    { need: 8888, gives: { 狂欢夺宝券: 10, 锦绣: 2, 券1111: 1 }, note: '夺宝券×10 + 锦绣×2 + 抵价券1111' },
    { need: 18888, gives: { 纳贤令: 5, 券1111: 2 }, note: '纳贤令×5 + 抵价券1111×2' },
    { need: 28888, gives: { 纳贤令: 10, 券2888: 1 }, note: '纳贤令×10 + 抵价券2888' },
    { need: 38888, gives: { 祈福灯: 1, 狂欢夺宝券: 50 }, note: '祈福灯×1 + 夺宝券×50 + 自选宝箱' },
    { need: 58888, gives: { 纳贤令: 10, 券2888: 2 }, note: '纳贤令×10 + 抵价券2888×2' },
    { need: 88888, gives: {}, note: '纳贤武将自选福袋（只对指定 5 将有用）' },
  ],

  /* ================= 每日累计充值档（当天充值额达标即送，与单笔充值档叠加） =================
     注意和 chargeTiers 的区别：这里不是「花掉 N 元宝买这个档」，
     而是「当天充值满 N 元宝就送」。充 60 元（6000 元宝）既拿 6000 档奖励，
     也满足 5888 门槛，两份都要。 */
  dailyCumCharge: [
    { need: 5888, gives: { 纳贤令: 10 }, note: '每日重置，累计充值 5888 → 纳贤令×10' },
  ],

  /* ================= 抵价券（面额 = 减免元宝；满额才有用） ================= */
  coupons: {
    券1111: { face: 1111, min: 3000, name: '抵价券 3000-1111' },
    券2888: { face: 2888, min: 3000, name: '抵价券 3000-2888' },
    券6665: { face: 6665, min: 6666, name: '抵价券 6666-6665' },
  },

  /* ================= 单笔充值档位（1 元 = 100 元宝；返利按档给） ================= */
  chargeTiers: [
    { need: 600, gives: {}, note: '小红包×3', total: 1 },
    { need: 1200, gives: { 券6665: 1 }, onlyDay: 1, note: '仅 11/7：券6666-6665' },
    { need: 1200, gives: { 券1111: 3 }, fromDay: 2, total: 1, note: '11/8 起：券1111×3 + 福袋' },
    { need: 3000, gives: { 狂欢水晶球: 1, 祈福灯: 3 }, perDay: 1, note: '水晶球×1 + 灯×3' },
    { need: 6000, gives: { 狂欢水晶球: 2, 祈福灯: 6 }, perDay: 1, note: '水晶球×2 + 灯×6' },
    { need: 12800, gives: { 狂欢水晶球: 4, 祈福灯: 7, 券2888: 1 }, perDay: 1,
      alt: { 绑定元宝: 12800 }, note: '双倍箱：水晶球×4 或 绑元×12800' },
    { need: 32800, gives: { 狂欢水晶球: 11, 祈福灯: 7, 券2888: 3 }, total: 2,
      alt: { 绑定元宝: 32800 }, note: '双倍箱：水晶球×11 或 绑元×32800（11/8 重置，可两次）' },
    { need: 64800, gives: { 狂欢水晶球: 22, 祈福灯: 7, 券2888: 6 }, total: 2,
      alt: { 绑定元宝: 64800 }, note: '双倍箱：水晶球×22 或 绑元×64800（11/8 重置，可两次）' },
  ],

  /* ================= 商城礼包（不在系统 buys 里的独立商品） ================= */
  extraPacks: [
    { id: 'up1', name: '狂欢升级礼(1)', price: 3888, gives: { 祈福灯: 3 }, total: 1, chain: 0 },
    { id: 'up2', name: '狂欢升级礼(2)', price: 6888, gives: { 纳贤令: 5, 盒: 10, 狂欢夺宝券: 50 }, total: 1, chain: 1, exclusive: '谋钟会' },
    { id: 'up3', name: '狂欢升级礼(3)', price: 9888, gives: { 纳贤令: 10, 盒: 20, 锦绣: 8 }, total: 1, chain: 2 },
    { id: 'up4', name: '狂欢升级礼(4)', price: 12888, gives: { 祈福灯: 10, 纳贤令: 6, 锦绣: 20 }, total: 1, chain: 3 },
    { id: 'combo', name: '纳贤组合礼包', price: 12888, cur: '通用元宝', total: 2,
      gives: { 祈福灯: 5, 纳贤令: 6, 锦绣: 20, 狂欢夺宝券: 50 }, c1111: true },
    { id: 'free1111', name: '1111免单礼包', price: 1111, perDay: 1,
      gives: { 纳贤令: 2 }, lucky: true, note: '随机给 2 令/2 灯/2 签/4 锦绣/20 券，按令计' },
    { id: 'qifu5', name: '狂欢祈福礼包', price: 7888, perDay: 2,
      gives: { 祈福灯: 10, 锦绣: 5, 狂欢夺宝券: 25 }, c1111: true },
    { id: 'hero5', name: '狂欢武将礼包', price: 7000, perDay: 2,
      gives: { 锦绣: 5, 狂欢夺宝券: 25 }, c1111: true },
    { id: 'skin5', name: '每日皮肤礼包', price: 6888, perDay: 2,
      gives: { 锦绣: 10, 狂欢夺宝券: 50 }, c1111: true },
  ],

  /* ================= 消费热力 / 累计消费（可直接产出道具） ================= */
  consumeRewards: [
    { name: '谋程普', need: 111100, note: '个人热力 1111（每消费100元宝=1热力）' },
  ],

  /* ================= 活动白送的中间道具（登录即得，用于抵扣购买量） =================
     来源：狂欢福利勋章 + 狂欢钜惠勋章 + 七日活跃任务
     only 表示只对指定目标生效（专属纳贤令） */
  freeGains: [
    { cur: '纳贤令', qty: 24, from: '福利勋章8 + 钜惠勋章16（第1/5天各8）' },
    { cur: '纳贤令', qty: 1, from: '七日任务·官阶达将军', only: ['谋钟会'] },
    { cur: '狂欢夺宝券', qty: 290, from: '福利勋章90 + 钜惠勋章160 + 任务40' },
    { cur: '锦绣', qty: 26, from: '钜惠勋章20 + 充值任务6' },
    { cur: '祈福灯', qty: 17, from: '钜惠勋章8（第4天）+ 会员每日免费9' },
    { cur: '凡木签', qty: 16, from: '钜惠勋章16（第2/6天各8）' },
  ],

  /* ================= 皮肤特惠直售 ================= */
  directSales: [
    { name: '树影曳情*环怀瑾', price: 2888, bonus: '锦绣×2', cat: '皮肤' },
    { name: '上庸击懿*孟达', price: 2888, cat: '皮肤' },
    { name: '轻逸优姿*田尚衣', price: 2888, cat: '皮肤' },
    { name: '举杯邀秋*是仪', price: 2888, cat: '皮肤' },
    { name: '曼月符媚*张楚', price: 2888, cat: '皮肤' },
    { name: '巍臣如磐*司马孚', price: 2888, cat: '皮肤' },
    { name: '琼枝惊鹤*诸葛若雪', price: 2888, cat: '皮肤' },
    { name: '潮平江岸*星孙坚', price: 2888, cat: '皮肤' },
    { name: '秋水盈眸*张瑾云', price: 2888, cat: '皮肤' },
    { name: '把酒思遐*董绾', price: 2888, cat: '皮肤' },
    { name: '荷塘月色*乐周妃', price: 2888, cat: '皮肤' },
    { name: '风清悠然*卧龙诸葛', price: 2888, cat: '皮肤' },
    { name: '横眉殿陛*谋邓艾', price: 2888, cat: '皮肤' },
    { name: '威凛沙场*孙桓', price: 2888, cat: '皮肤' },
    { name: '立马啸叱*徐荣', price: 2888, cat: '皮肤' },
    { name: '花语嫣然*孙翎鸾', price: 2888, cat: '皮肤' },
    { name: '寒雪梅香*尹夫人', price: 2888, cat: '皮肤' },
    { name: '劫辎断重*乐綝', price: 2888, cat: '皮肤' },
    { name: '奋身不恤*文钦', price: 2888, cat: '皮肤' },
    { name: '在水一方*柏灵筠', price: 2888, cat: '皮肤' },
  ],
};

/* ---------- 如意签筒（16 个） ---------- */
const JIN_PRIZES = ['谋董承', '谋胡烈', '孟达', '贾充', '赵襄转生丹'];
JIN_PRIZES.forEach((prize, i) => {
  PRESET.systems.push({
    id: 'tube_jin' + (i + 1), kind: 'tube', name: '金瑶签' + (i + 1), unit: '签', pool: 'lian',
    buys: [{ qty: 1, price: 1000, cur: '通用元宝', maxTotal: 500, label: '金瑶签 1000通用' }],
    tube: { N: 100, jackpot: prize, prizes: 1, lian: tubeLian(2000, 1500, 1000, 5, 25, 69) },
    shopRef: 'ruyi',
  });
});
JIN_PRIZES.forEach((prize, i) => {
  PRESET.systems.push({
    id: 'tube_ry' + (i + 1), kind: 'tube', name: '如意签' + (i + 1), unit: '签', pool: 'lian',
    buys: [{ qty: 1, price: 2000, maxTotal: 500, label: '如意签 2000元宝' }],
    tube: { N: 100, jackpot: prize, prizes: 1, lian: tubeLian(3000, 2500, 2000, 5, 25, 69) },
    shopRef: 'ruyi',
  });
});

const FANMU = [
  { prize: '蒯祺', N: 100, lian: tubeLian(2000, 1500, 1000, 5, 25, 69) },
  { prize: '文钦', N: 80, lian: tubeLian(2000, 1500, 1000, 2, 14, 63) },
  { prize: '枭雄金印', N: 20, lian: tubeLian(2000, 1500, 1000, 2, 5, 12) },
  { prize: 'B级将灵福袋', N: 20, lian: tubeLian(2000, 1500, 1000, 2, 5, 12) },
  { prize: '高级转生丹', N: 10, lian: tubeLian(2000, 1500, 1000, 1, 1, 7) },
  { prize: '武将招募令*10', N: 10, lian: tubeLian(2000, 1500, 1000, 1, 1, 7) },
];
FANMU.forEach((t, i) => {
  PRESET.systems.push({
    id: 'tube_fm' + (i + 1), kind: 'tube', name: '凡木签' + (i + 1), unit: '签', pool: 'lian',
    buys: [{ qty: 1, price: 1000, maxTotal: 240, label: '凡木签 1000元宝' }],
    tube: { N: t.N, jackpot: t.prize, prizes: 1, lian: t.lian },
    shopRef: 'ruyi',
  });
});

/* ---------- 猪猪侠联动皮肤（皮肤券来源为活动任务，按免费处理） ---------- */
const PIGGY = [
  '小猪猪侠*刘焉', '小猪猪侠*神典韦', '小猪猪侠*周善', '小猪猪侠*蒲元', '小猪猪侠*孙綝',
  '小猪猪侠*陈珪', '小猪猪侠*谋骆统', '小猪猪侠*周宣', '小猪猪侠*神张飞', '小猪猪侠*谋邓艾',
  '小猪猪侠*神黄忠', '小猪猪侠*星曹仁', '菲菲公主*乐貂蝉', '小猪猪侠*神庞统', '菲菲公主*乐蔡文姬',
  '小猪猪侠*威张辽', '小猪猪侠*威吕布', '小猪猪侠*谋黄盖', '小猪猪侠*许攸', '小猪猪侠*凌统',
];
PIGGY.forEach((name) => {
  PRESET.directSales.push({ name, price: 0, bonus: '猪猪侠联动皮肤券×1', cat: '皮肤', free: true });
});

window.PRESET = PRESET;
