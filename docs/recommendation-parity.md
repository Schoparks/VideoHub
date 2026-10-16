# BewlyCat App 推荐对照

本次只校正映集已选择的 **App 推荐分支**。对照固定版本 [9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa](https://github.com/keleus/BewlyCat/tree/9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa)，独立实现接口合同与推荐数据处理行为，不将插件实现代码打包进桌面应用。

2026-10-04 安卓电视沿用同一 Provider、协议配置、账号及列表会话，原生 HTTP 只替换网络传输，不增加移动端参数、排序、过滤或 Web 推荐降级。现有合同回归与隐藏推荐冒烟继续通过；本轮没有进行 Android 登录账号的真实推荐列表验收。

## 实际请求

GET `https://app.bilibili.com/x/v2/feed/index`。需要同时阅读 [API 声明](https://github.com/keleus/BewlyCat/blob/9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa/src/background/messageListeners/api/video.ts#L44) 和 [调用时覆盖](https://github.com/keleus/BewlyCat/blob/9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa/src/contentScripts/views/Home/components/ForYou.vue#L1606)，不能只使用声明里的默认值。

| 参数 | 当前中文界面的最终值 |
|---|---|
| build | 74800100 |
| device | pad |
| mobi_app | iphone |
| c_locate | zh-Hans_CN（上游拼写就是 locate） |
| s_locale | zh-Hans_CN |
| idx | 首次/刷新为 1，此后取实际保留列表最后一张卡片的原始 idx |
| appkey | 4409e2ce8ffd12b8，即实际调用覆盖的 TVAppKey |
| access_key | 当前账号 App token |

不添加 `platform`、`c_locale`、`pull`、`flush`、`column`、`sign` 或 WBI 字段。沿用桌面浏览器 User-Agent，不伪装 iOS App；Referer 为 `https://www.bilibili.com/`。参照上游 `credentials: include`，有网页登录 Cookie 时正常携带。GET 超时 20 秒。

撤销此前自行添加的 phone、iOS User-Agent、错误地区字段、pull 参数，以及错误使用 API 静态 iPhone App Key 的做法。

## 卡片与请求调度

依据 [ForYou.vue App 分支](https://github.com/keleus/BewlyCat/blob/9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa/src/contentScripts/views/Home/components/ForYou.vue#L1552)：

- 默认用户过滤关闭。基础过滤仅排除 `card_type` 含 `banner`、等于 `cm_v1`，以及既没有正数 `args.aid` 也没有非空 `bvid` 的卡片。
- 不增加 `goto=av` 限制，不另按 `ad_info`、`banner_item` 或 `is_ad` 丢卡。
- 去重按原始 `args.aid` 相等或原始 `bvid` 相等，保留上游默认分支中两个缺失字段也相等的行为，不自行改成更宽松的去重。
- 按接口返回次序追加，不重新排序。尾部被丢弃的卡片不推进下一批 idx。
- Provider 每次处理一批，界面串行补至至少 30 条且存在滚动区域；后续每轮补至少 30 条新增数据。距离底部不超过一屏时预取，滚动检查按上游 100 毫秒去抖；后台页面停止追加预取。
- 非零业务响应、空数据及网络错误最多尝试 3 次，重试窗口 5 秒，间隔 250/500 毫秒；`62011` 立即提示 App 重新授权。
- 非空响应经过过滤/去重后连续 5 批没有新增即停止；有新增就重置计数。
- 刷新清空当前推荐和空批计数，从 idx=1 开始。首页与 B 站页继续共享映集的同一个 App 推荐会话。

## 验证与范围

`tests/bewlycat-recommendation.test.ts` 固定完整查询参数、请求头/凭证、游标、过滤、原始去重语义、重试及结束条件；现有推荐测试也已移除 phone/pull 等错误断言。`scripts/recommendation-smoke.mjs` 用隔离数据验证界面的连续加载、预取、刷新与缓存。

各栏目统一自动分页后，推荐继续使用上述累计结果和 30 条补批合同，不经过非推荐分页合并器。界面取消手动“加载更多”，追加失败可就地重试原请求；准备播放时暂停预取。推荐隔离冒烟已适配加载状态标记，合同断言保持。

原插件还包含 Web/无 Cookie 模式、可选用户过滤器及失败时切换 Web 的设置。这些不属于映集当前选定的 App 推荐分支，映集不会静默把 App 推荐替换成 Web 推荐。宿主浏览器的实际 User-Agent、Cookie 集合以及同一账号不同时间的服务端响应无法由固定数据测试证明完全相同；仍需登录账号对照实际推荐。
