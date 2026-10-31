'use strict';

const DEFAULT_SETTINGS = {
  studioName: 'FQ Dance Studio',
  timezone: 'Asia/Shanghai',
  currency: 'CNY',
  privacyPolicyVersion: '2024-06-01',
  checkin: {
    // 开课前多少分钟开放签到
    openBeforeMinutes: 60,
    // 开课后多少分钟仍可签到（不超过下课时间）
    closeAfterStartMinutes: 30,
  },
  membership: {
    // 月卡默认策略：unlimited 不限次 / limited 每月限次
    monthlyDefaultMode: 'unlimited',
    monthlyDefaultLimit: 8,
    // 课程取消时是否退还已扣课时（次卡）/ 已计次数（月卡）
    refundOnCancel: true,
    // 多张有效卡时优先使用：expiring_first 先到期先用
    selectionOrder: 'expiring_first',
    // 次卡默认有效期（天）
    passDefaultValidDays: 180,
    passPresets: [5, 10, 20],
  },
  staff: {
    inviteValidHours: 72,
  },
};

module.exports = { DEFAULT_SETTINGS };
