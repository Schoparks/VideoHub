# 开发与验证

手机栏目与桌面共用`navigation`及`browse-sections`。栏目接线还运行`tests/phone-browse.test.ts`；`phone-browse-checks.mjs`随手机回归核对六个主栏目、动态/分区/影视筛选及五个个人分类。卡片检查可见视口中心、320/390px和横屏边界；测试夹具的快速遍历与写操作分阶段，等待HTTP突发配额恢复，不重放失败写入。

手机控制台改动运行 `tests/phone-controller.test.ts`、`tests/phone-companion.test.ts`、`tests/phone-library.test.ts`、`tests/phone-history.test.ts`，以及 `node scripts/renderer-phone-controller-smoke.mjs`、`node scripts/desktop-phone-controller-smoke.mjs`。前者使用隔离夹具验证新标签页重连、独立搜索、封面显示、设置回滚与分类无滚动、播放参数/相关推荐、历史平台调用与本机新记录、切集/迟到播放不抢导航、卡片/气泡/返回顶部、电视扫码入口、收藏与队列失败反馈及横竖屏；后者使用始终隐藏的新Electron配置与本地样片验证真实命名桥、保存和解码。`node scripts/phone-review.mjs`生成带隔离样例标记的审阅截图，不作为真实账号验收。旧电视前端不得直接引入Zod；通过 `node scripts/android-web.mjs` 与原显式隔离模拟器流程验证，不把构建等同于实体手机/电视验收。

修改前阅读 [协作规范](../AGENTS.md) 和 [变更记录](../CHANGELOG.md)。源码运行与平台要求见 [README](../README.md)，安卓构建见 [安卓电视说明](android-tv.md)。以下保留按职责划分的验证入口；历史结果见 [验收记录](verification.md)，不代表当前提交已重新执行。

## 常用验证

`tests/bilibili-quality.test.ts` 覆盖B站点播上限、1080P各档、缺档回退、兼容MP4边界、权限及偏好迁移。构建后运行 `node scripts/renderer-bilibili-quality-smoke.mjs` 检查设置手柄/键盘操作、清晰度记忆、切集重选、保存回滚和取消；配合 `renderer-settings-parity-smoke.mjs`、`renderer-paused-quality-smoke.mjs`、`renderer-error-quality-smoke.mjs`。界面测试均为无窗口隔离夹具，不读取账号，不等于实体电视画质解码验收。

`node scripts/renderer-window-restore-smoke.mjs` 交叉验证电视偏好/实际窗口全屏状态、重复播放、切换中退出和初始查询期间重复确认；`renderer-fullscreen-smoke.mjs`、`renderer-exit-smoke.mjs`、`renderer-preference-refresh-smoke.mjs` 保留原生事件、失败重试、退出回焦及设置排队合同。`renderer-glass-resize-smoke.mjs` 计数连续尺寸变化中的位移纹理编码并核对最终尺寸和媒体节点，均为无窗口夹具，不代表实体显示器转场帧率。

`node scripts/desktop-player-window-smoke.mjs` 在始终隐藏的全新Electron配置中验证实际本地MP4解码、两种电视模式偏好、全屏读取/按钮及退出恢复、同一暂停视频节点和隐藏保护。通过 `YINGJI_EXECUTABLE` 指向交付程序；隐藏模式不执行实际窗口全屏，不能用它验收原生转场流畅度。

`node scripts/renderer-setting-editing-smoke.mjs` 在1440×950和1920×1080验证顶栏唯一搜索焦点、空搜索回车、设置确认进入/返回结束编辑、滚轮不改值、滑条首次点击和滑动不改值。手机回归另检查320×568、390×640、844×390单屏、弹出卡片搜索语义/关闭、图标、移出取消与迟到兼容click；均为无窗口隔离夹具，不等同于iOS系统联系人自动填充实测。

手机遥控使用 `pnpm test --run tests/phone-controller.test.ts` 校验有限协议、HTTP 授权、Host/Origin、大小与关闭换钥；`pnpm build` 同时生成独立手机资源。`node scripts/renderer-phone-controller-smoke.mjs` 验证两种桌面视口和320/390px手机页面、中文搜索、链接失败/打开、暂停、映射保存、长按取消及断开；媒体和桌面接口为夹具。`node scripts/desktop-phone-controller-smoke.mjs` 在始终隐藏的全新隔离 Electron 配置中，固定前台文档可见性测试真实 preload/IPC、原生服务和原创本地 MP4 解码，窗口不显示；可通过 `YINGJI_EXECUTABLE` 指向新打包的程序，验证实际交付目录。

