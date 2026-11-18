# ChatGPT — Deep Research DOM аудит

> Проверено: 2026-11-18, Codex in-app browser (Chromium, ~753px ширина — «узкий» режим, как у webview в MultiChat)
> URL: https://chatgpt.com — залогинен, интерфейс на китайском/русском.

## Текущая цепочка включения Deep Research (реальный DOM)

1. Кнопка «+» в composer: `<button type="button" aria-label="添加文件等内容" aria-expanded="false" data-composer-navigation-target="add-context" data-state="closed">` — **без `data-testid` и без `id`**. Семантические зацепки: `aria-label` и `data-composer-navigation-target="add-context"`.
2. Меню — выпадающий список; пункт «深度研究» — обычный `<button>` с текстом «深度研究» + подписью «获取详细报告» (англ. «Deep Research» / «Get a detailed report»). **Не `div[role="menuitemradio"]` и вообще без `role`**.

```html
<button type="button" aria-label="添加文件等内容" data-composer-navigation-target="add-context" aria-expanded="false">…</button>
<!-- после клика: -->
<div> <!-- контейнер меню, без role -->
  <button>…<span>深度研究</span><span>获取详细报告</span></button>
  <button>…<span>网页搜索</span>…</button>
  <button>…<span>思考一下</span>…</button>
</div>
```

## Проверка каждого существующего селектора

### `researchMode.steps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `[data-testid="composer-plus-btn"]` | miss | атрибута нет вообще |
| `#composer-plus-btn` | miss | id убран |
| `button.composer-btn` | miss | класса нет |
| `div[role="menuitemradio"]` + regex `Deep\s*Research|深度研究` | miss | меню — обычные `<button>`, `role="menuitemradio"` в документе отсутствует |
| `menuOpenerFallback` | частично | семантика «+» угадывается по aria-label, но если шаг 1 промахивается, fallback может не сработать |

**Итог steps: 0/4 селекторов работают.**

### `researchMode.cancelSteps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `[class*="__composer-pill-remove"]` | не подтверждено | плашки активного режима в свежем UI не видно; нужна ре-проверка после реального включения DR |

### `textarea`

| Селектор | Результат | Комментарий |
|---|---|---|
| `#prompt-textarea.ProseMirror` | miss | id `prompt-textarea` удалён |
| `div.ProseMirror[contenteditable="true"]` | **hit** | единственный живой селектор (`class="ProseMirror"`, `aria-label="询问 ChatGPT"`, `data-composer-markdown`) |
| `#prompt-textarea` | miss | — |
| `textarea[placeholder*="Message"]`, `textarea[placeholder*="询问任何问题"]`, `textarea[data-id="root"]` | miss | textarea в composer вообще нет |
| `[contenteditable="true"][data-placeholder]` | miss на главной | `data-placeholder` теперь на `<p data-empty-paragraph>` внутри editor, не на самом editable |

### `sendButton`

| Селектор | Результат | Комментарий |
|---|---|---|
| `[data-testid="send-button"]`, `button[data-testid="send-button"]` | miss | testid убран |
| `button[aria-label*="Send"]` | miss на zh-UI | кнопка — `button[aria-label="发送"]`; в en-UI `aria-label="Send"` |
| `form button[type="submit"]` | не сработает | composer — `<fieldset>`, не `<form>` |

### `reportContainer`

Не проверено (нет запущенного исследования). Все кандидаты (`section.popover`, `[class*="popover"]`, `[role="dialog"] [class*="markdown"]`, `[class*="deep-research"] …`) — спекулятивные; в текущем UI отчёт идёт в основном потоке, отдельной popover-панели не наблюдалось.

## Рекомендуемая замена (формат `AutomationStep`)

```ts
researchMode: {
  steps: [
    // шаг1: "+" — семантические зацепки: data-composer-navigation-target / aria-label
    { selector: [
        'button[data-composer-navigation-target="add-context"]',
        'button[aria-label="添加文件等内容"]',
        'button[aria-label*="Add files"]',
        '[data-testid="composer-plus-btn"]'   // на случай старого UI
      ], delay: 1000, menuOpenerFallback: true },
    // шаг2: элемент меню — button с текстом, без role
    { selector: [
        'button',
        'div[role="menuitemradio"]',          // старый UI
        '[role="menuitem"]'
      ], regex: 'Deep\\s*Research|深度研究', wordBoundary: false,
      exclude: ['\\bSearch\\b', '搜索', '网页搜索'], delay: 500 }
  ],
  cancelSteps: [
    { selector: [
        '[class*="composer-pill-remove"]',
        'button[aria-label*="删除"]',
        'button[aria-label*="Remove"]'
      ], delay: 200, optional: true }
  ]
}
```

Также стоит обновить `textarea` (оставить `div.ProseMirror[contenteditable="true"]` + `[contenteditable="true"]` без data-placeholder) и `sendButton` (`button[aria-label="发送"], button[aria-label*="Send"]`).

## Замечания

- `data-composer-navigation-target="add-context"` — самый стабильный хук, переживает локализацию aria-label.
- Старый `docs/深度研究dom.md` описывает прежний UI (`#composer-plus-btn`, `div[role=menuitemradio]`) — тот UI полностью заменён.
- Проверялось в узком режиме (~753px); раньше разница узкий/широкий была в том, что часть контролов уезжала в overflow-меню — сейчас composer одинаков, режимный плюс-кнопка одна.
