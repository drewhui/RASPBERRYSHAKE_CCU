# 系統架構

這個網站背後是一套跑在 Raspberry Pi 4 上的簡化版地震早期預警(EEW)系統,核心是
[Earthworm](http://www.earthwormcentral.org/)8.0——地震學界行之有年的開源即時
地震資料處理框架,用 Docker 容器化部署(ARM64)。系統即時接收 RaspberryShake
RE81D 地震儀的資料,同時跑三層告警(單站 onsite 快報、測站即時震度、多站協同的
網路型 EEW 解算)。**這個網站顯示的 PGA / PGV / 波形,是這套系統其中一條資料支
線的公開輸出**,不是獨立產品。

## 資料來源

- **RaspberryShake RE81D**(RS1D 型號,單一垂直分量檢波器,100 sps):跟 Pi 在
  同一個區域網路,透過 SeedLink 協定即時串流波形。這是本站顯示資料的來源。
- **IRIS 遠端測站**(中央氣象署寬頻地動觀測網 TW 網 + IU 網 TATO 站):透過網際
  網路連到 IRIS 的 SeedLink 伺服器拉取即時資料,提供多站定位/規模估算所需的額
  外測站。這些站不是本站顯示的對象,但跟 RaspberryShake 共用同一套 Earthworm
  處理鏈。

## Earthworm 核心架構

Earthworm 用「共享記憶體環(ring)+ 多個獨立小程式(module)」的模型運作:每個
module 是一個獨立 process,讀寫特定的 ring,彼此不直接呼叫,靠 ring 裡不同類型
的訊息(波形、pick、事件⋯)溝通。這個系統目前跑的 module(依啟動順序):

| Module | 角色 |
|---|---|
| `statmgr` | 系統心跳 / 健康監控 |
| `slink2ew` ×2 | SeedLink 客戶端,一個接 IRIS 遠端測站、一個接本地 RaspberryShake,寫入 `WAVE_RING` |
| `pick_ew` | 波形挑波(picking):STA/LTA 演算法即時偵測 P 波到時,同時算出 onsite 快報用的 Pa/Pv/Pd/τc,寫入 `PICK_RING` |
| `tcpd` | 多站協同(coincidence)關聯:比對多個測站的 P 波 pick,達到門檻站數才組成一組事件解,估算震央位置與規模(Mpd,由 Pd 反推),寫入 `EEW_RING` |
| `dcsn_xml` | 把 `tcpd` 的事件解格式化成 EEW 警報 XML |
| `wave_serverV` | 波形環狀歸檔,提供近期波形給外部工具(如 Swarm)查詢 / 繪圖 |
| `diskmgr` / `copystatus` | 磁碟空間管理、狀態訊息轉發到 `HYPO_RING` |

用到的 ring:`WAVE_RING`(波形)、`PICK_RING`(pick 結果)、`EEW_RING`(EEW 事件
與警報)、`HYPO_RING`(狀態彙整)。

## 資料流程(RaspberryShake → 這個網站)

```
RaspberryShake RE81D (SHZ, 100sps)
        │  SeedLink
        ▼
   slink2ew (第二個實例,只接這一台)
        │  TYPE_TRACEBUF2
        ▼
     WAVE_RING ──────────────┬─────────────────────────┐
        │                    │                          │
        ▼                    ▼                          ▼
    pick_ew              tcpd → dcsn_xml          station_watch.py
 (P波挑波 + onsite)      (多站定位/規模,          (即時 PGV/PGA、
   寫入 PICK_RING           寫 EEW_RING)              CWB 震度)
        │                                                │
        ▼                                                ▼
  onsite τc-Pd 快報                              本站快照 + 趨勢 + 逐日封存
  (單站,最快)                                              │
                                                            ▼
                                            dashboard_push.sh(host,每分鐘)
                                                    rsync + git push
                                                            │
                                                            ▼
                                              GitHub → GitHub Pages(本站)
```

## 三層告警(由快到慢,由單站到多站)

1. **Onsite τc-Pd 快報**——`pick_ew` 每完成一個 P 波 pick 就順便算出
   Pa/Pv/Pd/τc,套用 Wu & Kanamori 準則(Pd、τc 同時超過門檻)判斷是否可能是
   具破壞力的地震。單一測站、P 波到站後數秒內就有結果,是最快但誤報率也最高
   的一層。
2. **測站即時震度**——自訂的 `station_watch.py`(不是 Earthworm 內建,用 PyEW
   直接讀 `WAVE_RING`)即時把每個測站的原始計數值換算成地動速度,量測 PGV,
   再微分成 PGA,對照中央氣象署 2020 震度分級表。這是「量出來的」不是預測,
   不會錯,只受限於資料延遲(本地 RaspberryShake 約 1–2 秒,IRIS 遠端站約
   10–20 秒)。
3. **網路型 EEW**——`tcpd` 需要多個測站的 P 波 pick 互相吻合(到時、距離都在
   門檻內)才會組成一組解,`dcsn_xml` 再把解算結果轉成正式 XML 警報。這層最
   穩定(多站交叉驗證),但也最慢,且需要數個測站同時觸發才能運作——單靠這
   一台 RaspberryShake 無法獨立完成。

## 這個網站的資料怎麼來

上面第 2 層的 `station_watch.py`,除了發告警,也把 RaspberryShake(RE81D)這
一站的資料獨立寫成給這個網站用的檔案:

- 每秒寫一次目前 PGV / PGA / 震度 + 最近 20 秒波形(`data/snapshot_RE81D.json`)
- 每 30 秒記一筆趨勢點,存最近 24 小時(`data/history_RE81D.json`)
- 每天累積一份逐筆歷史封存,存最近 90 天(`data/archive/RE81D_YYYY-MM-DD.jsonl`)

Pi 上的 cron(每分鐘一次)把這些檔案同步進這個 repo 並推送,觸發 GitHub Pages
重新部署;震度達到告警門檻時另外會發一則 Discord 通知。GitHub Pages 的 CDN 對
資料檔另有最長 10 分鐘快取,實際顯示會落後現況約 1–11 分鐘,細節見首頁頁尾。

## 已知限制

- RaspberryShake RE81D 是 RS1D 型號,硬體上只有一個垂直分量檢波器,沒有水平
  分量、沒有強震型加速度計——4 級以上的量測可能因訊號削波而失真。
- 測站位置只標示大略城市,不公開精確座標。
- 網路型 EEW 需要多個測站同時觸發,單靠這一台 RaspberryShake 無法獨立完成
  定位 / 規模估算,那一層的解算結果不在這個網站顯示範圍內。
