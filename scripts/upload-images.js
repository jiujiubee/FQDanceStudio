'use strict';
/**
 * 将 miniprogram/assets/images 下的全部图片（含子目录）上传到 CloudBase 云存储 assets/images/，保留目录结构与文件名。
 * 上传后逐个核对云端文件大小，并输出 fileID / 临时访问 URL 清单到 docs/cloud-images.json。
 *
 * 用法（PowerShell，凭证只放在环境变量中，不要写入代码或提交到仓库）：
 *   $env:TCB_ENV_ID="你的环境ID"; $env:TCB_SECRET_ID="..."; $env:TCB_SECRET_KEY="..."
 *   npm run images:upload
 */
const fs = require('fs');
const path = require('path');

let CloudBase;
try {
  CloudBase = require('@cloudbase/manager-node');
} catch (e) {
  console.error('缺少依赖，请先运行：npm install');
  process.exit(1);
}

const { TCB_ENV_ID: envId, TCB_SECRET_ID: secretId, TCB_SECRET_KEY: secretKey } = process.env;
if (!envId || !secretId || !secretKey) {
  console.error('请先设置环境变量 TCB_ENV_ID、TCB_SECRET_ID、TCB_SECRET_KEY');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..', 'miniprogram', 'assets', 'images');
const CLOUD_DIR = 'assets/images';
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const LIMIT = 200 * 1024;

function walk(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p));
    else if (IMAGE_EXT.test(d.name)) out.push(p);
  }
  return out;
}

async function main() {
  const { storage } = new CloudBase({ envId, secretId, secretKey });
  const files = walk(ROOT).map((p) => {
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    return { rel, localPath: p, cloudPath: `${CLOUD_DIR}/${rel}`, ext: path.extname(p).slice(1).toLowerCase(), size: fs.statSync(p).size };
  });
  const results = [];
  for (const f of files) {
    const r = { file: f.rel, format: f.ext, size: f.size, overLimit: f.size > LIMIT, cloudPath: f.cloudPath, fileID: '', url: '', ok: false, error: '' };
    try {
      await storage.uploadFile({ localPath: f.localPath, cloudPath: f.cloudPath });
      // 不以命令成功为准：读取云端文件信息并核对大小
      const info = await storage.getFileInfo(f.cloudPath);
      const remoteSize = Number(info && (info.Size || info.size));
      if (remoteSize !== f.size) throw new Error(`云端大小 ${remoteSize} 与本地 ${f.size} 不一致`);
      const [t] = await storage.getTemporaryUrl([{ cloudPath: f.cloudPath, maxAge: 3600 }]);
      r.fileID = (t && t.fileId) || '';
      r.url = (t && t.url) || '';
      if (!r.fileID || !r.url) throw new Error('未获取到 fileID 或访问 URL');
      r.ok = true;
    } catch (e) {
      r.error = (e && e.message) || String(e);
    }
    results.push(r);
    console.log(`${r.ok ? '成功' : '失败'}  ${r.file}  ${r.format}  ${r.size}B${r.error ? '  ' + r.error : ''}`);
  }
  const ok = results.filter((r) => r.ok).length;
  const summary = { envId, total: results.length, success: ok, failed: results.length - ok, generatedAt: new Date().toISOString(), files: results };
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'cloud-images.json'), JSON.stringify(summary, null, 2));
  console.log(`\n共 ${summary.total} 个，成功 ${summary.success}，失败 ${summary.failed}；清单已写入 docs/cloud-images.json（临时 URL 1 小时有效，小程序内请使用 fileID）`);
  if (summary.failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
