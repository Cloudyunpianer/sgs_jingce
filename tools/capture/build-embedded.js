#!/usr/bin/env node
/**
 * 把精测程序打包成一个自包含 HTML —— tools/capture/embedded.html
 * 供油猴脚本用 iframe srcdoc 内嵌（在官网页面里跑完整精测程序）。
 * 再把 embedded.html 内联进油猴模板，生成最终安装版 sgs-jingce.user.js。
 *
 * 用法：node tools/capture/build-embedded.js
 * 每次改了 index.html / style.css / js/*.js 或油猴模板，都要重跑一次。
 * 零依赖，仅用 Node 内置模块。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'embedded.html');
const TEMPLATE = path.join(__dirname, 'sgs-jingce.template.js');
const USERSCRIPT = path.join(__dirname, 'sgs-jingce.user.js');

const JS_FILES = [
  'js/currency.js', 'js/data.js', 'js/engine.js', 'js/plan.js',
  'js/classify.js', 'js/rates.js', 'js/mincost.js', 'js/parser.js', 'js/ui.js'
];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// 内联 <script> 内容里若出现 </script> 会提前闭合标签，转义掉
function jsSafe(src) { return src.replace(/<\/script>/gi, '<\\/script>'); }

let html = read('index.html');
const css = read('style.css');

// 去掉外链 style，改内联
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/i, '<style>\n' + css + '\n</style>');

// 去掉所有 <script src=...></script>，统一在末尾内联
html = html.replace(/<script\s+src=["'][^"']+["']\s*><\/script>/gi, '');

const scripts = JS_FILES.map(function (f) {
  return '<!-- ' + f + ' -->\n<script>\n' + jsSafe(read(f)) + '\n</script>';
}).join('\n');

html = html.replace('</body>', scripts + '\n</body>');

fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成 ' + path.relative(ROOT, OUT) + ' (' + (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB)');
console.log('内联 JS: ' + JS_FILES.length + ' 个, CSS: 1 个');

// 把 embedded.html 内联进油猴模板，生成最终安装版。
// 用 JSON.stringify 得到安全转义的 JS 字符串字面量（换行/引号/反斜杠都处理）。
if (fs.existsSync(TEMPLATE)) {
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const literal = JSON.stringify(html);
  if (tpl.indexOf('__EMBEDDED_HTML__') < 0) {
    console.error('错误：模板里找不到 __EMBEDDED_HTML__ 占位符');
    process.exit(1);
  }
  const userscript = tpl.replace('__EMBEDDED_HTML__', literal);
  fs.writeFileSync(USERSCRIPT, userscript, 'utf8');
  console.log('已生成 ' + path.relative(ROOT, USERSCRIPT) + ' (' + (Buffer.byteLength(userscript, 'utf8') / 1024).toFixed(1) + ' KB)');
} else {
  console.log('（未找到油猴模板，跳过 userscript 生成）');
}
