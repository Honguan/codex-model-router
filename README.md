# codex-model-router

[繁體中文](README.md)｜[English](README.en.md)

安裝一套以證據為優先的 Codex 工作流程，由 Terra、Luna 與 Sol 分工，同時保留使用者選擇的主模型與其他無關的 Codex 設定。

> 路由屬於建議性機制。Codex 會讀取已安裝的代理與技能，再自行決定何時委派。本套件不攔截提示詞，也不保證強制切換模型。

## 安裝

安裝到目前專案：

```sh
npx codex-model-router@latest install
```

安裝到目前使用者：

```sh
npx codex-model-router@latest install --global
```

啟用套件管理的多代理 V2：

```sh
npx codex-model-router@latest install --v2
```

目前使用者範圍請搭配 `--global --v2`。安裝完成後重新啟動 Codex。

### Codex 安裝位置

| 範圍 | 代理定義 | 使用者技能 |
| --- | --- | --- |
| 專案 | `<專案>/.codex/agents` | `<專案>/.agents/skills` |
| 目前使用者 | `~/.codex/agents` | `~/.agents/skills` |

`~/.agents/skills` 是 Codex 使用者技能位置。`~/.codex/skills/.system` 只放 Codex 內建技能；該資料夾只有 `.system` 屬於正常情況，不應把本套件的自訂技能複製進去。安裝完成後，CLI 會直接顯示實際代理與技能路徑。

## 設定

```sh
npx codex-model-router@latest install \
  --terra-reasoning high \
  --luna-reasoning xhigh \
  --sol-reasoning medium
```

| 選項 | 用途 |
| --- | --- |
| `--set-default` | 將 Terra／high 設為預設主模型 |
| `--agent-reasoning <level>` | 設定全部受管理代理的思考等級 |
| `--terra-reasoning <level>` | 設定 Terra 思考等級 |
| `--luna-reasoning <level>` | 設定 Luna 思考等級 |
| `--sol-reasoning <level>` | 設定 Sol 思考等級 |
| `--v2` | 啟用或修復套件管理的 V2 |
| `--global` | 套用到目前使用者 |

可用思考等級：`none`、`low`、`medium`、`high`、`xhigh`、`max`。

## 圖解說明

所有圖表預設摺疊，點擊標題後展開。

<details>
<summary><strong>角色、模型、權限與職責</strong></summary>

![Codex Model Router 角色圖](docs/images/zh-TW/roles.png)

</details>

<details>
<summary><strong>標準主流程總覽</strong></summary>

![Codex Model Router 主流程總覽](docs/images/zh-TW/workflow-overview.png)

</details>

<details>
<summary><strong>模型使用占比估算</strong></summary>

![模型使用占比估算](docs/images/zh-TW/model-usage-share.png)

</details>

<details>
<summary><strong>流程外的主模型問答情境</strong></summary>

![主模型問答情境](docs/images/zh-TW/primary-qa-scenarios.png)

</details>

<details>
<summary><strong>情境 A：主模型為 Sol</strong></summary>

![主模型為 Sol 的工作流程](docs/images/zh-TW/primary-sol.png)

</details>

<details>
<summary><strong>情境 B：主模型為 Terra</strong></summary>

![主模型為 Terra 的工作流程](docs/images/zh-TW/primary-terra.png)

</details>

<details>
<summary><strong>情境 C：主模型為 Luna</strong></summary>

![主模型為 Luna 的工作流程](docs/images/zh-TW/primary-luna.png)

</details>

## 核心規則

- 同一個工作流程不重複啟動相同模型代理。
- 主模型與代理角色相同時，由主線程直接完成該角色工作。
- Luna 是唯一可寫入的角色。
- Terra 負責企劃與獨立驗證。
- Sol 僅在驗證結果不是 PASS 時介入。
- 最終回覆一律回到主模型。

## V2 行為

```text
install --v2  → 啟用 V2；已追蹤的標記區塊被修改時自動修復
install       → 停用未被修改的套件管理 V2
uninstall     → 移除路由器與未被修改的受管理 V2
```

再次明確執行 `install --v2` 時，若套件狀態仍存在且只有套件標記內的 V2 內容被修改，安裝器只會重建該標記區塊、更新雜湊並保留其他 TOML。既有未受管理、缺少狀態、標記不完整或標記重複的 V2 設定仍會保留並停止操作，避免誤覆寫。

## 移除

從目前專案移除：

```sh
npx codex-model-router@latest uninstall
```

從目前使用者移除：

```sh
npx codex-model-router@latest uninstall --global
```

## 安全性

- 保留無關的 TOML、註解、BOM、排序與 LF／CRLF。
- 使用路徑驗證、範圍鎖定、原子交易與回滾。
- 除了明確執行 `install --v2` 時重建套件標記的 V2 區塊，不覆寫其他使用者修改的受管理檔案。
- 不修改 `AGENTS.md`、Shell Profile、編輯器設定、Hooks、MCP 伺服器、帳號、遙測或環境變數。

## 系統需求

- Node.js 18 以上。
- 支援自訂代理與本機技能的 Codex。
- 可使用 `gpt-5.6-terra`、`gpt-5.6-luna` 與 `gpt-5.6-sol`。
- Windows、Linux 或 macOS。

安全性問題請參閱 [SECURITY.md](SECURITY.md)。維護者發佈流程請參閱 [MAINTAINERS.md](MAINTAINERS.md)。
