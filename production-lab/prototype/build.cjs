const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const outdir = path.resolve(__dirname, 'dist');
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'main.tsx')], bundle: true, outdir, entryNames: 'client', platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, loader: { '.module.css': 'local-css' }, minify: true });
fs.writeFileSync(path.join(outdir, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FG Studio · 第六板块试用</title><link rel="stylesheet" href="/client.css"><style>html,body{margin:0;padding:0}button,input,textarea{font:inherit}</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>');
console.log('Preview built:', outdir);
