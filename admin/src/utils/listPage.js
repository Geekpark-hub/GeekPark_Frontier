/** 列表分页默认每页 10 条 */
export const DEFAULT_PAGE_SIZE = 10;

export function pageParams(page, pageSize = DEFAULT_PAGE_SIZE) {
  return { page: page || 1, pageSize };
}