安卓先构建并安装隔离调试 APK，再显式指定 `YINGJI_ANDROID_SERIAL=emulator-5556` 运行 `node scripts/android-phone-controller-smoke.mjs`；仅接受隔离 emulator，并核对 WebView66。该脚本通过 ADB 转发测试原生 TCP 服务、中文搜索接线、本地 MP4、暂停及 Activity 后台撤销，搜索使用固定空列表，未调用账号服务。两端真实解码测试均自动生成 `.tmp/phone-control-media/` 样片；ADB转发与无窗口手机浏览器不等同于实体手机 Wi-Fi 或电视验收。

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm package:dir # 当前系统的可运行目录
```

可选匿名 B 站真实播放验证：

```powershell
$env:YINGJI_LIVE_TEST='1'; pnpm smoke
```

```sh
YINGJI_LIVE_TEST=1 pnpm smoke
```

`node scripts/probe.mjs` 只读检查匿名视频解析、分区、影视和直播接口。测试生成的原创新样片、临时账号数据和截图仅放在 `.tmp/`。

`node scripts/browse-pagination-smoke.mjs` 使用隔离数据验证各栏目自动分页、搜索分类缓存、失败页重试与播放期间暂停预取；不读取日常账号，不代表真实影视解码。设置 `YINGJI_HEADLESS=1` 可在无窗口浏览器中运行相同分页夹具，不启动 Electron。

`node scripts/controller-workflows.mjs` 检查模拟手柄、上下文提示、重映射、嵌套屏幕键盘、失焦/重连和电视布局；`node scripts/frontend-interactions.mjs` 检查初始化重试、设置失败回滚/串行保存、队列失败、收藏焦点与过期扫码取消。桌面界面验证逐个运行，避免窗口争抢焦点；模拟输入不代表实体设备实测。

`node scripts/renderer-reliability-smoke.mjs` 在无界面浏览器中验证播放取消/返回、迟到刷新、详情操作可见性、收藏夹状态、播放设置及弹幕时间同步，不启动桌面窗口或发送系统输入。使用固定数据与模拟媒体事件，不代表实际解码或 Electron 桥验收；Windows 默认使用已安装 Edge，其他平台需要 Playwright Chromium。

`renderer-playback-smoke.mjs` 验证 1920×1080 电视和 1440×950 正常桌面的长标题展示/非焦点、按钮命中、弹幕及设置回焦；播放方向动作使用 `renderer-reading-actions-smoke.mjs`，七键操作使用 `renderer-remote-smoke.mjs`。均为无窗口隔离夹具，不包含窄窗口适配。

`node scripts/renderer-library-smoke.mjs` 使用隔离的文件选择与扫描夹具，验证导入取消、忙碌状态、保留列表与失败重试、空/重复选择及迟到结果不打断页面或播放。不会打开原生文件选择器或读取日常片库；`tests/local-library.test.ts` 另以 `.tmp/` 临时文件验证实际发现、去重和存储提交。

`node scripts/renderer-experience-smoke.mjs` 无窗口检查切栏落焦、迟到落焦取消、卡片大小及保存回滚、详情入口、返回焦点与直播封面；不代表实体设备、账号关注或真实直播解码。`node scripts/anonymous-content-probe.mjs` 通过实际生产 Provider 匿名探测指定影视分集与直播搜索封面，仅记录格式/权限和图片响应，不读取日常账号。

`node scripts/renderer-keyboard-smoke.mjs` 无窗口验证离线词库失败重试、拼音候选、中英切换、选区编辑、快捷删除/提交、取消、原生输入法及电视布局；`node scripts/renderer-recovery-smoke.mjs` 验证播完重播、重新解析与取消、队列写入/边界/删除焦点。均为隔离夹具，不发送系统输入。

`node scripts/renderer-collection-smoke.mjs` 无窗口检查详情操作忙碌焦点、重复提交门控、成功/失败状态、收藏面板收起、对应列表同步/刷新重试、移除后的相邻返回及迟到写入隔离；`renderer-collection-pages-smoke.mjs` 验证多页列表刷新期间不截断、晚页失败/重试和切页取消。账号使用模拟生成/刷新/断开，不改用户账号或真实平台收藏。

`node scripts/renderer-search-flow-smoke.mjs` 无窗口检查连续/缓存重复搜索、异步结果落焦、旧查询隔离、主动移动取消、空/失败操作落点及刷新/重试焦点。包含收藏夹读取重试与电视布局，接口及手柄为隔离夹具。

`node scripts/renderer-player-options-smoke.mjs` 无窗口检查播放器参数菜单、确认/取消、快捷键隔离、清晰度位置/速度及 B 返回层级；`renderer-dynamic-layout-smoke.mjs` 对照首页验证桌面/电视卡片尺寸、2–6 列设置、播放返回与完整正文。均使用模拟接口与手柄。

`node scripts/renderer-paused-quality-smoke.mjs` 无窗口检查切画质保留暂停/播放状态、延迟与失败恢复、协商实际画质及后续切集隔离；真实电影脚本另验证暂停后切画质与显式继续播放。

`node scripts/renderer-keyboard-controls-smoke.mjs` 无窗口检查空格确认及背景播放隔离；`renderer-input-caret-smoke.mjs` 在延迟绘制下检查选区替换、快速退格、连续插入与草稿取消。

`node scripts/renderer-candidate-focus-smoke.mjs` 无窗口检查桌面/电视候选确认后的普通返回、新 Tab/翻页/模拟手柄方向优先与 Start 分步提交；使用随包离线词库与隔离搜索接口，不发送系统输入。

`node scripts/renderer-overlay-focus-smoke.mjs` 无窗口延迟绘制检查播放器普通唤出、后续 Tab/模拟手柄方向优先、单集 X 定位及倍速回退、快速隐藏/退出；媒体和手柄为隔离夹具，不发送系统输入。

`node scripts/renderer-loading-rate-smoke.mjs` 无窗口延迟元数据，检查加载期间的倍速选择、清晰度位置/暂停保持和默认速度范围。真实电影脚本另通过延迟本机网关请求验证加载前选 2× 后的真实解码，不替换媒体内容。

`node scripts/renderer-loading-pause-smoke.mjs` 无窗口检查加载前的暂停/继续、Start/Space 最后意图、再次换画质、休眠、返回隔离与异步播放失败。真实电影脚本先在加载前暂停，释放原始媒体后验证稳定暂停，再显式继续解码。

`node scripts/renderer-player-interruption-smoke.mjs` 无窗口检查休眠取消待解析/保存/选集、新操作隔离和迟到队列取消。电影脚本通过既有休眠 IPC 验证隐藏窗口中的真实媒体暂停/继续，不实际休眠系统，不代表硬件唤醒验收。

`node scripts/renderer-completion-smoke.mjs` 无窗口检查播完时菜单/设置/队列及跳转编辑隔离、主动操作优先、重复事件、完成状态恢复与电视布局；媒体/手柄为夹具。`player-test-completion.mjs` 另在隐藏电影测试中定位真实片尾，等待原生结束并验证菜单/焦点保留及真实重播，不代表完整观看。

`node scripts/renderer-episode-shortcuts-smoke.mjs` 无窗口检查正常桌面/电视的选集快捷键隔离、默认/重映射暂停、播放/暂停/完成状态、方向/A、空格、X/B、焦点返回与退出；媒体及手柄为模拟。

`node scripts/renderer-live-controls-smoke.mjs` 无窗口检查直播速度、控件/快捷键、暂停/返回、设置、错误重试和点播/直播队列切换；媒体为夹具。已授权的隐藏账号电影测试额外设置 `YINGJI_TEST_LIVE_ROOM=1` 可真实打开关注首屏中正在直播的房间，检查解码帧、正常速度、暂停/返回/继续及默认设置；无正在直播的房间会记录未实播，仍清除加密副本。

`node scripts/renderer-fullscreen-smoke.mjs` 无窗口检查电视设置/原生事件同步、慢响应保焦与重复门控、过期查询及退出恢复；窗口和媒体为模拟。隐藏账号测试另检查实际全屏状态 IPC 和全屏/电视请求的隐藏保护，不进行真实窗口转场。

`node scripts/renderer-exit-smoke.mjs` 在桌面/电视无窗口环境延迟保存与窗口恢复，检查退出焦点及忙碌状态、原位置、操作/迟到事件隔离、错误返回和 B 层级。媒体、窗口与手柄为模拟，不代表真实磁盘延迟、实体设备或窗口转场。

`node scripts/renderer-buffering-smoke.mjs` 无窗口检查数据恢复后清除缓冲状态、保留播放/暂停及菜单焦点、未就绪/过期事件和直播；媒体与手柄为模拟。隐藏账号电影验证另延迟真实网关响应，定位远处并观察原生缓冲/恢复，保留实际媒体字节与账号权限。

`node scripts/renderer-restart-smoke.mjs` 无窗口检查播完/暂停和加载期间的从头播放、LB/Enter、后续暂停、普通续播和菜单隔离；媒体与手柄为模拟。隐藏电影脚本另验证原生片尾后 PageUp 重播及暂停时按钮重播的实际解码，保持同会话和画质/速度，不代表实体设备。

`node scripts/renderer-restart-preview-smoke.mjs` 无窗口检查明确重播清除旧跳转预览、后续 A 焦点动作及普通暂停/继续的预览保留，覆盖桌面默认和电视重映射；隐藏电影另验证实际预览撤销后的从头解码。

`node scripts/renderer-player-hints-smoke.mjs` 无窗口检查首集/末集快捷键名称、默认/重映射手柄、原生键盘、切换等待与菜单/隐藏/直播范围及正常桌面/电视提示边界；媒体和手柄为隔离夹具。

`node scripts/renderer-reading-actions-smoke.mjs` 无窗口检查标题/来源不占焦点、按钮和进度条的跳转优先级、确认/取消及隐藏后唤出，覆盖正常桌面/电视；媒体和手柄为隔离夹具。

`node scripts/renderer-timeline-controls-smoke.mjs` 无窗口检查正常桌面/电视的进度预览、确认/取消、移出/迟到松开、原生拖动、上下唤出与超时隐藏，以及直播/未就绪回退。`node scripts/renderer-pinyin-literal-smoke.mjs` 检查无候选拼写分步确认、混合后缀、词库等待和嵌套输入；均使用隔离媒体/账号接口和模拟手柄，不发送系统输入。

`node scripts/renderer-player-hit-stability-smoke.mjs` 无窗口验证鼠标/手柄/键盘切换、跳转提示、参数菜单和画质等待时的控件位置保持，以及首次原坐标点击和提示完整容量。媒体和手柄为模拟，不发送系统输入。

`node scripts/renderer-player-pointer-idle-smoke.mjs` 无窗口检查实际五秒超时下的鼠标停留/离开、延迟点击、B 隐藏、键盘/手柄解除保护及设置隔离；使用模拟媒体和手柄，不发送系统输入。

`node scripts/renderer-player-deactivation-smoke.mjs` 无窗口模拟窗口失焦/隐藏，检查鼠标停留保护解除、拖动取消及迟到释放、手柄/键盘预览保留、持键中立门控和参数菜单；不发送系统输入，不代表真实窗口切换或实体设备验收。

`node scripts/renderer-preview-ownership-smoke.mjs` 无窗口检查进度条指针归属与手柄/键盘预览隔离；隐藏账号电影测试另核对模拟指针前后真实位置、明确确认、暂停/倍速和继续解码，不发送系统输入。

隐藏电影测试成功/失败均写入本轮报告并记录清理，结果须结合当前退出码读取；`node scripts/movie-report-failure-smoke.mjs` 用不存在的隔离账号目录验证失败报告，在 Electron 启动前结束，不接触日常账号。

`node scripts/renderer-next-availability-smoke.mjs` 无窗口检查末集/空队列和直播的无效下一项、播完/重播、后续队列和分集未知解析；使用模拟媒体/手柄，不发送系统输入。

`node scripts/renderer-part-discovery-smoke.mjs` 无窗口检查未知分集补全、末项/选集更新、切集和切画质保持、失败重试及退出后的迟到隔离；媒体与手柄为模拟，不发送系统输入。

`node scripts/renderer-player-busy-focus-smoke.mjs` 无窗口检查切集/分集读取等待时保留焦点、失败重试、主动移动及重复确认门控，包含播放/暂停和无后续下一项；媒体/手柄为模拟。

`player-test-loading-restart.mjs` 属于隐藏电影测试：重新打开已保存续播的电影，在原网关被延迟、媒体未加载时暂停后从头播放，释放原媒体并检查实际从零解码，沿用账号隔离和清理规则。

`node scripts/renderer-seek-transition-smoke.mjs` 无窗口验证切画质等待期间指针/原生键盘/手柄跳转门控、保焦、成功/失败后恢复跳转及错误页指针；媒体和手柄为隔离夹具。

`node scripts/renderer-error-quality-smoke.mjs` 在无窗口环境验证错误页画质菜单、焦点/返回、精确恢复、等待/失败及正常桌面/电视布局；媒体和手柄为夹具。隐藏电影脚本另验证模拟错误后的真实 1080P 重试与 720P 恢复。

`node scripts/renderer-player-error-smoke.mjs` 无窗口检查错误停止、迟到事件、菜单/跳转收起和原位置重试；`renderer-engine-error-smoke.mjs` 用隔离引擎接口检查回调与释放。电影脚本在真实媒体上发送模拟错误事件，再真实解析/解码恢复；不将模拟故障称作真实解码故障。

`YINGJI_TEST_HIDDEN=1 node scripts/recommendation-smoke.mjs` 在隐藏、静音的隔离 Electron 中验证推荐夹具的顺序、缓存、串行加载和真实 VP8 样片播放；可用 `YINGJI_EXECUTABLE` 指向打包程序。检查窗口未显示/聚焦，不发送系统输入，不代表某个账号的实际推荐内容。

`YINGJI_LIVE_TEST=1 node scripts/pgc-playback-smoke.mjs` 验证《黑袍纠察队》匿名应用内解码、分集、切画质、续播和官方兼容 MP4；兼容分支通过模拟加密标志触发，不代表实际 DRM 解密。经用户明确授权后可使用 `YINGJI_TEST_ACCOUNT_DIR` 复用加密账号到隔离目录，测试不回写平台历史，结束后删除加密账号及密钥副本。

`YINGJI_LIVE_TEST=1 node scripts/movie-account-hidden.mjs` 使用隐藏、静音的 Electron 窗口检查《幸福终点站》的实际搜索播放、切画质/续播、指定分集以及关注封面；账号副本同样须明确授权。`YINGJI_EXECUTABLE` 可指定独立打包程序；不设置时运行当前生产构建。隔离模式只在同时设置测试目录和 `YINGJI_TEST_HIDDEN=1` 时生效，脚本确认窗口未显示/聚焦且未打开外部浏览器，结束删除加密凭证及密钥副本，不修改日常配置。


程序和预览使用同源绿色播放图标。修改 `public/app-icon.svg` 后可运行 `node scripts/build-app-icon.mjs` 重新生成透明 512 PNG；此可选工具使用无窗口浏览器，普通构建直接读取现有图标，平台格式由打包工具生成。

`node scripts/renderer-settings-parity-smoke.mjs` 无窗口检查四个设置分类的确认切换、上下落焦、两种验收尺寸无滚动及桌面/安卓相同配置的控件几何一致。`YINGJI_ANDROID_SERIAL=emulator-5556 node scripts/android-settings-layout-smoke.mjs` 仅接受显式隔离旧内核模拟器，保存匿名测试偏好后重启该测试进程，验证真实WebView66的四页布局及二维码，并在 `.tmp/android-settings-layout/` 留存截图；不连接实体设备。正式APK关闭调试，页面CDP检查使用 `.tmp/android-test/` 的显式测试构建。

玻璃与按钮验证见 [材质说明](glass-materials.md)。`renderer-glass-buttons-smoke.mjs`、`renderer-glass-compat-smoke.mjs` 使用无窗口浏览器检查双端按钮反馈与兼容层；`YINGJI_ANDROID_SERIAL=emulator-5556 node scripts/android-glass-smoke.mjs` 仅在显式隔离旧内核模拟器检查真实材质/七键反馈与原创样片播放。播放器位置、菜单与参数另运行现有命中稳定/菜单命中/参数选择脚本。
