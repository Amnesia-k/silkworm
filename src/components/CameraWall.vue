<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { cameras, cameraScopeNote } from '@/mock/bigscreen'

/**
 * 蚕房实景监控（分屏多路视频流）
 * 未接入真实流时展示模拟画面；将 cameras 中的 streamUrl 填上即可切换为真实视频。
 *
 * 范围说明：规格书 §2.3 N1 明确「不做视频图像监控与蚕病识别，另有独立项目负责」，
 * 因此本页仅作为展示/对接能力演示，不计入环境调控系统的功能范围。
 */
const time = ref('')
const pad = (n: number) => String(n).padStart(2, '0')
let timer: number | undefined

function tick(): void {
  const d = new Date()
  time.value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

onMounted(() => {
  tick()
  timer = window.setInterval(tick, 1000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="relative h-full min-h-0 w-full">
    <!-- 分屏栅格 -->
    <div class="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-3">
      <div
        v-for="cam in cameras"
        :key="cam.id"
        class="tech-panel relative flex min-h-0 flex-col overflow-hidden rounded-[4px]"
      >
        <span class="corner corner-tl"></span>
        <span class="corner corner-tr"></span>
        <span class="corner corner-bl"></span>
        <span class="corner corner-br"></span>

        <!-- 画面区 -->
        <div class="cam-feed relative min-h-0 flex-1 overflow-hidden">
          <!-- 真实视频流（配置 streamUrl 后启用） -->
          <video
            v-if="cam.streamUrl"
            class="absolute inset-0 h-full w-full object-cover"
            :src="cam.streamUrl"
            autoplay
            muted
            loop
            playsinline
          ></video>

          <!-- 模拟蚕房画面 -->
          <template v-else>
            <div class="cam-floor"></div>
            <div class="cam-rack" style="left: 12%"></div>
            <div class="cam-rack" style="left: 40%"></div>
            <div class="cam-rack" style="left: 68%"></div>
            <div class="cam-scanline"></div>
            <div v-if="!cam.online" class="cam-noise"></div>
          </template>

          <!-- 覆盖信息 -->
          <div class="absolute inset-0">
            <!-- 顶部：名称 + 状态 -->
            <div class="flex items-start justify-between p-3">
              <div>
                <div class="text-[13px] font-semibold tracking-wider text-cyber-blue">
                  {{ cam.name }}
                </div>
                <div class="mt-[2px] text-[11px] text-text-sub">{{ cam.location }}</div>
              </div>
              <div class="flex items-center gap-2">
                <span
                  v-if="cam.online"
                  class="flex items-center gap-[5px] text-[11px] text-cyber-red"
                >
                  <span class="h-[7px] w-[7px] animate-pulse rounded-full bg-cyber-red"></span>
                  REC
                </span>
                <span
                  class="border px-[6px] py-[1px] text-[10px] tracking-wider"
                  :class="
                    cam.online
                      ? 'border-cyber-cyan/50 text-cyber-cyan'
                      : 'border-cyber-red/50 text-cyber-red'
                  "
                >
                  {{ cam.online ? 'ONLINE' : 'NO SIGNAL' }}
                </span>
              </div>
            </div>

            <!-- 底部：时间戳 + 分辨率 -->
            <div class="absolute inset-x-0 bottom-0 flex items-center justify-between p-3">
              <span class="digital text-[12px] text-cyber-cyan/90">{{ time }}</span>
              <span class="digital text-[10px] text-text-dim">1920×1080 · 25FPS</span>
            </div>

            <!-- 四角取景框 -->
            <span class="cam-bracket left-2 top-14"></span>
            <span class="cam-bracket right-2 top-14"></span>
            <span class="cam-bracket bottom-10 left-2"></span>
            <span class="cam-bracket bottom-10 right-2"></span>

            <!-- 离线提示 -->
            <div
              v-if="!cam.online"
              class="absolute inset-0 flex flex-col items-center justify-center gap-2"
            >
              <span class="digital text-[18px] tracking-[4px] text-cyber-red glow">NO SIGNAL</span>
              <span class="text-[12px] text-text-sub">设备离线 · 请检查网络连接</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 顶部状态条 -->
    <div class="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2">
      <div
        class="flex items-center gap-3 border border-cyber-blue/30 bg-ink-900/80 px-4 py-[3px] text-[11px] text-cyber-blue backdrop-blur-sm"
      >
        <span class="status-dot text-cyber-cyan animate-pulse"></span>
        实景监控 · 4 路分屏 · 在线 {{ cameras.filter((c) => c.online).length }}/{{ cameras.length }}
      </div>
    </div>

    <!-- 范围说明（规格书 §2.3 N1） -->
    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
      <div
        class="border border-cyber-yellow/40 bg-ink-900/85 px-4 py-[4px] text-[11px] text-cyber-yellow/90"
      >
        {{ cameraScopeNote }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.cam-feed {
  background:
    linear-gradient(180deg, rgba(11, 18, 36, 0.9) 0%, rgba(5, 10, 22, 0.95) 100%),
    radial-gradient(ellipse at 50% 20%, rgba(0, 229, 255, 0.12), transparent 65%);
}

/* 模拟地面透视网格 */
.cam-floor {
  position: absolute;
  inset: 46% -20% -20% -20%;
  background-image:
    linear-gradient(rgba(0, 229, 255, 0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.18) 1px, transparent 1px);
  background-size: 42px 42px;
  transform: perspective(220px) rotateX(64deg);
  opacity: 0.55;
}

/* 模拟蚕箔架剪影 */
.cam-rack {
  position: absolute;
  top: 22%;
  width: 62px;
  height: 40%;
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-radius: 2px;
  background: repeating-linear-gradient(
    180deg,
    rgba(0, 229, 255, 0.1) 0 4px,
    transparent 4px 12px
  );
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.18);
}

/* 扫描线 */
.cam-scanline {
  position: absolute;
  inset-inline: 0;
  height: 60px;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(0, 229, 255, 0.16) 45%,
    rgba(0, 229, 255, 0.32) 50%,
    transparent
  );
  animation: cam-scan 5.5s linear infinite;
}

@keyframes cam-scan {
  0% {
    top: -15%;
  }
  100% {
    top: 105%;
  }
}

/* 噪点 */
.cam-noise {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.05) 0 1px,
    transparent 1px 3px
  );
  opacity: 0.6;
  animation: cam-flicker 0.35s steps(2) infinite;
}

@keyframes cam-flicker {
  50% {
    opacity: 0.25;
  }
}

/* 取景框角标 */
.cam-bracket {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 1px solid rgba(0, 229, 255, 0.55);
}
.cam-bracket.left-2 {
  border-right: none;
}
.cam-bracket.right-2 {
  border-left: none;
}
.cam-bracket.top-14 {
  border-bottom: none;
}
.cam-bracket.bottom-10 {
  border-top: none;
}
</style>
