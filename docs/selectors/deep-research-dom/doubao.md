# Doubao (www.doubao.com) — Deep Research DOM аудит

> Проверено: 2026-11-18, Codex in-app browser (~753px, узкий)
> URL: https://www.doubao.com/chat/ — **залогинен** (用户461138 в сайдбаре, история диалогов видна).

## Статус функции: ❌ «深入研究/深度研究» в интерфейсе НЕТ

- Skill-bar под composer содержит: `图像生成`, `AI 表格`, `帮我写作`, `视频生成`, `音乐生成` + 3 безымянные кнопки (`skill_bar_button_26`, `skill_bar_button_5000`, `skill_bar_button_1005` — пустые, только иконки).
- Панель «更多技能» (28 навыков): `录音转写`, `AI 播客`, `PPT 生成`, `地图`, `可视化`, `会议`, `画板`, `Markdown 笔记`, `知识库`, `任务`… — «深入研究»/«深度研究» **отсутствует**.
- Переключатели «对话»/«工作» рядом с composer — есть, но отдельного Research-режима в них нет.
- Поиск по всей странице по `研究|research` — только в `<script>` манифестах, не в UI.

Вывод: у текущего аккаунта/версии Doubao функция Deep Research **убрана или переименована** (возможно, слита в «工作»/Agent-режим). Раньше был `data-testid="skill_bar_button_25"` с текстом «深入研究» — этого testid больше нет.

## Проверка каждого существующего селектора

### `researchMode.steps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `button.skill-bar-button[data-component-type="skill-item"]` + text `['深入研究','深度研究']` | miss | сами skill-кнопки есть (7 шт), но ни одна не содержит «研究» |
| `button[data-component-type="skill-item"][data-testid^="skill_bar_button_"]` + тот же text | miss | — |

### `researchMode.cancelSteps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `[data-testid="skill_input_exit_button"]`, `div[data-testid="skill_input_exit_button"]` + text | miss | элемента нет (режим не активен) |

### `textarea`

| Селектор | Результат | Комментарий |
|---|---|---|
| `div[data-testid="chat_input_input"][contenteditable="true"]` | miss | `data-testid="chat_input_input"` есть, но `contenteditable` у элемента нет |
| `[data-testid="chat_input_input"][contenteditable="true"]` | miss | — |
| `div[role="textbox"][data-testid="chat_input_input"]` | miss | role тоже убран |
| `textarea[data-testid="chat_input_input"]`, `textarea.semi-input-textarea*`, `textarea[placeholder*="发消息或输入"]`, `textarea[placeholder*="输入"]`, `.chat-textarea`, `textarea` | частично | textarea-элемент есть (semi-input), `data-testid="chat_input_input"` встречается у контейнера |
| `[contenteditable="true"]` | hit | в composer есть contenteditable |

### `sendButton`, `reportContainer`

- `button[data-testid="chat_input_send_button"]`, `#flow-end-msg-send`, `button[aria-label="发送"]` — не проверено вживую (в AX есть `发送`-контейнер); `data-testid=chat_input_send_button` в новой версии может отсутствовать.
- `reportContainer` (`#chat-route-layout aside div.zone-container.editor-kit-container`) — не проверено (нет исследования).

## Рекомендация

```ts
// Вариант А: пока Deep Research у Doubao нет — удалить/отключить researchMode,
// чтобы MultiChat не пытался включать несуществующую функцию.
researchMode: undefined  // или удалить ключ

// Вариант Б: если выяснится, что DR у Doubao = "工作" режим,
// шаги будут вида:
// steps: [
//   { selector: ['button:has-text("工作")', '[role="tab"]:has-text("工作")'], delay: 400 }
// ]
```

## Замечания

- Skill-бар реально виден: `button[data-component-type="skill-item"][data-testid^="skill_bar_button_"]` — 7 кнопок, но нужной нет.
- «更多技能» панель открывается `button:has-text("更多技能")` — контент грузится, 28 навыков; «深入研究» в ней нет.
- Функция могла уйти в «工作»/Agent-режим или быть переименована — без явного UI-пункта зафиксировать новую зацепку нельзя. Рекомендую пометить Doubao `researchMode` как устаревший до ручного подтверждения на живом аккаунте.
