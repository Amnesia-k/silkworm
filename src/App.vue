 <script setup lang="ts">
import { computed, ref } from 'vue'
import BottomPanel from '@/components/BottomPanel.vue'
import CameraWall from '@/components/CameraWall.vue'
import CenterTwin from '@/components/CenterTwin.vue'
import CyberBackground from '@/components/CyberBackground.vue'
import LeftPanel from '@/components/LeftPanel.vue'
import RightPanel from '@/components/RightPanel.vue'
import ScreenHeader from '@/components/ScreenHeader.vue'
import type { ScreenMode } from '@/components/ScreenHeader.vue'
import { useScreenFit } from '@/composables/useScreenFit'

/**
 * 智能蚕房设备监控中心 —— 大屏根容器
 * 1920x1080 设计基准，等比缩放适配任意分辨率（含 4K）
 */
const mode = ref<ScreenMode>('overview')
const { scale } = useScreenFit(1920, 1080)

const canvasStyle = computed(() => ({
  width: '1920px',
  height: '1080px',
  transform: `translate(-50%, -50%) scale(${scale.value})`,
}))
</script>

<template>
  <div class="relative h-screen w-screen overflow-hidden">
    <CyberBackground />

    <div class="absolute left-1/2 top-1/2" :style="canvasStyle">
      <div class="flex h-full w-full flex-col px-4 pb-3">
        <!-- 顶部导航区 -->
        <ScreenHeader :mode="mode" @change="mode = $event" />

        <!-- 中部：左面板 / 中央核心区 / 右面板 -->
        <main class="grid min-h-0 flex-1 grid-cols-[420px_1fr_420px] gap-3 pt-3">
          <LeftPanel />

          <div class="relative min-h-0">
            <Transition name="mode-switch" mode="out-in">
              <CenterTwin v-if="mode === 'overview'" key="twin" />
              <CameraWall v-else key="camera" />
            </Transition>
          </div>

          <RightPanel />
        </main>

        <!-- 底部数据面板 -->
        <section class="h-[300px] shrink-0 pt-3">
          <BottomPanel />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mode-switch-enter-active,
.mode-switch-leave-active {
  transition:
    opacity 0.36s ease,
    transform 0.36s ease;
}

.mode-switch-enter-from {
  opacity: 0;
  transform: scale(0.96);
}

.mode-switch-leave-to {
  opacity: 0;
  transform: scale(1.03);
}
</style>
