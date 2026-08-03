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
| 專案 | `<專案>/.codex/agents` | `<專案>/.codex/skills` |
| 目前使用者 | `~/.codex/agents` | `~/.codex/skills` |

技能安裝到對應 Codex 根目錄的 `.codex/skills/<技能名稱>`；重裝時會安全遷移受管理的舊版技能，CLI 會顯示實際路徑。

## 設定

```sh
npx codex-model-router@latest install \
  --terra-reasoning medium \
  --luna-reasoning xhigh \
  --sol-reasoning medium \
  --terra-fast
```
未指定 `--terra-reasoning` 時，受管理的 Terra child 預設使用 `medium`。

| 選項 | 用途 |
| --- | --- |
| `--set-default` | 將 Terra／high 設為預設主模型 |
| `--agent-reasoning <level>` | 設定全部受管理代理的思考等級 |
| `--terra-reasoning <level>` | 設定 Terra 思考等級 |
| `--luna-reasoning <level>` | 設定 Luna 思考等級 |
| `--sol-reasoning <level>` | 設定 Sol 思考等級 |
| `--agent-fast`／`--no-agent-fast` | 對所有受管理子代理設定 Fast 偏好；個別角色選項優先 |
| `--terra-fast`／`--no-terra-fast` | 設定 Terra 的 Fast 偏好 |
| `--luna-fast`／`--no-luna-fast` | 設定 Luna 的 Fast 偏好 |
| `--sol-fast`／`--no-sol-fast` | 設定 Sol 的 Fast 偏好 |
| `--v2` | 啟用或修復套件管理的 V2 |
| `--global` | 套用到目前使用者 |

可用思考等級：`none`、`low`、`medium`、`high`、`xhigh`、`max`。

Fast 與思考等級分開，且只保存到同一個 child role，不影響 primary 或其他角色。用 `status [--global]` 查看設定；目前 Codex 不支援每個 child 的 Fast runtime control，因此 `configured=true` 會顯示 `effective=not-supported`。

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
<summary><strong>企劃檔持久化與清理流程</strong></summary>

```mermaid
flowchart TD
    A[Terra 或 Sol 回傳企劃內容] --> B{目前有可寫入 executor？}
    B -->|否| C[保留 self-contained in-memory artifact\n不宣稱已寫入]
    B -->|是| D[原子寫入\n<CODEX_ROOT>/model-router/workflows/<workflow_id>/PLAN.md]
    D --> E[狀態：active\n保存 plan_path 與 owner]
    E --> F{驗證 PASS？}
    F -->|否／阻塞／恢復／切換| G[保留相同路徑、版本與 owner]
    F -->|是| H[狀態：pending-cleanup]
    H --> I[同一 cleanup owner\n僅移除該 workflow 目錄]
    I -->|成功| J[狀態：removed]
    I -->|失敗| K[狀態：cleanup-failed 並回報]
```

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
- 寫入權由 stage 與 Luna mode 控制；`luna_execution_enabled` 僅供 migration，不能取代 mode。
- Terra 規劃並獨立驗證；Sol 在非 `PASS` 後介入。
- Luna 在同一 root session/workflow 保留同一個 `luna_role_id`；降級後以 `INTERACTION_ONLY` 執行受 stage 授權的 canonical action IDs。
- 最終回覆一律回到主模型。

## 多代理工作流程總覽

![多代理工作流程總覽](docs/images/zh-TW/multi-agent-workflow-overview.png)

## V2 行為

```text
install --v2  → 啟用 V2；已追蹤的標記區塊被修改或遺失時自動修復
install       → 停用未被修改的套件管理 V2
uninstall     → 移除路由器與未被修改的受管理 V2
```

再次明確執行 `install --v2` 時，若套件狀態仍存在且套件標記內的 V2 內容被修改或整個受管理區塊遺失，安裝器會重建該標記區塊、更新雜湊並保留其他 TOML。既有未受管理、缺少狀態、標記不完整或標記重複的 V2 設定仍會保留並停止操作，避免誤覆寫。

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
