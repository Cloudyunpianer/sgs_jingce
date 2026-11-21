#!/usr/bin/env node
/**
 * 三国杀精测 · 本地抓包接收端
 * ------------------------------------------------------------------
 * 油猴脚本在浏览器沙箱里抓到后台 JSON 后，POST 到本服务；
 * 本服务负责：token 鉴权 -> 内容去重 -> 落盘 samples/captured/*.json
 *             -> git add + commit -> 把结果回传给小窗面板。
 *
 * 零依赖，仅用 Node 内置模块。启动：node tools/capture/server.js
 * 配置：tools/capture/config.json（首次运行自动生成）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// 项目根目录（本文件在 <root>/tools/capture/ 下）
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const VERSION = '1.0.0';

function log(...args) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${t}]`, ...args);
}

function defaultConfig() {
  return {
    port: 17890,
    token: 'sgs-' + crypto.randomBytes(8).toString('hex'),
    outputDir: 'samples/captured',
    autoCommit: true,
    commitPrefix: 'data(capture)'
  };
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return Object.assign(defaultConfig(), cfg);
    } catch (e) {
      log('[!] config.json 解析失败，使用默认配置：' + e.message);
      return defaultConfig();
    }
  }
  const cfg = defaultConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  log('[i] 已生成 config.json，token = ' + cfg.token);
  log('[i] 请把这个 token 填进油猴脚本的 SERVER.token');
  return cfg;
}

const CFG = loadConfig();
const OUT_DIR = path.resolve(ROOT, CFG.outputDir);
const INDEX_PATH = path.join(OUT_DIR, '.index.json');

function ensureDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function loadIndex() {
  ensureDir();
  if (!fs.existsSync(INDEX_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); }
  catch (e) { log('[!] .index.json 损坏，重建索引：' + e.message); return {}; }
}

function saveIndex(idx) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2), 'utf8');
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function safeName(s) {
  return String(s || 'activity')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '') || 'activity';
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function isGitRepo() {
  try { git('rev-parse', '--is-inside-work-tree'); return true; }
  catch (e) { return false; }
}

function commitFiles(files, msg) {
  if (!CFG.autoCommit) return { committed: false, reason: 'autoCommit=false' };
  if (!isGitRepo()) return { committed: false, reason: '非 git 仓库' };
  try {
    git('add', '--', ...files);
    // 若暂存区无变化，git commit 会报错；先探测
    let staged;
    try { staged = git('diff', '--cached', '--name-only'); }
    catch (e) { staged = ''; }
    if (!staged) return { committed: false, reason: '无内容变化' };
    git('commit', '-m', msg);
    const hash = git('rev-parse', '--short', 'HEAD');
    return { committed: true, hash };
  } catch (e) {
    return { committed: false, reason: 'git 失败：' + (e.stderr || e.message || '').trim().slice(0, 300) };
  }
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 50 * 1024 * 1024) { // 50MB 上限，防止误传超大响应
        reject(new Error('请求体超过 50MB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('请求体不是合法 JSON：' + e.message)); }
    });
    req.on('error', reject);
  });
}

function handleIngest(body) {
  if (!body || body.token !== CFG.token) {
    return { code: 401, body: { ok: false, error: 'token 校验失败' } };
  }
  if (body.payload === undefined || body.payload === null) {
    return { code: 400, body: { ok: false, error: '缺少 payload' } };
  }

  const sum = sha256(body.payload);
  const idx = loadIndex();
  if (idx[sum]) {
    log('[-] 重复内容，跳过：' + idx[sum].file);
    return {
      code: 200,
      body: { ok: true, duplicate: true, file: idx[sum].file, sha: sum.slice(0, 12), committed: false }
    };
  }

  ensureDir();
  const now = new Date(body.capturedAt || Date.now());
  const title = safeName(body.title || body.activity || 'activity');
  const fname = `${title}_${stamp(now)}_${sum.slice(0, 8)}.json`;
  const fpath = path.join(OUT_DIR, fname);

  const envelope = {
    _meta: {
      source: body.source || '',
      activity: body.activity || '',
      title: body.title || '',
      capturedAt: now.toISOString(),
      receivedAt: new Date().toISOString(),
      sha256: sum,
      schema: 'sgs-capture/v1'
    },
    payload: body.payload
  };
  fs.writeFileSync(fpath, JSON.stringify(envelope, null, 2), 'utf8');
  log('[+] 落盘：' + path.relative(ROOT, fpath));

  idx[sum] = { file: path.relative(ROOT, fpath).replace(/\\/g, '/'), at: envelope._meta.receivedAt };
  saveIndex(idx);

  const rel = path.relative(ROOT, fpath).replace(/\\/g, '/');
  const msg = `${CFG.commitPrefix}: ${body.title || body.activity || '抓包数据'} ${stamp(now)}`;
  const cm = commitFiles([rel, path.relative(ROOT, INDEX_PATH).replace(/\\/g, '/')], msg);
  if (cm.committed) log('[✓] git commit ' + cm.hash + ' — ' + msg);
  else log('[i] 未提交：' + cm.reason);

  return {
    code: 200,
    body: {
      ok: true,
      duplicate: false,
      file: rel,
      sha: sum.slice(0, 12),
      committed: cm.committed,
      commitHash: cm.hash || null,
      commitReason: cm.reason || null
    }
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, 204, {}); return; }

  const url = new URL(req.url, `http://127.0.0.1:${CFG.port}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, version: VERSION, autoCommit: CFG.autoCommit, repo: isGitRepo() });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/ingest') {
    try {
      const body = await readBody(req);
      const r = handleIngest(body);
      json(res, r.code, r.body);
    } catch (e) {
      log('[!] ingest 失败：' + e.message);
      json(res, 400, { ok: false, error: e.message });
    }
    return;
  }
  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(CFG.port, '127.0.0.1', () => {
  console.log('');
  log('三国杀精测 · 抓包接收端已启动 v' + VERSION);
  log('监听   http://127.0.0.1:' + CFG.port);
  log('token  ' + CFG.token);
  log('输出   ' + path.relative(ROOT, OUT_DIR));
  log('自动提交 ' + (CFG.autoCommit ? '开' : '关'));
  log('按 Ctrl+C 停止');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log('[x] 端口 ' + CFG.port + ' 已被占用。改 config.json 的 port 后重试。');
  } else {
    log('[x] 服务启动失败：' + e.message);
  }
  process.exit(1);
});
