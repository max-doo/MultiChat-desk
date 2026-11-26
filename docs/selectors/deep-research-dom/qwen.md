# Qwen (chat.qwen.ai) — Deep Research DOM аудит

> Проверено: 2026-11-18, Codex in-app browser (~753px, узкий)
> URL: https://chat.qwen.ai — **не залогинен** (кнопки 登录/注册 в шапке), composer доступен гостю.

## Текущая цепочка включения Deep Research (реальный DOM)

Старая структура — `button.tagBtn-*`/`data-log-name="tool_bar"`/`data-log-params*="deepResearch"`/`aria-label="研究"` в tool_bar под инпутом — **полностью убрана**. Сейчас:

- В composer один drop-down `button[aria-label="选择模式"]` («Выбор режима», рядом с надписью «自动»).
- Меню — `div[role="menu"].qwen-chat-v2-dropdown-menu-popup`; пункт исследования — `div[role="menuitem"].qwen-chat-v2-dropdown-menu-item.mode-select-common-item` с текстом **«深入研究»** (не «深度研究»).

```html
<button aria-label="选择模式">…</button>
<!-- после клика: -->
<div role="menu" class="qwen-chat-v2-dropdown-menu-popup qwen-chat-v2-dropdown-menu-popup-bottom-left">
  <div role="menuitem" class="qwen-chat-v2-dropdown-menu-item mode-select-common-item">
    <span>深入研究</span>
  </div>
  …  <!-- 上传附件 / Agent 模式 / 网页开发 / 生成图像 / 创建视频 / 网页搜索 / 深入研究 / 更多 -->
</div>
```

Пункт меню **без `data-log-*`, `aria-label`, `id`, tagBtn-классов** — только `role="menuitem"` + текст.

## Проверка каждого существующего селектора

### `researchMode.steps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `button[aria-label="研究"]` | miss | такой кнопки нет |
| `button.relative` | miss | класса нет |
| `button[data-log-name="tool_bar"][data-log-params*="deepResearch"]` | miss | `data-log-*` в документе отсутствуют (ни одного `data-log-name`) |
| `button[data-log-params*="deepResearch"]` | miss | — |
| `button.tagBtn-OADWVI` | miss | tagBtn-классы выпилены |
| text `['深度研究','研究']` | ⚠️ частично | текст «研究» встречается в «深入研究», но сам селектор `button/…` по-прежнему мисс — текста нет в `button`, пункт — `div[role="menuitem"]` в скрытом меню до клика на «选择模式» |

**Итог steps: 0/5 селекторов работают.**

### `researchMode.cancelSteps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `button[aria-label="研究"]` | miss | — |
| `button.selected-OsA38F[data-log-params*="deepResearch"] div…` | miss | — |

### `textarea`

| Селектор | Результат | Комментарий |
|---|---|---|
| `textarea.ant-input`, `textarea[placeholder*="向千问提问"]`, `textarea[placeholder*="输入"]`, `.chat-input textarea`, `textarea` | не проверено | на гостевой странице composer — `text entry area` (contenteditable, по AX) |
| `[contenteditable="true"]` | **hit** | редактор — contenteditable (AX показывает `text entry area`) |

### `sendButton`, `reportContainer`

Не проверено (нет сессии/запущенной задачи). `reportContainer` кандидаты (`iframe#deep-research-iframe`, `#pc-report-container`, `#qk-markdown-react`) — от прошлого UI, не подтверждены.

## Рекомендуемая замена (формат `AutomationStep`)

```ts
researchMode: {
  steps: [
    // шаг1: открыть меню выбора режима
    { selector: [
        'button[aria-label="选择模式"]',
        'button[aria-label*="模式"]',
        'button:has-text("自动")'
      ], delay: 500, menuOpenerFallback: true },
    // шаг2: пункт меню — div[role=menuitem] с текстом
    { selector: [
        'div[role="menuitem"]',
        '[role="menuitem"]',
        'button'
      ], regex: '深入研究|深度研究|Deep\\s*Research', wordBoundary: false,
      exclude: ['搜索', 'Search'], delay: 500 }
  ],
  cancelSteps: [
    // повторный клик по "选择模式" → тот же menuitem "自动" или повторный "深入研究" выключает;
    // из AX: в composer есть "自动" (aria-live состояние). Минимум:
    { selector: ['div[role="menuitem"]'], regex: '自动|Auto', wordBoundary: false,
      delay: 200, optional: true }
  ]
}
```

## Замечания

- Гостю (без логина) composer доступен и меню открывается; само исследование может требовать сессию — включение режима в UI доступно, но за отправку не отвечаем.
- Все старые зацепки (`tagBtn`, `data-log-*`, `aria-label="研究"`, `button.relative`) удалены из DOM.
- Единственные стабильные хуки сейчас: `aria-label="选择模式"` (opener) и `role="menuitem"` + текст «深入研究» (item).
