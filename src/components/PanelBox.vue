<script setup lang="ts">
/**
 * 通用科技风面板容器
 * 玻璃拟态背景 + 发光不规则边角 + 标题栏
 */
withDefaults(
  defineProps<{
    title?: string
    sub?: string
  }>(),
  { title: '', sub: '' },
)
</script>

<template>
  <section class="tech-panel relative flex min-h-0 flex-col rounded-[4px] p-3">
    <span class="corner corner-tl"></span>
    <span class="corner corner-tr"></span>
    <span class="corner corner-bl"></span>
    <span class="corner corner-br"></span>

    <header v-if="title" class="relative z-10 shrink-0">
      <div class="flex items-baseline justify-between">
        <h3 class="panel-title">{{ title }}</h3>
        <span v-if="sub" class="digital text-[11px] text-text-sub">{{ sub }}</span>
      </div>
      <div class="panel-rule mt-2"></div>
    </header>

    <div class="relative z-10 mt-2 flex min-h-0 flex-1 flex-col">
      <slot />
    </div>
  </section>
</template>
