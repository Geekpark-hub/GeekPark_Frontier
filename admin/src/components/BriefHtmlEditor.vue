<template>
  <div class="brief-editor">
    <div class="brief-editor-bar">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="visual">可视化</el-radio-button>
        <el-radio-button value="source">HTML 源码</el-radio-button>
      </el-radio-group>
      <span class="hint">章节请用「标题」写成 PART 1：xxx，阅读页才会进目录</span>
    </div>

    <div v-show="mode === 'visual'" class="brief-editor-visual">
      <Toolbar
        class="brief-toolbar"
        :editor="editorRef"
        :default-config="toolbarConfig"
        mode="default"
      />
      <Editor
        class="brief-body"
        :model-value="modelValue"
        :default-config="editorConfig"
        mode="default"
        @on-created="onCreated"
        @on-change="onChange"
      />
    </div>

    <el-input
      v-show="mode === 'source'"
      :model-value="modelValue"
      type="textarea"
      :rows="18"
      placeholder="导入后请校对排版"
      @update:model-value="onSourceInput"
    />
  </div>
</template>

<script setup>
import '@wangeditor/editor/dist/css/style.css';
import { onBeforeUnmount, shallowRef, ref, watch } from 'vue';
import { Editor, Toolbar } from '@wangeditor/editor-for-vue';
import { i18nChangeLanguage } from '@wangeditor/editor';

i18nChangeLanguage('zh-CN');

const props = defineProps({
  modelValue: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const mode = ref('visual');
const editorRef = shallowRef();
let syncing = false;

const toolbarConfig = {
  toolbarKeys: [
    'headerSelect',
    'bold',
    'blockquote',
    '|',
    'undo',
    'redo',
  ],
};

const editorConfig = {
  placeholder: '导入后请在此校对正文…',
  // 内参阅读页只吃 h2 / p / blockquote / strong
  MENU_CONF: {
    headerSelect: {
      // 仅保留段落 + 二级标题，避免 h1/h3 与阅读页解析不一致
    },
  },
};

/** 压成阅读页可识别的标签（与 briefHtml / briefImport 对齐） */
function sanitizeBriefHtml(html) {
  let s = String(html || '');
  if (!s || s === '<p><br></p>') return '';
  s = s.replace(/<\/?(span|font|div)[^>]*>/gi, '');
  s = s.replace(/\sstyle="[^"]*"/gi, '');
  s = s.replace(/\sclass="[^"]*"/gi, '');
  s = s.replace(/<\/?h1\b[^>]*>/gi, (tag) => tag.replace(/h1/gi, 'h2'));
  s = s.replace(/<\/?h[3-6]\b[^>]*>/gi, (tag) => tag.replace(/h[3-6]/gi, 'h2'));
  s = s.replace(/<\/?b\b[^>]*>/gi, (tag) => (tag.startsWith('</') ? '</strong>' : '<strong>'));
  s = s.replace(
    /<p>\s*(?:<strong>)?\s*(PART\s*\d+[\s\S]*?)\s*(?:<\/strong>)?\s*<\/p>/gi,
    (_m, title) => `<h2>${String(title).replace(/<\/?strong>/gi, '').trim()}</h2>`
  );
  s = s.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
  return s.trim();
}

function onCreated(editor) {
  editorRef.value = editor;
}

function onChange(editor) {
  if (syncing) return;
  const html = sanitizeBriefHtml(editor.getHtml());
  if (html !== props.modelValue) emit('update:modelValue', html);
}

function onSourceInput(v) {
  emit('update:modelValue', String(v || ''));
}

watch(
  () => props.modelValue,
  (v) => {
    const editor = editorRef.value;
    if (!editor || mode.value !== 'visual') return;
    const next = String(v || '');
    const cur = sanitizeBriefHtml(editor.getHtml());
    if (next === cur) return;
    syncing = true;
    editor.setHtml(next || '<p><br></p>');
    syncing = false;
  }
);

watch(mode, (m) => {
  if (m !== 'visual') return;
  const editor = editorRef.value;
  if (!editor) return;
  syncing = true;
  editor.setHtml(String(props.modelValue || '') || '<p><br></p>');
  syncing = false;
});

onBeforeUnmount(() => {
  const editor = editorRef.value;
  if (editor) editor.destroy();
  editorRef.value = null;
});
</script>

<style scoped>
.brief-editor {
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.brief-editor-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: #f7f8fa;
}

.hint {
  font-size: 12px;
  color: #8b939c;
}

.brief-toolbar {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.brief-body {
  min-height: 360px;
  height: 420px;
  overflow-y: auto;
}

.brief-editor :deep(.el-textarea__inner) {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.55;
}

.brief-editor :deep(.w-e-text-container) {
  background: #fff;
}
</style>
