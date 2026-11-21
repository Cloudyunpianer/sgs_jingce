# 油猴内嵌精测台（抓包 + 导入）

一个 Tampermonkey（油猴）脚本，把**完整精测程序**嵌进三国杀官网页面里运行：hook 后台请求抓到活动 JSON，转成公告文本，一键导进内嵌的精测程序，当场出结果。

打开官网页面**不会自动弹出**精测台，只显示一个右下角小浮窗，点它才全屏打开；进去后点「⚡ 一键导入本期活动」即可傻瓜式导入，不用选抓包条目。

**你要版本管理的是脚本文件本身**（`tools/capture/` 下的源码和产物都随仓库提交）。脚本不写磁盘、不连本地服务、不碰 git。

## 一、文件与构建

| 文件 | 作用 |
| --- | --- |
| `sgs-jingce.template.js` | 油猴脚本**源码模板**（改这里） |
| `embedded.html` | 精测程序的单文件版（HTML+CSS+9个JS 全内联），构建产物 |
| `sgs-jingce.user.js` | **最终安装版**（把 embedded.html 内联进模板，383KB），构建产物 |
| `build-embedded.js` | 构建脚本，一条命令重新生成上面两个产物 |

改了 `index.html` / `style.css` / `js/*.js` 或油猴模板后，重跑：

```bash
node tools/capture/build-embedded.js
```

它会：① 把精测程序打包成 `embedded.html`；② 把该文件内联进模板生成 `sgs-jingce.user.js`。

> 为什么要把整个精测程序内联进油猴脚本：油猴运行在 `https://x.sanguosha.com`，浏览器不允许它 fetch 本地 `file://` 文件；而精测程序是纯前端静态页。内联成自包含字符串、用 iframe `srcdoc` 承载，是让它"在油猴里跑"又不依赖本地服务的唯一自包含方式。

## 二、安装与使用

1. 浏览器装 Tampermonkey / Violentmonkey。
2. 把 `tools/capture/sgs-jingce.user.js` 拖进浏览器安装。
3. 打开三国杀官网活动后台页面，右下角出现一个「⚡ 精测」小浮窗（**不自动弹出**，不打扰浏览）。
4. 点浮窗 → 全屏打开「内嵌精测台」：
   - **顶部工具条**：醒目的「⚡ 一键导入本期活动」按钮 + 状态提示。
   - **下方主体**：完整精测程序（选将、倍率表、每日方案等，功能与本地打开一致，全屏铺满）。
   - **抓包详情**（默认折叠）：抓包列表 + 公告文本框 + 导入/复制/下载按钮，需要时点顶栏「▾ 抓包详情」展开。
5. 傻瓜式用法：进页面后 hook 已在后台跑 → 点「⚡ 一键导入本期活动」→ 脚本自动从抓包里挑最像本期公告的一条转成文本导进去 → 精测程序自动 `PARSER.parse` + `apply`，当场刷新出本期结果。选将 / 计算仍在精测界面里手动做。
   - 若想自己控制：展开「抓包详情」，点某条抓包或直接在文本框粘贴官网公告 md，再点「导入下方文本」。
6. 关闭面板后浮窗回到右下角；油猴菜单命令「打开内嵌精测台」也可随时唤回。

## 三、改成抓真实接口（拿到样例后要做的）

两处可配置，都在模板 `sgs-jingce.template.js` 顶部：

```js
var CAPTURE = {
  urlPatterns: ['activity', 'news', 'event', 'config'],  // URL 命中任一关键字即抓取
  minSize: 200,   // 小于该字节数的响应忽略（默认 200，别把真实小响应过滤掉）
  maxKeep: 50
};

var TRANSFORM = null;  // JSON → 公告文本钩子
```

- **接口地址**：把 `urlPatterns` 换成真实接口路径关键字，例如 `/api/activity/detail`、`getActivityConfig`。留空数组 `[]` 抓所有 JSON。
- **JSON → 公告文本**：默认走通用展平 `jsonToText()`（找 `content/markdown/md/text/...` 字段，或整对象转文本）。拿到真实 JSON 样例后，把 `TRANSFORM` 写成精准转换，例如：

  ```js
  var TRANSFORM = function (payload, url) {
    return payload.data.activityNotice; // 按真实结构调整
  };
  ```

  返回的是**公告 markdown 文本**，交给精测程序的 `PARSER.parse`。若接口直接返回的就是公告 md 字符串，可留默认。

改完模板后记得重跑 `node tools/capture/build-embedded.js` 重新生成安装版。

## 四、验证过的链路

- `embedded.html` 直接打开：133 个目标卡片正常渲染；`__SGS_IMPORT__(公告文本)` 导入真实小雪样本，充值档与活动信息正确更新，零 JS 错误。
- 油猴脚本注入到模拟后台页：进页面只显示浮窗（面板不自动打开）、点浮窗后全屏面板 + iframe 渲染、hook 生效、抓包 → 清空文本框后点「一键导入本期活动」自动挑抓包 → postMessage → 内嵌精测返回「已导入并刷新」、活动信息从旧期更新为新期、关闭面板浮窗重现，全程零 JS 错误。
- 项目回归 304 项全绿。

## 五、说明

- 精测程序在 iframe（`sandbox="allow-scripts allow-same-origin"`）里跑，与官网页面的 DOM/CSS 隔离，互不干扰。
- 数据注入走 `postMessage`，消息带 `__sgsCapture:1` 标记，精测程序校验后才处理，避免误收页面其它消息。
- 抓下来的临时数据不建议提交；要留样例放到 `samples/` 并确认无账号等敏感信息。
