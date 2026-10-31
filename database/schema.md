# 数据库结构（CloudBase 云数据库）

所有时间戳字段（`*At`）统一存储为 **UTC 毫秒时间戳（Number）**，展示时统一换算为 **Asia/Shanghai (UTC+8)**。
业务日期字段（`date`、`startDate`、`expireDate` 等）统一存储为上海时区的 `YYYY-MM-DD` 字符串，时间字段为 `HH:mm`。
所有业务关联使用内部 `_id`，`openid` 只出现在 `users` 集合中，作为认证身份。

**客户端对所有集合均无直接读写权限**（见 `security-rules.json`），所有读写由云函数 `api` 完成，云函数内统一执行鉴权。

## users — 登录账户
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | `u_` + sha256(openid) 前 24 位（确定性，防止并发重复建号） |
| openid | string | 微信 OpenID（唯一索引） |
| roles | string[] | 角色数组，可同时拥有多个：`owner` / `admin` / `teacher` / `student`；权限为各角色权限并集 |
| role | string | 兼容字段：`roles` 中级别最高的角色（无角色时为空） |
| wxid | string? | 微信号（选填，用于员工搜索授权） |
| devSimulated | boolean? | 仅开发环境测试账户（OpenID 以 `devsim:` 开头） |
| status | string | `active` / `suspended` / `deleted` |
| studentId | string? | 关联 students._id |
| teacherId | string? | 关联 teachers._id |
| name | string | 显示名称 |
| privacyAgreedVersion | string? | 已同意的隐私政策版本 |
| privacyAgreedAt | number? | 同意时间 |
| createdAt / updatedAt / lastLoginAt | number | |

## teachers — 教师档案
`_id ("tch_" + userId，确定性：每个用户最多一份教师档案), userId, name, avatar, bio, status(active/revoked), extraPermissions: string[], createdAt, updatedAt`

撤销教师角色仅将 status 置为 `revoked`，历史课程/签到记录保留；重新授予时复用同一档案。

## students — 学员档案
`_id, userId?, studentNo, name, avatar, phone, wxid, gender, birthday, emergencyContact, remark, groups: string[], status(active/suspended/deleted), bindCode?, membershipSummary{type,label,remainingCredits,expireDate,status}, createdAt, updatedAt`

`wxid` 为学员自愿填写的微信号，与 OpenID 无关。

## classSeries — 排课批次
`_id ("series_" + requestId，幂等), mode(single/weekly/multi), name, teacherId, startTime, duration, weekdays[], startDate, endDate, dates[], classIds[], status(active/cancelled), createdBy, createdAt`

## classes — 课程（单节）
`_id ("cls_" + seriesId + "_" + date，确定性，防止重复生成), seriesId, name, teacherId, teacherName, date, startTime, endTime, duration, startAt, endAt, capacity?, description, status(scheduled/cancelled), cancelReason?, cancelledAt?, checkedInCount, createdBy, createdAt, updatedAt`

## attendance — 签到记录
`_id (classId + "_" + studentId，确定性主键，从根本上防止重复签到)`
`classId, studentId, className, teacherId, teacherName, classDate, startTime, status(present/absent/class_cancelled), source(self/manual), checkInAt?, deduction{membershipId,kind(credit/monthly/none),month}?, history[{at,operatorId,from,to,reason}], createdAt, updatedAt`

## attendanceRosters — 上课名单（可选）
`_id ("class_" + classId 或 "series_" + seriesId), classId?, seriesId?, studentIds[], groups[], updatedBy, updatedAt`
课程级名单优先于批次名单。未配置名单时，"未签到" 列表不计算。

## memberships — 会员卡
`_id, studentId, type(pass/monthly), name, totalCredits, usedCredits, remainingCredits, purchaseDate, startDate, expireDate, status(active/expired/suspended), policy{mode(unlimited/limited), monthlyLimit}, usage{"YYYY-MM": n}, priceCents?(人民币分), createdBy, createdAt, updatedAt`

## transactions — 课时流水（只增不改）
`_id, studentId, membershipId, type(purchase/credit_add/attendance_deduction/manual_deduction/refund/renewal/expiration), amount, previousBalance, newBalance, operatorId, reason, refType?, refId?, createdAt`

## rolePermissions — 角色权限矩阵
`_id(role), permissions: string[], updatedBy, updatedAt`（`owner` 始终拥有全部权限，不可被修改）

## auditLogs — 审计日志
`_id, actorId, actorRole, action, targetType, targetId, before, after, reason, createdAt`

## systemSettings — 系统设置
`_id = "global"`，字段见 `cloudfunctions/api/lib/settings-defaults.js`。
`_id = "bootstrap-lock"`：店主初始化永久锁 `{ ownerUserId, createdAt }`，存在即禁止再次初始化。

## staffInvites — 已废弃
旧版邀请码集合，仅为历史数据保留；`system.migrate` 会作废全部未使用的邀请码。新版本不再读写。

## 并发与完整性
- 签到、手动签到、更正、退课时、调整课时全部在 `db.runTransaction` 中完成：读取课程、学员、会员卡与签到记录 → 校验 → 写入签到、扣减余额、写流水、更新计数，任一失败整体回滚，**失败绝不扣课时**。
- 签到主键确定性（`classId_studentId`），同一学员对同一课程的并发请求在事务层面写冲突，只会成功一次。
- 事务冲突自动重试（最多 3 次）。
- 余额永远由服务端从数据库读取后计算，不接受客户端传入的余额、角色或用户 ID。


## 手机号验证与会员卡类型（v3）

- students：phone（必填，中国大陆手机号）、phoneVerified、phoneVerifiedAt、phoneVerifyMethod（wechat / sms）。管理员录入的号码一律为未验证。
- phoneIndex：_id = ph_<手机号>，studentId；保证手机号唯一。
- phoneVerifications：_id = pv_<userId>，仅存验证码哈希，5 分钟有效，最多 5 次尝试。
- memberships.type：CLASS_PASS / MONTHLY / QUARTERLY（旧值 pass / monthly 读取时自动兼容，system.migrate 会转换）。
- memberships.policy.mode：credits（次卡）/ unlimited / quota（固定次数，使用 totalCredits / usedCredits / remainingCredits）；autoExpireDate 记录自动计算的到期日，expireDate 可由管理员覆盖。
- 月卡默认 1 个自然月、季卡默认 3 个自然月，到期日含当天（如 2026-11-15 起季卡到期 2027-02-14）。
- 部署：云函数需开通 phonenumber.getPhoneNumber 权限；短信兜底需提供 cloudfunctions/api/lib/sms-provider.js（导出 sendSms(phone, code)），未配置时短信验证返回「短信验证暂未开通」。升级后在控制台调用 system.migrate。
