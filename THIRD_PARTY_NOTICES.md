# 参考来源与第三方依赖

## BewlyCat 协议行为参考

- 项目：https://github.com/keleus/BewlyCat
- 核对提交：`439845606212cbc62a6f17b97eac5327d91ec8db`（2026-09-26）
- App 推荐本次复核：`9d0b0c6683fc88ac8f19f15d1780cdb6eaecfdfa`；以实际调用覆盖后的参数为准，详见 `docs/recommendation-parity.md`。
- App 推荐配置：`src/background/messageListeners/api/video.ts`
- App 推荐调用、分页、默认过滤和去重：`src/contentScripts/views/Home/components/ForYou.vue`
- 通用请求与超时：`src/background/utils.ts`、`src/background/requestTimeout.ts`
- TV 扫码与令牌刷新通路：`src/utils/authProvider.ts`
- 排行榜、直播和影视接口：`src/background/messageListeners/api/`
- 许可证：https://github.com/keleus/BewlyCat/blob/439845606212cbc62a6f17b97eac5327d91ec8db/LICENSE

该版本为自定义许可证，明确限制将项目及其派生代码用于独立客户端。本仓库没有复制或打包其插件、Vue 组件、样式或实现代码，仅独立实现公开的 B 站协议事实、参数配置与行为。界面为独立实现。没有将 `iphone + pad` 声称为完全复现某台手机此刻的推荐列表。

协议研究参考：

- https://github.com/pskdje/bilibili-API-collect/blob/main/docs/misc/sign/wbi.md
- https://sessionhu.github.io/bilibili-API-collect/docs/misc/sign/wbi.html

App key/secret 为客户端公开协议常量，不是用户账号凭证。真正的账号凭证仅通过用户扫码取得。

## 离线拼音词库

搜索屏幕键盘使用 AOSP PinyinIME 的简体词条数据，许可证为 Apache-2.0。

- 来源：[AOSP 原始词库](https://android.googlesource.com/platform/packages/inputmethods/PinyinIME/+/49aebad1c1cfbbcaa9288ffed5161e79e57c3679/jni/data/rawdict_utf16_65105_freq.txt)。固定提交 `49aebad1c1cfbbcaa9288ffed5161e79e57c3679`。
- 转换：保留简体条目，按原始词频降序排列，拼接音节，将 UTF-16 转为 JSON；共 55,320 条，不打包上游输入法实现。
- `scripts/build-pinyin-dictionary.mjs` 可重建资源。`public/ime/SOURCE.json` 记录原始数据 SHA-256、提交及转换；`public/ime/NOTICE.txt` 保留上游版权和许可证，两份文件随资源打包。
- 拼音索引及界面独立实现，运行时读取本机随包词库，不向第三方输入服务发送搜索文字。

## 主要依赖

Electron (MIT)、React (MIT)、Vite (MIT)、TypeScript (Apache-2.0)、dash.js (BSD-3-Clause)、hls.js (Apache-2.0)、mpegts.js (Apache-2.0)、@xmldom/xmldom (MIT)、qrcode (MIT)、Lucide (ISC)、Zod (MIT)、Playwright (Apache-2.0)、Vitest (MIT)、electron-builder (MIT)。准确版本与传递依赖以 `pnpm-lock.yaml` 及各依赖内 LICENSE 为准。Electron 发行包含 Chromium 等自身的许可证清单。

旧电视兼容使用 core-js (MIT)、Graphemer (MIT)、resize-observer-polyfill (MIT)、WICG inert (W3C Software and Document License)、JSBI (Apache-2.0)。版本以锁文件为准，原始许可证通过同一生产依赖遍历随 APK 分发；Android SDK 测试样片及下载的测试浏览器不进入 APK。

安卓 APK 不包含 Electron 运行时，由设备提供 Android System WebView；Android SDK/构建工具和模拟器仅用于开发，不随应用分发。`scripts/android-licenses.mjs` 将生产依赖及其传递依赖的原始 LICENSE/NOTICE 文本打包到 APK 的 `assets/web/licenses/`，同时保留本说明及离线拼音来源/NOTICE；该目录包含完整生产依赖树的通知，实际代码以构建使用模块为准。

### @xmldom/xmldom

用于读取和重写第三方网页的 DASH XML 清单，版本 0.9.12，项目：https://github.com/xmldom/xmldom 。以下 MIT 许可随应用打包：

Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors
Copyright 2012 - 2017 @jindw <jindw@xidea.org> and other contributors, as listed in: https://github.com/jindw/xmldom/graphs/contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

B 站品牌、图片、视频与账号内容归各自权利人所有；应用不提供预装第三方视频资源，也不实现付费、DRM 或地域限制绕过。
