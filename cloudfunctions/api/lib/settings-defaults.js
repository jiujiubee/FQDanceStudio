'use strict';

const DEFAULT_BOOKING_CANCELLATION_CUTOFF_MINUTES = 60;
const MAX_BOOKING_CANCELLATION_CUTOFF_MINUTES = 10080;

const DEFAULT_SETTINGS = {
  studioName: 'FQ Dance Studio',
  timezone: 'Asia/Shanghai',
  currency: 'CNY',
  privacyPolicyVersion: '2024-06-01',
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
  // 学生端首页：工作室资料（由店主在「首页资料」中维护）
  studio: {
    posters: [],
    intro: '',
    features: [],
    about: '',
    address: '',
    phone: '',
  },
  booking: {
    // 开课前多少分钟停止取消预约
    bookingCancellationCutoffMinutes: DEFAULT_BOOKING_CANCELLATION_CUTOFF_MINUTES,
  },
};

/** 开课前多少分钟内不可取消预约（唯一取值入口）；配置缺失或非法时使用默认值 */
function bookingCancellationCutoffMinutes(settings) {
  const m = settings && settings.booking && settings.booking.bookingCancellationCutoffMinutes;
  return Number.isInteger(m) && m >= 0 && m <= MAX_BOOKING_CANCELLATION_CUTOFF_MINUTES ? m : DEFAULT_BOOKING_CANCELLATION_CUTOFF_MINUTES;
}

module.exports = {
  DEFAULT_SETTINGS, DEFAULT_BOOKING_CANCELLATION_CUTOFF_MINUTES, MAX_BOOKING_CANCELLATION_CUTOFF_MINUTES, bookingCancellationCutoffMinutes,
};
