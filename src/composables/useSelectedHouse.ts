import { computed, ref } from 'vue'
import { houses, type HouseNode } from '@/mock/houses'

/**
 * 全局选中的蚕房（2D 总览卡片、中间 3D 舞台、底部温湿度趋势图共用同一份状态）
 * 这样「点击谁 → 展示谁」在三个区域是联动的。
 */
const selectedHouseId = ref<string | null>(null)

export function useSelectedHouse() {
  const selectedHouse = computed<HouseNode | null>(
    () => houses.find((h) => h.id === selectedHouseId.value) ?? null,
  )

  function selectHouse(id: string | null): void {
    selectedHouseId.value = id
  }

  return { selectedHouseId, selectedHouse, selectHouse }
}
