# Task Tracker CLI

一個使用 Node.js 18+ 建置的簡易持久化待辦事項命令列工具。它只使用 Node.js 內建模組，不需要安裝外部相依套件。

## 開始使用

需要 Node.js 18 或更新版本。下載專案後可直接執行指令，或執行完整測試：

```text
npm test
```

## 指令

```text
node src/cli.js add --title "Buy milk"
node src/cli.js add --title="Buy milk"
node src/cli.js list
node src/cli.js list --status pending
node src/cli.js list --status=completed
node src/cli.js list --status all
node src/cli.js done 1
node src/cli.js remove 1
node src/cli.js stats
```

`list` 可用狀態為 `pending`、`completed` 與 `all`；未提供時預設為 `all`。成功訊息會寫至標準輸出，無效指令、無效參數及儲存錯誤會寫至標準錯誤，並以非零結束碼結束。

## 儲存資料

正常使用時，資料會儲存在目前工作目錄的 `.data/tasks.json`，內容是人類可讀、以兩個空格縮排的 JSON 陣列。目錄與檔案會在首次寫入時自動建立。`.data/metadata.json` 記錄最後派發的 ID，使移除任務後的 ID 仍永不重複。

若任一資料檔不存在，會視為空儲存；空檔、無效 JSON、非陣列資料、無效任務物件或無效 ID 中繼資料都會被拒絕，不會被靜默重設或覆寫。

寫入時會先在相同目錄建立並關閉唯一名稱的暫存檔，再以重新命名取代目的檔案。這可避免正常寫入失敗造成不完整的目的 JSON，但不宣稱提供磁碟耐久性保證。每個變更指令都會在修改前重新載入資料；若多個寫入程序剛好同時執行，仍可能發生最後寫入者覆蓋先前變更，因為此工具不使用分散式鎖定。

測試或隔離執行可設定 `TASK_TRACKER_DATA_DIR` 指向其他資料目錄，正常行為不受影響。

## 完整流程範例

```text
node src/cli.js add --title "Buy milk"
node src/cli.js add --title "Write report"
node src/cli.js list
node src/cli.js done 1
node src/cli.js list --status pending
node src/cli.js list --status completed
node src/cli.js stats
node src/cli.js remove 2
node src/cli.js add --title "Call supplier"
```

最後新增的任務會取得新 ID，即使先前的任務已移除。

## 專案結構

```text
src/cli.js          命令分派、輸出與結束碼
src/arguments.js    參數與選項解析
src/task-service.js 業務規則與狀態轉換
src/task-store.js   資料驗證與原子檔案寫入
src/errors.js       預期應用程式錯誤類型
test/               內建 node:test 測試
```
