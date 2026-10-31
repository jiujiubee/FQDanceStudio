# 部署与上线指南（中国大陆）

## 1. 准备

1. 在 [微信公众平台](https://mp.weixin.qq.com) 注册小程序（建议企业/个体工商户主体），获取 **AppID**。
2. 完成 **小程序备案**（ICP 备案，2023 年 9 月起为上架必要条件）：公众平台 → 设置 → 基本设置 → 备案。
3. 服务类目建议选择「教育 > 教育信息服务」或「生活服务 > 休闲娱乐」，按平台要求补充资质。
4. 安装最新版「微信开发者工具」与 Node.js ≥ 16。

## 2. 导入项目

1. 修改 `project.config.json` 中的 `appid` 为你的 AppID。
2. 开发者工具 → 导入 → 选择本目录。
3. 根目录执行 `npm install`（仅用于本地类型检查与测试）。小程序前端**没有 npm 运行时依赖，不要点「构建 npm」**；若误点会提示 “NPM packages not found”，可忽略。

## 3. 开通云开发

1. 开发者工具 → 云开发 → 开通，地域选择 **上海** 或 **广州**（数据不出境）。
2. 复制环境 ID，填入 `miniprogram/config.ts` 的 `CLOUD_ENV_ID`。
3. 云函数无需 AppSecret：CloudBase 在服务端自动完成 `code → OpenID` 换取并通过 `getWXContext()` 注入身份。**切勿**在前端或仓库中保存 AppSecret。

## 4. 数据库

**无需手动建表。** 云函数首次被调用时会自动创建以下集合（已存在则跳过）：

`users, teachers, students, classes, classSeries, attendance, attendanceRosters, memberships, transactions, rolePermissions, auditLogs, systemSettings, staffInvites`

- **权限**：每个集合 → 数据权限 → 选择「自定义安全规则」，编辑框中**只粘贴**以下内容（即 `database/security-rules.json` 的全部内容，不要附加注释或其它字段，否则报 `rule invalid`）：

  ```json
  { "read": false, "write": false }
  ```

  也可直接选择预设「所有用户不可读写」（效果相同）。所有访问只能经过云函数（云函数使用管理员权限，不受此规则限制），客户端无法直接读写。
- **索引**：按 `database/indexes.json` 创建。
- 字段说明见 `database/schema.md`。

## 5. 云存储

头像上传至 `avatars/{userId}/`。存储权限设置为「仅创建者可读写」或使用自定义规则，后端会校验文件路径属于本人。

## 6. 部署云函数

1. 右键 `cloudfunctions` 文件夹 → 「当前环境」→ 选择你的云环境（否则会报 “请在编辑器云函数根目录选择一个云环境”）。
2. 右键 `cloudfunctions/api` → 「上传并部署：云端安装依赖」。
3. 编译运行小程序，首次调用后在 云开发 → 数据库 中确认 13 个集合已生成。

> 若控制台手动建表报 `tcbCreateTable ... aclTag or envId is empty`：这是开发者工具控制台未关联环境导致的，使用上面的自动建表即可；或改用浏览器登录 [腾讯云开发控制台](https://tcb.cloud.tencent.com)（微信公众号登录 → 选择该小程序）创建集合。

部署后：
2. 云函数配置 → 环境变量：
   - `APP_ENV`：生产环境设为 `production`（或不设置）；仅开发环境设为 `development`（见第 11 节）。
   - 不再使用 `OWNER_BOOTSTRAP_CODE`，如已配置请删除。
3. 超时时间建议 20 秒，内存 256MB。
4. 定时触发器（每日维护，标记过期会员卡）：`cloudfunctions/api/config.json` 已配置，部署后在控制台确认触发器已启用。

## 7. 初始化（店主一次性开通，仅服务端）

1. 店主用本人微信打开小程序 → 注册页选择「员工注册」（或「学员注册」），填写姓名与微信号并同意隐私政策。
2. 云开发控制台 → 云函数 `api` → **云端测试**，参数：
   ```json
   { "action": "system.bootstrapOwner", "data": { "keyword": "店主姓名或微信号" } }
   ```
   匹配到多个用户时会返回候选列表，改用 `{ "userId": "u_xxx" }` 重新执行。
3. 成功后写入永久锁 `systemSettings/bootstrap-lock`，此操作永久失效。该接口只接受控制台/服务端调用（无 OpenID），小程序客户端调用一律拒绝；不依赖任何口令。
4. 员工在小程序中「员工注册」后，店主/管理员在 工作台 → 员工管理 搜索姓名/微信号并授予角色（无需邀请码）。店主可给自己授予「教师」以亲自授课；一个账户可同时拥有店主/管理员/教师/学员多个角色。
5. 系统设置中确认工作室名称、签到时间窗口、会员规则。
6. 修改 `miniprogram/config.ts` 中的 `PRIVACY_CONTACT` 为真实联系方式。

### 旧版本数据迁移
已使用单角色/邀请码版本的环境，部署新云函数后在云端测试执行一次（可重复执行）：
```json
{ "action": "system.migrate", "data": {} }
```
将 `users.role` 转为 `users.roles` 数组、作废所有未使用的邀请码，并在已有店主时写入初始化锁。

## 8. 隐私合规（提审前必做）

1. 公众平台 → 设置 → 服务内容声明 → **用户隐私保护指引**：声明收集「微信昵称/头像（选填）、手机号（选填，用户手动填写）、微信号（选填）」，用途为「学员身份识别与课程签到管理」。
2. 小程序内隐私政策页面：`pages/privacy`，可导出个人信息与注销账户（满足《个人信息保护法》第 44–47 条）。
3. `app.json` 已开启 `__usePrivacyCheck__`。
4. 未满 14 周岁学员应由监护人注册。

## 9. 提审与发布

1. `npm run typecheck && npm test` 全部通过。
2. 开发者工具 → 上传，填写版本号。
3. 公众平台 → 版本管理 → 提交审核。审核说明中提供体验账号说明（可先生成一个学员绑定码供审核人员使用）。
4. 审核通过后发布。

## 10. 上线检查清单

- [ ] `appid`、`CLOUD_ENV_ID`、`PRIVACY_CONTACT` 已替换
- [ ] 全部集合安全规则为拒绝客户端读写
- [ ] 索引已创建
- [ ] 定时触发器已启用
- [ ] 店主已通过控制台 `system.bootstrapOwner` 初始化；`OWNER_BOOTSTRAP_CODE` 环境变量已删除
- [ ] 生产环境 `APP_ENV` 不是 `development`；`miniprogram/config.ts` 中 `DEV_MODE = false`
- [ ] 备案、隐私保护指引已通过
- [ ] 签到时间窗口、会员规则已按工作室实际情况配置

## 11. 内部测试（开发环境 / 生产环境分离）

1. 在云开发中另建一个**开发环境**（与生产环境数据完全隔离），部署同一份 `api` 云函数，并设置环境变量 `APP_ENV=development`。生产环境不设置或设为 `production`。
2. 本地测试时将 `miniprogram/config.ts` 的 `CLOUD_ENV_ID` 指向开发环境，并设 `DEV_MODE = true`；上传正式版本前改回生产环境 ID 与 `DEV_MODE = false`。
3. 「我的 → 开发测试模式」：
   - 生成测试数据：测试店主（店主+教师）、管理员、两名教师、两名学员（含次卡）、未注册访客，及 7 天示例课程；
   - 切换身份：一台手机即可依次以不同角色操作，模拟身份使用独立虚拟 OpenID（`devsim:*`），不影响真实微信账户；
   - 重置开发环境数据：清空开发环境数据库并重新生成。
4. 安全：身份模拟（`devAs`）、`dev.*` 接口与 `devsim:` OpenID 在 `APP_ENV` 不是 `development` 时一律被后端拒绝；请求中任何试图覆盖身份/角色的字段（openid、userId、role、roles 等）始终被拒绝。所有测试数据变更写入审计日志。
5. 自动化测试：`npm test` 覆盖多角色、授权边界、初始化与生产环境拒绝模拟等场景。

