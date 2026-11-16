# FQ Dance Studio 微信小程序

舞蹈工作室内部管理小程序，为店主（OWNER）、教师（TEACHER）和学员（STUDENT）提供课程安排、课程预约及会员课时管理功能。

- **学员**：查看周课表、预约课程、查看会员卡及相关记录。
- **教师**：查看课程安排及学员预约信息。
- **店主**：管理课程排期、学员、教师、会员卡和课时流水。

## 核心业务规则

- **预约成功即生效**：学员成功预约课程后，系统立即扣除对应会员卡课时。
- 课时扣减发生在预约成功时，不等待上课或其他后续操作。
- 签到功能已从产品中移除；当前产品流程不包含学员签到、教师代签或签到更正。
- 取消预约后的课时返还规则、预约截止时间及其他异常场景，应以当前代码实现和产品确认规则为准；本文不对未确认的细节作额外承诺。

[![CI](https://github.com/jiujiubee/FQDanceStudio/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jiujiubee/FQDanceStudio/actions/workflows/ci.yml)

## 技术栈

- 前端：原生微信小程序（WXML / WXSS / TypeScript）
- 后端：腾讯云开发 CloudBase（中国大陆节点），单一云函数 `api` + 云数据库
- 时区：Asia/Shanghai；界面全部为简体中文

## 目录

```
miniprogram/            小程序前端
  app.json / app.ts     全局配置（自定义底部导航按角色显示）
  config.ts             云开发环境 ID、隐私联系方式（部署时修改）
  components/           周历、月历、课程卡、预约相关组件、学员卡、会员卡、搜索、确认弹窗、空状态、骨架屏
  pages/schedule        学员：周课表与课程预约
  pages/history         学员：历史记录
  pages/mine            我的：会员卡、资料、隐私
  pages/workbench       教师/店主：工作台
  pages/teacher/class   教师：课程相关管理
  pages/admin/*         排课、名单、学员、会员、流水、员工、设置、日志
cloudfunctions/api/     云函数（路由、权限、业务服务、测试）
database/               集合结构、索引、安全规则
tests/                  前端单元测试
tools/icons.js          生成本地 SVG 图标
docs/DEPLOYMENT.md      部署与上线指南
.github/workflows/      GitHub Actions CI
```

## 本地开发

```bash
npm ci
npm run typecheck
npm test          # 后端 + 前端单元测试
```

用微信开发者工具「导入项目」选择本目录；按 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 完成云开发配置。

## Continuous Integration

GitHub Actions runs the CI workflow defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### Triggers

- Pull requests targeting `main`
- Pushes to `main`
- Manual runs through the Actions tab (`workflow_dispatch`)

### Pipeline checks

The workflow runs three independent jobs in parallel on GitHub-hosted Ubuntu runners using Node.js 22:

| Job | Command | Purpose |
| --- | --- | --- |
| TypeScript typecheck | `npm run typecheck` | Fails on TypeScript compilation/type errors |
| Backend regression tests | `npm run test:backend` | Runs Node.js tests under `cloudfunctions/api/test/` |
| Frontend regression tests | `npm run test:frontend` | Runs Node.js tests under `tests/` |

Each job installs locked dependencies with `npm ci`. Test jobs upload their console logs as workflow artifacts, including when tests fail. A non-zero command exit code fails its job. The workflow uses read-only repository contents permissions, job timeouts, npm caching, and concurrency cancellation for superseded runs.

### Run CI locally

From the repository root:

```bash
npm ci
npm run typecheck
npm run test:backend
npm run test:frontend
npm test
```

### Inspect workflow results

1. Open the repository's **Actions** tab.
2. Select **CI** and open a run associated with a pull request or push.
3. Inspect the TypeScript, backend, and frontend jobs and their logs.
4. Download `backend-test-log` or `frontend-test-log` from the run's Artifacts section when available.

### Pull request quality gate

To require CI before merging, configure a branch protection rule or repository ruleset for `main` in GitHub settings. Enable **Require a pull request before merging** and **Require status checks to pass before merging**, then select the exact job checks reported by a successful workflow run:

- `TypeScript typecheck`
- `Backend regression tests`
- `Frontend regression tests`

GitHub may display the check names with their workflow context. Select the exact checks shown in the repository UI rather than relying on these labels alone.

### Deployment boundary

This workflow is CI only. It does not deploy CloudBase functions, modify databases, or connect to any CloudBase environment. Production deployment remains a separate, deliberate release operation. A future staging CD workflow should only be added after an isolated non-production CloudBase environment and its credentials have been provisioned as protected GitHub Environment secrets.
