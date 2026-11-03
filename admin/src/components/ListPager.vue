<template>
  <div v-if="total > 0" class="list-pager">
    <el-pagination
      background
      layout="total, prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      @current-change="$emit('update:page', $event)"
    />
  </div>
</template>

<script setup>
defineProps({
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  total: { type: Number, default: 0 },
});
defineEmits(['update:page']);
</script>

<style scoped>
.list-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
