/** 管理后台列表分页：默认每页 10 条 */
export function parsePageQuery(query = {}, { defaultPageSize = 10, maxPageSize = 50 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, Number.parseInt(query.pageSize, 10) || defaultPageSize)
  );
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip, take: pageSize };
}

export function pageResult({ page, pageSize, total, rowsKey, rows }) {
  return {
    [rowsKey]: rows,
    total,
    page,
    pageSize,
  };
}
