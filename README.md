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

技能一律安裝到對應 Codex 根目錄下的 `.codex/skills/<技能名稱>`；`.codex/skills/.system` 仍保留給 Codex 內建技能。從舊版重新安裝時，套件會將受管理的 `.agents/skills` 技能安全遷移到新位置。安裝完成後，CLI 會直接顯示實際代理與技能路徑。

## 設定

```sh
npx codex-model-router@latest install \
  --terra-reasoning high \
  --luna-reasoning xhigh \
  --sol-reasoning medium \
  --terra-fast
```

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

Fast 與思考等級是獨立設定，且僅保存到同一個子代理角色；不會影響主代理或其他角色。可用 `npx codex-model-router@latest status [--global]` 查看 `configured` 與 `effective`。目前 Codex 沒有每子代理 Fast 的執行階段控制，因此 `configured=true` 會明確顯示 `effective=not-supported`；安裝器不會啟用全域 `fast_mode`，也不會把 Fast 改寫成思考等級。

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
- Luna、Terra、Sol 都具備寫入能力，但只能由升級狀態與執行旗標授權寫入。
- Terra 負責企劃與獨立驗證。
- Sol 僅在驗證結果不是 PASS 時介入。
- 最終回覆一律回到主模型。

## 工作流程恢復契約

恢復是由主機提供的宣告式契約消費流程；套件不提供 JavaScript 執行階段 API、CLI 或子代理程序持久化。主機提供有效角色、目前主模型、executor 與拓撲；超過兩個子代理槽位時回報 `EVIDENCE_GAP`，不採取未證實動作。

狀態檔固定為 `RECOVERY_STATE_PATH=<ARTIFACT_DIR>/recovery-state.v1.json`。登錄是根層 `{version?, root_session_id, workflow_id, agents:{[role]:{agent_id,status,handoff}}, diagnostics?}`；`agents` 必須是以角色為 key 的物件，不得是陣列，也不得巢狀 `root`/`workflow`。只使用精確 ID；未知或模糊的 ID 不得替換。相同主模型、停用、無效（政策無效）、主模型切換或多餘實例一律 `removed-by-policy`；其餘每個已保存實例恰有一個結果：`reused`、`replaced`、`removed-by-policy`、`resume-failed`、`not-supported`、`stale-workflow` 或 `invalid-agent-id`。

只有主機確認實例遺失、關閉、無效、該實例不支援或恢復失敗，且主機明確建立新實例並獲政策允許時才可替換；handoff 必須原樣保留。主模型所在主線程（不論選定模型）負責登錄載入、原子持久化與 runtime 協調；Terra/Sol 子角色及企劃僅讀取登錄，Luna 只負責 workspace/PLAN 寫入。寫入使用同目錄暫存檔的 flush、close、rename 原子順序；任一步驟失敗便保留先前登錄、不發布 partial state，也不執行相依動作。這些是模板契約測試，不是 live E2E。

## 工作流程升級狀態機

每個 task 另以 `WORKFLOW_STATE_PATH=<ARTIFACT_DIR>/workflow-state.v1.json` 持久化 task-scoped 狀態，與 recovery registry 分離。狀態包含 workflow/root ID、需求/證據/企劃版本、目前 stage、最新 verdict、主模型、Sol 審查失敗次數、Terra 執行次數、三個執行旗標、active role IDs、所有角色 ownership 與 `blocked_reason`。同一工作流程切換主模型不重置版本、計數、stage 或停用旗標；新 workflow 才建立初始狀態。

Stage 單調為 `INITIAL` → `SOL_REPLAN_WITH_LUNA` → `SOL_PLAN_REVIEW_WITH_TERRA` → `SOL_FULL_TAKEOVER`。`PASS` 終止；`EVIDENCE_GAP`/`REQUIREMENT_CLARIFICATION` 留在原 stage 且不嘗試執行或增加計數；只有 `FAIL_PLAN`/`FAIL_IMPLEMENTATION` 推進。Luna/Terra 主模型先由 Terra 規劃審查、Luna 執行；primary Sol 的 INITIAL 不建立 Luna，只使用 Terra 子代理。Luna 首次停用後 Terra 最多執行兩次，仍失敗便永久停用 Terra 並由 Sol 接管。

所有角色 TOML 具 workspace-write 能力，但寫入由 stage 與旗標限制：Sol 在 `SOL_FULL_TAKEOVER` 前唯讀，停用的 primary 永久為 coord-only；最多兩個子代理、不得建立與主模型同模型的 child，且只在 stage 要求時 spawn。主線程負責 atomic flush/close/rename；失敗時保留先前狀態、不發布 partial state、不執行相依動作。這是主機消費的 declarative contract，不提供 runtime API、CLI 或 live E2E。

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
