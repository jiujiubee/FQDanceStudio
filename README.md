# FQ Dance Studio 微信小程序

舞蹈工作室内部管理小程序：学员查看周课表并签到、教师查看与更正出勤、管理员排课与管理会员课时。
**不包含**预约、候补、占座等功能。

- 前端：原生微信小程序（WXML / WXSS / TypeScript）
- 后端：腾讯云开发 CloudBase（中国大陆节点），单一云函数 `api` + 云数据库
- 时区：Asia/Shanghai；界面全部为简体中文

## 目录

```
miniprogram/            小程序前端
  app.json / app.ts     全局配置（自定义底部导航按角色显示）
  config.ts             云开发环境 ID、隐私联系方式（部署时修改）
  components/           周历、月历、课程卡、签到列表、学员卡、会员卡、搜索、确认弹窗、空状态、骨架屏
  pages/schedule        学员：周课表 + 签到
  pages/history         学员：签到记录
  pages/mine            我的：会员卡、资料、隐私
  pages/workbench       教师/管理员：工作台
  pages/teacher/class   课程签到详情、代签与更正
  pages/admin/*         排课、名单、学员、会员、流水、员工、设置、日志
cloudfunctions/api/     云函数（路由、权限、业务服务、测试）
database/               集合结构、索引、安全规则
tests/                  前端单元测试
tools/icons.js          生成本地 SVG 图标
docs/DEPLOYMENT.md      部署与上线指南
```

## 本地开发

```bash
npm install
npm run typecheck
npm test          # 后端 + 前端单元测试
```

用微信开发者工具「导入项目」选择本目录；按 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 完成云开发配置。
