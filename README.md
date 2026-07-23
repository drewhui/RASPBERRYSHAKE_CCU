# RaspberryShake 即時地震監測

單一 RaspberryShake 地震儀（RS1D,單一垂直分量檢波器）的公開監測頁面,顯示：

- 即時 PGA(最大地動加速度)、PGV(最大地動速度)、CWB 2020 震度等級估算
- 最近 20 秒垂直分量波形
- 近 24 小時 PGA / PGV 趨勢

線上頁面：<https://drewhui.github.io/RASPBERRYSHAKE_CCU/>

## 資料如何更新

這是純靜態網站(GitHub Pages,沒有後端)。地震儀主機每分鐘 commit + push 一次
資料快照到這個 repo,觸發 Pages 重新部署;GitHub Pages 的 CDN 對 `data/*.json`
另外有最長 10 分鐘的快取,所以頁面實際顯示可能落後現況約 1–11 分鐘。**不是
逐秒即時**,更新間隔以頁面上顯示的「最後同步」時間為準。

## 歷史資料

`data/snapshot_RE81D.json`、`data/history_RE81D.json` 只保留最近 24 小時(每次
整份覆蓋)。更久的資料在 `data/archive/RE81D_YYYY-MM-DD.jsonl`,按日分檔、逐筆
附加(每行一筆 `{t, pgv, pga, level}`),只保留最近 90 天,超過的日期檔案會被
刪除(容量有上限,不是無限累積)。

## 資料範圍與限制

- 震度數值為現場實測值換算(非官方氣象署發布資料),測站型號僅有垂直分量檢波器
  (無水平分量、無強震加速度計),4 級以上量測可能因訊號削波而失真。
- 測站位置僅標示大略城市,不公開精確座標。
- 僅供個人觀測與展示用途,不作為正式地震速報使用。

## 檔案結構

```
index.html            頁面
assets/app.js          資料抓取 + 圖表渲染(純 vanilla JS,無外部套件)
assets/style.css        樣式
data/snapshot_*.json    最新快照(自動更新,手動編輯會被覆蓋)
data/history_*.json     近 24 小時趨勢(自動更新,手動編輯會被覆蓋)
data/archive/*.jsonl    按日分檔的歷史原始資料,近 90 天(自動更新,手動編輯會被覆蓋)
```
