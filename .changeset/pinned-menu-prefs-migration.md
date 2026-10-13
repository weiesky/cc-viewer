---
"cc-viewer": patch
---

feat(web): 汉堡菜单「钉住」持久化从 localStorage(`ccv_pinnedMenuKeys`,JSON 字符串)迁移到 preferences.json 的 `pinnedMenuKeys`(真数组,顺序=钉住先后),跨浏览器/设备一致,并随「项目独立配置」fork 到项目作用域(跟随默认,服务端零改动)。首启一次性迁移:preferences 缺该键而 legacy localStorage 有值 → 写回并清理旧键;服务端已持有权威数组时直接清理遗留旧键(防死数据复活)。初值不用 legacy 乐观种子、恒从空开始等权威水合(pins 晚一个 RTT 出现),杜绝陈旧种子覆盖他端 pin;水合窗口内用户已 toggle 时,迟到的初始 GET 不回退其操作(`_pinnedTouched` 闩锁 + `_prefsHydrated` 门控,用户 POST 落盘后才开闸;该 POST 对服务端当前值为整数组 LWW 覆盖,窗口仅一个 RTT,为已接受的取舍),全部写回经 `_persistQueue` promise 链串行化(乱序会丢 pin)且链自愈;GET 失败按 logDir stamp 判别、保留现状不清旧键。日志模式(isLocalLog)统一走 preferences,不再保留 localStorage 双轨。Coverage: `pinned-menu.test.js`, `pinned-menu-prefs-migration.test.js`.
