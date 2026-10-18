# 玻璃材质与按钮

## 设计依据

本轮对照苹果官方 [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)、[Materials](https://developer.apple.com/design/human-interface-guidelines/materials) 与 [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) 的按钮和层级说明。采用其设计原则，在 Electron/WebView 中实现相应视觉，不将网页近似实现称作苹果原生 Liquid Glass。

- 独立操作按钮使用透明填色、细边高光和柔和接触阴影；圆形/胶囊形状沿用现有命中区域。
- 导航、设置分类和播放器菜单已位于玻璃容器之上，内部按钮使用薄填色，避免给每个子按钮叠加背景模糊与折射。
- 主要操作保持强调色；普通按钮保持中性。分组选择态继续使用原 aria 状态，不用焦点代替选择。旧内核不支持圆角outline时，用同一条中性圆角边环替代方形outline，不额外叠加光晕。
- 自定义按钮有明确按压反馈：按下位置的柔光和轻微边缘受压。键盘/手柄/遥控确认同样可见；不改变按钮命中矩形，不新增弹跳或动作派发。
- 播放/暂停按钮以更亮的填色区分主操作；其他播放按钮保持相同尺寸。时间、状态和按键提示采用贴合文字的薄底色，提示仍保留两行空间，不让进度条或按钮随输入方式移动。

## 实现边界

`visual/glass-material` 按实际 CSS 能力选择标准背景模糊、前缀背景模糊或兼容材质。WebView66 实测两种背景模糊与 color-mix 均不支持，普通 filter 与渐变可用。兼容层不改 WebView 版本门槛，不开实验开关，不要求用户更换系统组件。

兼容材质保留半透明色、渐变、边缘反光与原有阴影。浏览弹窗打开时，只柔化已 inert 的浏览外壳；弹窗前景不加滤镜，收起立即释放。播放器存在时不柔化浏览外壳、播放器或视频；播放控制与菜单采用不同厚度的透色底板，保留真实播放画面。没有截图复制、逐帧 canvas、媒体采样或原生截图桥。

`visual/glass-buttons` 只为明确的操作按钮注册材质标记与亮度反馈，子树移除时释放标记，最多保留一个当前按压和一个清理定时器。它不修改焦点、标签、禁用状态、偏好或事件默认行为，不触发搜索/播放/切集等动作。指针取消、窗口失焦、页面隐藏及卸载均清理按压状态。

支持的桌面内核保留原有 SVG 背景折射，只给有限容器和两个独立页面操作按钮生成尺寸有界的位移图；菜单内部按钮与播放按钮不各自生成滤镜。减少透明度、提高对比度及强制颜色采用实色回退，减少动态效果停用材质动画。

全屏/还原或连续缩放期间，已有容器临时使用基础玻璃材质，尺寸稳定140ms后按最终大小合并重建位移图。普通内容更新不延长这个等待，返回原尺寸可复用原滤镜，卸载清理定时器；不在每个中间尺寸同步编码纹理，不改变视频节点、播放意图或焦点。

## 验证

- `renderer-glass-buttons-smoke.mjs`：两端明暗按钮的薄层、边缘、按压/取消/失焦清理、单一焦点、命中矩形及原有暂停操作。
- `renderer-glass-compat-smoke.mjs`：能力缺失下的透明材质、浏览模糊生命周期、无障碍回退、视频不加滤镜。
- `renderer-glass-smoke.mjs`：现代桌面原生折射、黑白画面的文字对比度、明暗主题及无障碍几何稳定。
- `renderer-glass-resize-smoke.mjs`：连续尺寸变化的位移图生成次数、最终滤镜尺寸及媒体节点/暂停保持。
- 播放器命中稳定、菜单命中、按键提示及参数选择脚本分别验证布局和操作，不能仅用材质截图替代交互验收。
- `android-glass-smoke.mjs`：仅指定隔离 Android9/WebView66 模拟器，检查真实能力、两种主题、七键按钮反馈与原创 MP4 解码/暂停，不连接实体电视或日常账号。截图留在 `.tmp/android-glass/`，实体电视性能与视觉仍需实测。

CSS 普通 filter 与 backdrop-filter 的渲染边界参见 [Filter Effects Level 1](https://www.w3.org/TR/filter-effects-1/) 和 [Level 2](https://drafts.csswg.org/filter-effects-2/)。
