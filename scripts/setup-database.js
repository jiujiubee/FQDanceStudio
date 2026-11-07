'use strict';
/**
 * 一键创建 CloudBase 集合与索引（幂等，可重复运行）。
 * 读取 database/indexes.json，逐个集合 createCollectionIfNotExists，并创建尚不存在的索引。
 *
 * 用法（PowerShell）：
 *   $env:TCB_ENV_ID="你的环境ID"; $env:TCB_SECRET_ID="..."; $env:TCB_SECRET_KEY="..."
 *   npm run db:setup
 * 仅处理部分集合：npm run db:setup -- classBookings
 *
 * 密钥在腾讯云控制台「访问管理 → API 密钥管理」获取，只在本机环境变量中使用，切勿提交到仓库。
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

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database', 'indexes.json'), 'utf8'));
const only = process.argv.slice(2);
const collections = Object.keys(spec).filter((k) => !k.startsWith('_') && (!only.length || only.includes(k)));

function toIndex(ix) {
  return {
    IndexName: ix.name,
    MgoKeySchema: {
      MgoIsUnique: !!ix.unique,
      MgoIndexKeys: Object.entries(ix.keys).map(([Name, dir]) => ({ Name, Direction: String(dir) })),
    },
  };
}

async function main() {
  const { database } = new CloudBase({ envId, secretId, secretKey });
  for (const name of collections) {
    const r = await database.createCollectionIfNotExists(name);
    console.log(`${r.IsCreated ? '已创建' : '已存在'} 集合 ${name}`);
    const missing = [];
    for (const ix of spec[name] || []) {
      const { Exists } = await database.checkIndexExists(name, ix.name);
      if (Exists) console.log(`  已存在 索引 ${ix.name}`);
      else missing.push(ix);
    }
    if (missing.length) {
      await database.updateCollection(name, { CreateIndexes: missing.map(toIndex) });
      missing.forEach((ix) => console.log(`  已创建 索引 ${ix.name}${ix.unique ? '（唯一）' : ''}`));
    }
  }
  console.log('完成');
}

main().catch((e) => {
  console.error('失败：', e.message || e);
  process.exit(1);
});
