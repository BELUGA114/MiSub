<script setup>
import { ref, watch } from 'vue';
import { useI18n } from '../../../../i18n/index.js';
import Input from '../../../ui/Input.vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

// 本地草稿：仅当输入为合法 JSON 动作数组时才提交，避免半输入状态污染配置
const serialize = (dsl) => JSON.stringify(Array.isArray(dsl) ? dsl : [], null, 2);
const dslDraft = ref(serialize(props.modelValue?.dsl));
const dslError = ref('');
let lastCommitted = Array.isArray(props.modelValue?.dsl) ? props.modelValue.dsl : [];

const commitDsl = (dsl) => {
  lastCommitted = dsl;
  emit('update:modelValue', { ...props.modelValue, dsl });
};

const onDslInput = (event) => {
  const text = event.target.value;
  dslDraft.value = text;
  if (text.trim() === '') {
    dslError.value = '';
    commitDsl([]);
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      dslError.value = t('operators.scriptDslInvalid');
      return;
    }
    dslError.value = '';
    commitDsl(parsed);
  } catch {
    dslError.value = t('operators.scriptDslInvalid');
  }
};

// 外部（如迁移逻辑）替换 params 时同步草稿；来自自身提交的变更不回写，避免打断输入
watch(() => props.modelValue, (val) => {
  const external = Array.isArray(val?.dsl) ? val.dsl : [];
  if (JSON.stringify(external) !== JSON.stringify(lastCommitted)) {
    lastCommitted = external;
    dslDraft.value = serialize(external);
    dslError.value = '';
  }
});
</script>

<template>
  <div class="space-y-4">
    <Input
      :modelValue="modelValue.url"
      @update:modelValue="(val) => emit('update:modelValue', { ...modelValue, url: val })"
      :label="t('operators.scriptUrlLabel')"
      :placeholder="t('operators.scriptUrlPlaceholder')"
    />
    <div class="space-y-1">
      <label class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('operators.scriptDslLabel') }}</label>
      <textarea
        :value="dslDraft"
        @input="onDslInput"
        class="w-full h-64 p-4 font-mono text-sm bg-slate-900/50 text-slate-200 border border-slate-700/50 rounded-xl focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all resize-none"
        :placeholder="t('operators.scriptDslPlaceholder')"
      ></textarea>
      <p v-if="dslError" class="text-[11px] text-rose-500">{{ dslError }}</p>
      <p class="text-[11px] text-gray-400 dark:text-gray-500">{{ t('operators.scriptDslHint') }}</p>
    </div>
  </div>
</template>
