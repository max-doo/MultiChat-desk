# Perplexity — Deep Research DOM аудит

> Проверено: 2026-11-18, Codex in-app browser (~753px, узкий)
> URL: https://www.perplexity.ai — Cloudflare-челлендж прошёл сам, интерфейс на китайском. Не залогинен (или бесплатный уровень).

## Текущая цепочка включения Deep Research (реальный DOM)

Раньше переключатель «поиск / исследование» был `button[role="radio"][value]` в composer — **его больше нет**. Сейчас:

- В composer — pill-группа режимов `button[aria-pressed]` («搜索» aria-pressed=true, «Computer» aria-pressed=false) + data-testid-обёртка `ask-input-mode-toggle-*`. «研究» среди pill нет.
- «深度研究» находится **только в меню «+»**: `button[aria-label="添加文件、插件等"]` → выпадает `div[role="listbox"]` → `div[role="option"]` с текстом «深度研究» (+ подпись «Pro 已包含» — исследование включено в тариф).

```html
<button aria-label="添加文件、插件等" aria-expanded="false" type="button">+</button>
<!-- после клика: -->
<div role="listbox">
  <div role="option" class="group/typeahead-row flex w-full items-center rounded-lg gap-2 px-1.5 py-2">
    <span><span>深度研究</span></span>
    <div>Pro 已包含</div>
  </div>
  …
</div>
```

## Проверка каждого существующего селектора

### `researchMode.steps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `button[role="radio"][value="research"]:not([aria-disabled="true"])` | miss | role=radio в документе отсутствует |
| `button.border.rounded-lg.h-8:not([aria-haspopup])` + regex `研究` | miss | такого класса/структуры нет; «研究» есть только в меню «+» |
| `[role="menuitemradio"][value="research"]`, `[role="menuitemradio"][data-value="research"]`, `[role="menuitem"][data-value="research"]`, `[role="menuitemradio"][aria-label*="研究"]`, `[role="menuitem"][aria-label*="研究"]` | miss | пункт меню — `div[role="option"]` без value/aria-label |

**Итог steps: 0/3 ступеней работают.**

### `researchMode.cancelSteps`

| Селектор | Результат | Комментарий |
|---|---|---|
| `button[role="radio"][value="search"]`, `button.border.rounded-lg.h-8:not([aria-haspopup])` + regex `搜索|Search`, `[role="menuitemradio"][value="search"]`… | miss | всё та же отсутствующая структура |

### `textarea`

| Селектор | Результат | Комментарий |
|---|---|---|
| `#ask-input` | miss | id нет |
| `textarea[placeholder*="Ask"]`, `textarea[placeholder*="Search"]`, `textarea` | miss | textarea отсутствует |
| `[contenteditable="true"]` | **hit** | composer — `div[contenteditable="true"][role="textbox"][data-lexical-editor][aria-label="输入 / 以选择搜索模式"]` (Lexical editor) |

### `sendButton`

Не проверено вживую (composer пустой). Ожидаемо `button[aria-label*="提交"]`/`type=submit` — все старые `button[type="submit"]`, `button[aria-label*="Send"]` не подтверждены.

## Рекомендуемая замена (формат `AutomationStep`)

```ts
researchMode: {
  steps: [
    // шаг1: "+" — открыть меню
    { selector: [
        'button[aria-label="添加文件、插件等"]',
        'button[aria-label*="Add files"]',
        'button[aria-label*="插件"]'
      ], delay: 500, menuOpenerFallback: true },
    // шаг2: пункт меню — div[role=option] с текстом
    { selector: [
        'div[role="option"]',
        '[role="menuitem"]',
        'button'
      ], regex: '深度研究|Deep\\s*Research', wordBoundary: false,
      exclude: ['\\bSearch\\b', '搜索'], delay: 500 }
  ],
  cancelSteps: [
    // после включения DR вместо "搜索" pill-а появляется активный режим;
    // общий приём — кликнуть pill "搜索"/"Search" в aria-pressed-группе
    { selector: [
        'button[aria-pressed][aria-label="搜索"]',
        'button[aria-pressed][aria-label*="Search"]'
      ], delay: 300, optional: true }
  ]
}
```

`textarea`: `#ask-input` заменить на `div[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor]` — текущий `[contenteditable="true"]` в списке уже работает и служит фолбэком.

## Замечания

- Cloudflare-челлендж в iab проходит сам через ~5с — не блокер, но задержку в автоматизации стоит учитывать.
- Меню «+» — role="listbox" (не menu); пункты — `div[role="option"]` с классом `group/typeahead-row`, текст «深度研究» внутри `<span class="truncate">`.
- «深度研究» помечен «Pro 已包含» — на бесплатном аккаунте может быть недоступно/серым; стоит добавить `aria-disabled`/`opacity` проверку, если клик не срабатывает.
