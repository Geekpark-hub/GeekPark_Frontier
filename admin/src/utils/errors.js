/** 把接口/代理原始错误转成用户可读文案，避免暴露 Cannot GET /xxx 等技术信息 */
export function friendlyApiError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const raw =
    (typeof data?.error === 'string' && data.error) ||
    (typeof data?.message === 'string' && data.message) ||
    '';

  if (raw && !looksTechnical(raw)) return raw;

  if (!err?.response) {
    return '网络异常，服务可能未启动，请稍后重试';
  }

  if (status === 400) return raw || '请求参数有误';
  if (status === 401) return '登录已失效，请重新登录';
  if (status === 403) return raw || '没有权限执行此操作';
  if (status === 404) return '请求的内容不存在';
  if (status === 408 || status === 504) return '请求超时，请稍后重试';
  if (status >= 500) return '服务暂时出了点问题，请稍后重试';

  if (typeof err?.message === 'string' && !looksTechnical(err.message)) {
    return err.message;
  }
  return '操作失败，请稍后重试';
}

function looksTechnical(text) {
  const t = String(text || '');
  return (
    /cannot\s+(get|post|put|delete)/i.test(t) ||
    /proxy/i.test(t) ||
    /ECONNREFUSED/i.test(t) ||
    /ENOTFOUND/i.test(t) ||
    /Request failed with status code/i.test(t) ||
    /<\/?html/i.test(t) ||
    /Error occurred while trying to proxy/i.test(t) ||
    /^\/\w+/.test(t)
  );
}
