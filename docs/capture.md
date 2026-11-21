# 后台数据自动抓取（油猴脚本 + 本地接收端）

活动一更新，就自动抓取三国杀一将成名后台返回的 JSON，落盘成 `samples/captured/*.json`，并自动 `git add + commit`。这样每期换数据不用再手工复制公告。

## 为什么要两个东西

浏览器的油猴脚本运行在沙箱里，**不能直接写你电脑上的文件，也跑不了 git**。所以拆成两半：

| 组件 | 跑在哪 | 干什么 |
| --- | --- | --- |
| `tools/capture/sgs-capture.user.js` | 浏览器（Tampermonkey） | hook 页面 fetch/XHR，抓到活动 JSON，小窗预览，点发送 |
| `tools/capture/server.js` | 本机 Node | 鉴权 → 内容去重 → 落盘 `samples/captured/` → git commit |

小窗是 https 页面，本地服务是 http，普通 `fetch` 会被浏览器「混合内容」拦截，所以脚本里用的是 `GM_xmlhttpRequest`（已声明 `@connect 127.0.0.1`）。

## 一、启动本地接收端

1. 装好 Node.js（项目本身是零依赖前端，这里只是需要一个 Node 运行时）。
2. 双击 `tools/capture/start-server.bat`，保持窗口开着。
3. 首次运行会自动生成 `tools/capture/config.json`，里面有一串 `token`，形如：

   ```json
   {
     "port": 17890,
     "token": "sgs-xxxxxxxxxxxxxxxx",
     "outputDir": "samples/captured",
     "autoCommit": true,
     "commitPrefix": "data(capture)"
   }
   ```

   `config.json` 已在 `.gitignore` 里（token 是本地密钥，不会提交）。

配置项说明：

- `port`：本地端口，默认 `17890`。被占用就改这个数，同时改油猴脚本里的 `SERVER.url`。
- `token`：鉴权串，油猴脚本必须带对才接收。
- `outputDir`：JSON 落盘目录，默认 `samples/captured/`（已 gitignore，抓取原始数据默认不进版本库）。
- `autoCommit`：`true` 表示每落一个文件就自动 `git add + commit`；设 `false` 则只落盘不提交。
- `commitPrefix`：commit 信息前缀，默认 `data(capture)`。

健康检查：浏览器打开 `http://127.0.0.1:17890/health`，返回 `{"ok":true,...}` 就是通的。

## 二、安装油猴脚本

1. 浏览器装 Tampermonkey（或 Violentmonkey）扩展。
2. 把 `tools/capture/sgs-capture.user.js` 拖进浏览器安装，或复制到扩展的「新建脚本」里。
3. 打开三国杀官网 `https://x.sanguosha.com/` 的任意活动后台页面，右上角会出现「三国杀精测 · 抓取小窗」。
4. 首次发送时小窗会弹框让你填 token——把 `config.json` 里那串贴进去，会记住到浏览器本地。也可以用小窗里的输入框保存，或用菜单命令「重置 token」。

## 三、抓取并发送

- 小窗的绿色圆点表示接收端已连上；红色表示没连上（检查 bat 窗口是否开着）。
- 打开活动后台页面时，脚本会 hook 所有 `fetch` / `XHR`，把命中的 JSON 响应列进小窗（显示方法、大小、URL）。点一条可在下方预览。
- 给这条填「活动名」（用于文件名和 commit 信息；能从 URL 里的 `20261113_xxx` 自动识别时就自动填）。
- 点「发送选中」→ 接收端落盘 + commit，结果显示在小窗日志里（落盘路径、commit 短哈希、或「重复跳过」）。
- 勾「自动发送」后，命中规则的数据抓到即发，不用手点。

**去重**：接收端对 payload 算 SHA-256，内容相同直接返回「重复跳过」，不会重复落盘或刷 commit。`samples/captured/.index.json` 是去重索引。

## 四、改成抓真实接口（关键）

现在 `sgs-capture.user.js` 顶部的 `CAPTURE.urlPatterns` 是**可配置占位**：

```js
var CAPTURE = {
  urlPatterns: ['activity', 'news', 'event', 'config'],  // URL 命中任一关键字即抓取
  minSize: 200,
  autoSend: false,
  maxKeep: 50
};
```

等你提供真实接口地址和一份 JSON 样例后，把 `urlPatterns` 换成真实接口路径关键字（例如 `/api/activity/detail`、`getActivityConfig`）即可精准抓取，其余不用动。留空数组 `[]` 表示抓所有 JSON 响应。

> 如果抓到的不是标准 JSON（比如 JSONP、或包了一层回调），需要在脚本 `ingest()` 里加一段对应的解包逻辑。拿到样例后按需调整。

## 五、抓下来的数据怎么用

`payload` 原样保存在 `samples/captured/*.json` 的 `payload` 字段，`_meta` 记录来源、时间、哈希。当前精测工具的「导入本期 md」吃的是官网公告 markdown，**还不能直接吃这个 JSON**——JSON→本期数据的转换层需要按真实接口结构来写，拿到样例后再补。这一步不影响抓取与 git 提交本身。

## 六、安全说明

- 接收端只监听 `127.0.0.1`，不对外网开放。
- 每条请求要校验 token，错 token 返回 401。
- 请求体上限 50MB，防止误传超大响应。
- `config.json`（含 token）与 `samples/captured/` 都已 gitignore，不会被提交。
