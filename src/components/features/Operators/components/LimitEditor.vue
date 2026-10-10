<script setup>
import { useI18n } from '../../../../i18n/index.js';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

// 分组方式选项：与后端 nodeGroupKey 的 groupBy 取值一一对应
const groupOptions = [
  { value: 'none', labelKey: 'operators.limitGroupNone' },
  { value: 'region', labelKey: 'operators.limitGroupRegion' },
  { value: 'protocol', labelKey: 'operators.limitGroupProtocol' },
  { value: 'regionProtocol', labelKey: 'operators.limitGroupRegionProtocol' },
  { value: 'name', labelKey: 'operators.limitGroupName' },
];

const update = (patch) => {
  emit('update:modelValue', { ...props.modelValue, ...patch });
};

const onCount = (event) => {
  // 仅接受正整数；非法输入不写入，交由后端护栏兜底
  const n = parseInt(event.target.value, 10);
  update({ count: Number.isInteger(n) && n > 0 ? n : undefined });
};
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <span class="text-[11px] font-bold text-gray-400 uppercase tracking-tight">{{ t('operators.limitCount') }}</span>
      <input
        :value="modelValue.count ?? ''"
        @input="onCount"
        type="number"
        min="1"
        class="w-20 px-2 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 outline-none focus:border-indigo-500/30"
      />
    </div>

    <div class="space-y-2">
      <span class="text-[11px] font-bold text-gray-400 uppercase tracking-tight">{{ t('operators.limitGroupBy') }}</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="opt in groupOptions"
          :key="opt.value"
          @click="update({ groupBy: opt.value })"
          :class="[
            'text-[10px] px-2.5 py-1 rounded-lg border transition-colors',
            (modelValue.groupBy || 'none') === opt.value
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-500 hover:border-indigo-300'
          ]"
        >
          {{ t(opt.labelKey) }}
        </button>
      </div>
    </div>

    <p class="text-[10px] text-gray-400">{{ t('operators.limitHint') }}</p>
  </div>
</template>
