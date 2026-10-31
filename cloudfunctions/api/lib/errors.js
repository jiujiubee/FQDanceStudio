'use strict';

class AppError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

const E = {
  unauthenticated: () => new AppError('UNAUTHENTICATED', '登录状态无效，请重新登录', 401),
  notRegistered: () => new AppError('NOT_REGISTERED', '账户尚未注册', 401),
  suspended: () => new AppError('ACCOUNT_SUSPENDED', '账户已被停用，请联系工作室', 403),
  forbidden: (msg) => new AppError('FORBIDDEN', msg || '没有权限执行该操作', 403),
  notFound: (what) => new AppError('NOT_FOUND', `${what || '数据'}不存在`, 404),
  invalid: (msg) => new AppError('INVALID_ARGUMENT', msg || '参数错误', 400),
  conflict: (code, msg) => new AppError(code, msg, 409),
  rule: (code, msg) => new AppError(code, msg, 422),
};

module.exports = { AppError, E };
