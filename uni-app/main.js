import App from './App'
import { createSSRApp } from 'vue'
import { shim } from './utils/uni-shim.js'

export function createApp() {
  const app = createSSRApp(App)
  // 小程序写法兼容层：为每个组件实例提供 setData(patch, cb)
  app.mixin(shim)
  return { app }
}
