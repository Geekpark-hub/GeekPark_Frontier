<template>
  <div class="page page-card">
    <div class="toolbar">
      <div>
        <h2>会员需求</h2>
        <p class="muted">跟进资源连接请求，状态与备注仅后台可见</p>
      </div>
    </div>
    <el-table :data="list" stripe empty-text="暂无需求">
      <el-table-column label="会员" width="160">
        <template #default="{ row }">{{ row.member?.name }} / {{ row.member?.company }}</template>
      </el-table-column>
      <el-table-column prop="content" label="需求内容" min-width="260" />
      <el-table-column prop="location" label="地点" width="120" />
      <el-table-column prop="connectWith" label="希望连接" width="160" />
      <el-table-column label="状态" width="140">
        <template #default="{ row }">
          <el-select v-model="row.status" size="small" @change="(v) => update(row, { status: v })">
            <el-option label="已提交" value="submitted" />
            <el-option label="处理中" value="processing" />
            <el-option label="已完成" value="done" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="内部备注" min-width="220">
        <template #default="{ row }">
          <el-input
            v-model="row.adminNote"
            size="small"
            placeholder="添加备注"
            @blur="update(row, { adminNote: row.adminNote })"
          />
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const list = ref([]);

async function load() {
  const res = await api.get('/admin/requests');
  list.value = res.requests;
}

async function update(row, payload) {
  try {
    await api.put(`/admin/requests/${row.id}`, payload);
    ElMessage.success('已更新');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
