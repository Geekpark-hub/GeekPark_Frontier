import { onActivated, onMounted } from 'vue';

/**
 * keep-alive 列表页：首次挂载加载；再次进入时刷新，避免脏数据。
 */
export function useListRefresh(load) {
  let firstActivate = true;
  onMounted(load);
  onActivated(() => {
    if (firstActivate) {
      firstActivate = false;
      return;
    }
    load();
  });
}
