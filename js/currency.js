/* ============================================================
   品类归一：把每期公告里的专名（寒露夺宝券 / 重阳夺宝券 / …）
   收敛成引擎认识的品类 key，并解析抵价券面额。
   ------------------------------------------------------------
   内部 key 沿用 data.js 既有写法（狂欢夺宝券 / 狂欢水晶球），
   这样 engine / rates / plan 的取值逻辑不用改；展示层用
   CUR.label() 还原成「本期叫法」。
   ============================================================ */
window.CUR = (function () {
  /* 品类 key —— 与 data.js 里的字符串保持一致 */
  const K = {
    duobao: '狂欢夺宝券',
    crystal: '狂欢水晶球',
    lamp: '祈福灯',
    ling: '纳贤令',
    satin: '锦绣',
    jade: '传世宝玉',
    shard: '宝玉碎片',
    box: '盒',
    sign: '签',          // 金瑶签/如意签/凡木签 统称
    coin: '幸运币',
  };

  /* 品类 → 引擎 KEYS 里用的名字 */
  const CANON_LIST = [K.duobao, K.crystal, K.lamp, K.ling, K.satin, K.box, K.jade, K.sign, K.coin];

  /* 专名识别：返回品类 key（引擎用），识别不出返回原名 */
  function canon(name) {
    const s = String(name || '').trim();
    if (!s) return s;
    if (/夺宝券$/.test(s)) return K.duobao;
    if (/水晶球$/.test(s)) return K.crystal;
    if (/^祈福灯$/.test(s)) return K.lamp;
    if (/^纳贤令$/.test(s)) return K.ling;
    if (/^锦绣$/.test(s)) return K.satin;
    if (/^(金瑶签|如意签|凡木签|银两签)$/.test(s)) return K.sign;
    if (/^幸运币$/.test(s)) return K.coin;
    if (/^传世宝玉$/.test(s)) return K.jade;
    if (/^宝玉碎片$/.test(s)) return K.shard;
    return s;
  }

  /* 是否算「通用中间道具」（用于抵扣购买量的品类） */
  function isCurrency(name) {
    return CANON_LIST.indexOf(canon(name)) >= 0 && canon(name) !== K.sign && canon(name) !== K.coin;
  }

  /* 抵价券解析：「寒露抵价券（3000-2500）」→ {face:2500, min:3000, key:'券2500'} */
  function coupon(name) {
    const m = /[（(]\s*(\d+)\s*-\s*(\d+)\s*[）)]/.exec(String(name || ''));
    if (!m) return null;
    const min = +m[1], face = +m[2];
    if (!min || !face || face > min) return null;
    return { min, face, key: '券' + face, name: `抵价券 ${min}-${face}` };
  }
  function isCoupon(name) { return /抵价券/.test(String(name || '')) && !!coupon(name); }

  /* 专属纳贤令：谋杨奉纳贤令 / 特惠精选纳贤令 —— 只对指定目标生效 */
  function exclusiveLing(name) {
    const m = /^(.+?)纳贤令$/.exec(String(name || '').trim());
    if (!m) return null;
    const who = m[1];
    if (/特惠精选/.test(who)) return '特惠精选';
    return who;
  }

  /* 本期叫法（展示用）：由 parser 写入 P.curLabel */
  let label = {};
  function setLabels(map) { label = map || {}; }
  function show(key) { return label[key] || key; }

  return { K, CANON_LIST, canon, isCurrency, coupon, isCoupon, exclusiveLing, setLabels, show };
})();
