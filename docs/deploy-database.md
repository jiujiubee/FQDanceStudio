# 部署指南：数据库集合、索引与云存储权限

## 1. 自动创建集合与索引（含 classBookings）

集合与索引定义在 `database/indexes.json`。脚本 `scripts/setup-database.js` 会读取该文件，
创建缺失的集合和索引；已存在的会跳过，可以放心重复运行。

### 1.1 准备 API 密钥（只需一次）
1. 打开 [腾讯云控制台 → 访问管理 → API 密钥管理](https://console.cloud.tencent.com/cam/capi)，
   用与云开发环境相同的腾讯云账号登录（小程序云开发：在微信开发者工具「云开发」控制台右上角可看到关联账号）。
2. 点击「新建密钥」，记下 `SecretId` 和 `SecretKey`。
3. 环境 ID：微信开发者工具 → 云开发 → 设置 → 环境 ID（形如 `fq-xxxx`）。

> 密钥拥有账号权限，**只在本机终端临时设置，切勿写入代码或提交到 Git**。

### 1.2 运行
在项目根目录的 PowerShell 中：

```powershell
npm install
$env:TCB_ENV_ID="你的环境ID"
$env:TCB_SECRET_ID="你的SecretId"
$env:TCB_SECRET_KEY="你的SecretKey"
npm run db:setup                    # 全部集合与索引
npm run db:setup -- classBookings   # 只处理 classBookings
```

输出示例：
```
已创建 集合 classBookings
  已创建 索引 class_status
  已创建 索引 student_date
完成
```

### 1.3 不想用密钥？手动方式
云函数首次被调用时会自动创建全部集合（`cloudfunctions/api/index.js` 的 `ensureCollections`），
但**索引需要手动建**：云开发控制台 → 数据库 → `classBookings` → 索引管理 → 添加索引：

| 索引名 | 字段 |
|---|---|
| class_status | `classId` 升序，`status` 升序 |
| student_date | `studentId` 升序，`classDate` 降序 |

### 1.4 集合权限
所有集合都通过 `api` 云函数读写，客户端不直接访问。新建的 `classBookings` 请在
数据库 → 集合 → 权限设置 中选「**所有用户不可读写**」（与其他集合保持一致）。

## 2. 让 avatars/ 目录中的图片可公开读取

首页海报、导师头像和照片都上传到云存储 `avatars/<用户ID>/` 目录。学生要能看到这些图片，
需要云存储允许所有用户读取，但只有本人能写入。

1. 微信开发者工具 → 顶部「云开发」→ 打开云开发控制台。
2. 左侧「存储」→ 上方「权限设置」标签。
3. 选择「**自定义安全规则**」，粘贴以下规则后保存：

```json
{
  "read": true,
  "write": "resource.openid == auth.openid"
}
```

含义：任何小程序用户都能**读取**图片；只有上传者本人能**修改/删除**自己的文件。
（如果控制台只提供预设选项，选择「所有用户可读，仅创建者可读写」效果相同。）

> 说明：小程序中显示 `cloud://` 文件 ID 时，微信会按以上读取权限校验，不需要把文件设为公网链接。

## 3. 部署云函数

微信开发者工具中右键 `cloudfunctions/api` → 「上传并部署：云端安装依赖」。
部署后新增的 `booking.*`、`home.get`、`studio.update`、`teacher.*`、`student.setTeacher` 接口即可使用。
