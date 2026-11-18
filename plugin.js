/**
 * file-to-chat — add a file from the sidebar file tree to the current chat.
 *
 * Two entry points, one behaviour (an inline `@file:` / `@folder:` reference chip
 * in the composer, exactly what dragging the row into the composer produces):
 *
 *   1. hover a row (file or folder) → an `@` button appears on its right edge;
 *   2. right-click a row → "添加到对话" at the top of the app's own menu.
 *
 * The desktop SDK has no contribution area for the file tree, so this plugin
 * works on the tree's DOM: rows are the `.group/row` elements carrying a
 * `title` (absolute path) and `aria-selected`; folders additionally carry
 * `aria-expanded`. Context menus are Radix portals tagged
 * `data-slot="context-menu-content"`; a menu item is cloned from the menu's own
 * first item so styling and hover states stay the app's.
 */

import { host } from '@hermes/plugin-sdk'

const ID = 'file-to-chat'
const VERSION = '0.2.1'
const ROW_CLASS = 'group/row'
const BUTTON_ID = 'file-to-chat-at'
const STYLE_ID = 'file-to-chat-style'
const MENU_FLAG = 'data-file-to-chat-menu'
const ITEM_FLAG = 'data-file-to-chat-item'
/** A menu is only decorated when it opened this soon after a file right-click. */
const MENU_WINDOW_MS = 2000
const MENU_CONTENT = '[data-slot="context-menu-content"]'
const MENU_ITEM = '[data-slot="context-menu-item"]'
const MENU_SEPARATOR = '[data-slot="context-menu-separator"]'

const CSS = `
#${BUTTON_ID} {
  position: fixed;
  z-index: 2147483000;
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-text-tertiary, #9aa0a6);
  font: 600 11px/1 var(--font-mono, ui-monospace, monospace);
  cursor: pointer;
  user-select: none;
}
#${BUTTON_ID}:hover {
  background: var(--chrome-action-hover, rgba(127, 127, 127, 0.18));
  color: var(--ui-text-primary, currentColor);
}
/* The injected menu item is a clone with no React handlers, so Radix never
   sets its highlight state — paint the row's own hover/focus look here. */
[${ITEM_FLAG}]:hover,
[${ITEM_FLAG}]:focus {
  background: var(--ui-control-active-background, rgba(127, 127, 127, 0.18));
  color: var(--foreground, currentColor);
}
`

let api = null
let button = null
let currentRow = null
let pending = null
let watchRaf = 0
let watchUntil = 0
const disposers = []

const tr = key => (api ? api.i18n.t(key) : key)

// ---------------------------------------------------------------------------
// paths → composer refs
// ---------------------------------------------------------------------------

const norm = path => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '')

/** Workspace-relative path when the file sits under the chat's cwd, else the
 *  absolute path (the gateway resolves both). */
function relativeTo(path, cwd) {
  const abs = norm(path)
  const base = cwd ? norm(cwd) : ''

  if (!base) {
    return abs
  }

  if (abs === base) {
    return abs
  }

  if (abs.startsWith(`${base}/`)) {
    return abs.slice(base.length + 1)
  }

  if (abs.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return abs.slice(base.length + 1)
  }

  return abs
}

/** Backtick-quoted ref value, the same quoting the composer's own chip writer
 *  uses (falls back when the path contains a backtick). */
function quoteRef(value) {
  if (!value.includes('`')) {
    return `\`${value}\``
  }

  if (!value.includes('"')) {
    return `"${value}"`
  }

  if (!value.includes("'")) {
    return `'${value}'`
  }

  return value
}

async function addToChat(path, isFolder) {
  const value = relativeTo(path, host.state.cwd.get())
  const ref = `@${isFolder ? 'folder' : 'file'}:${quoteRef(value)}`

  let ok = false

  try {
    // 'inline' appends on the current line (a single space when the draft has
    // text); 'block' would insert a blank line first — a visible extra row in
    // an otherwise empty composer.
    ok = await host.composer.insertText(null, ref, { mode: 'inline' })
  } catch {
    ok = false
  }

  host.notify({ kind: ok ? 'info' : 'error', message: ok ? tr('added') : tr('noComposer') })

  return ok
}

// ---------------------------------------------------------------------------
// row detection
// ---------------------------------------------------------------------------

function rowFor(node) {
  let el = node && node.nodeType === 1 ? node : null

  while (el && el !== document.body) {
    if (
      el.classList &&
      el.classList.contains(ROW_CLASS) &&
      el.hasAttribute('title') &&
      el.hasAttribute('aria-selected')
    ) {
      return el
    }

    el = el.parentElement
  }

  return null
}

const isFolderRow = row => row.hasAttribute('aria-expanded')

// ---------------------------------------------------------------------------
// hover "@" button (its own overlay: never injected into React's row markup)
// ---------------------------------------------------------------------------

function hide() {
  currentRow = null

  if (button) {
    button.style.display = 'none'
  }
}

function place() {
  const row = currentRow

  if (!button || !row) {
    return
  }

  if (!row.isConnected) {
    hide()

    return
  }

  const rect = row.getBoundingClientRect()

  if (rect.height < 8 || rect.right < 0 || rect.top > window.innerHeight || rect.bottom < 0) {
    hide()

    return
  }

  button.style.top = `${Math.round(rect.top + (rect.height - 16) / 2)}px`
  button.style.left = `${Math.round(rect.right - 22)}px`
}

function showFor(row) {
  if (!button) {
    return
  }

  currentRow = row
  button.style.display = 'flex'
  place()
}

function onPointerOver(event) {
  const target = event.target

  if (button && target instanceof Node && (target === button || button.contains(target))) {
    return
  }

  const row = rowFor(target)

  if (!row) {
    hide()

    return
  }

  showFor(row)
}

function onPointerOut(event) {
  if (!event.relatedTarget) {
    hide()
  }
}

function onScroll() {
  if (currentRow) {
    place()
  }
}

function onButtonClick(event) {
  event.preventDefault()
  event.stopPropagation()

  const row = currentRow
  const path = row ? row.getAttribute('title') || '' : ''
  const isFolder = row ? isFolderRow(row) : false

  hide()

  if (path) {
    void addToChat(path, isFolder)
  }
}

// ---------------------------------------------------------------------------
// context menu decoration
// ---------------------------------------------------------------------------

const pointerDown = () =>
  typeof PointerEvent === 'function'
    ? new PointerEvent('pointerdown', { bubbles: true })
    : new MouseEvent('pointerdown', { bubbles: true })

function closeMenus() {
  const open = document.querySelector(MENU_CONTENT)

  if (!open) {
    return
  }

  // Radix's dismissable layer listens for Escape on the document…
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))

  // …and for a pointerdown outside the layer, as the fallback.
  const afterwards = api ? api.setTimeout : null

  const dismiss = () => {
    const still = document.querySelector(MENU_CONTENT)

    if (still) {
      still.dispatchEvent(pointerDown())
      document.body.dispatchEvent(pointerDown())
    }
  }

  if (afterwards) {
    afterwards(dismiss, 0)
  } else {
    dismiss()
  }
}

function decorateMenu(menu, target) {
  if (menu.hasAttribute(MENU_FLAG)) {
    return
  }

  const sample = menu.querySelector(MENU_ITEM)

  if (!sample) {
    return
  }

  menu.setAttribute(MENU_FLAG, '1')

  // Cloned from the menu's own item so the padding, radius, hover fill and
  // disabled look are the app's, not an approximation.
  const item = sample.cloneNode(true)

  item.removeAttribute('data-highlighted')
  item.removeAttribute('data-disabled')
  item.removeAttribute('aria-disabled')
  item.setAttribute(ITEM_FLAG, '1')
  item.textContent = tr('menu')

  item.addEventListener('pointerdown', event => event.stopPropagation())
  item.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    const path = target.path
    const isFolder = target.isFolder
    pending = null
    closeMenus()
    void addToChat(path, isFolder)
  })

  menu.insertBefore(item, menu.firstChild)

  const separator = menu.querySelector(MENU_SEPARATOR)

  if (separator) {
    menu.insertBefore(separator.cloneNode(true), item.nextSibling)
  }
}

function watchMenu() {
  const target = pending

  if (!target) {
    return
  }

  const menus = document.querySelectorAll(MENU_CONTENT)
  let decorated = false

  for (const menu of menus) {
    const before = menu.hasAttribute(MENU_FLAG)

    decorateMenu(menu, target)
    decorated = decorated || (!before && menu.hasAttribute(MENU_FLAG))
  }

  if (decorated || Date.now() > watchUntil) {
    pending = null
  }
}

function startWatch() {
  watchUntil = Date.now() + MENU_WINDOW_MS

  if (watchRaf) {
    return
  }

  const step = () => {
    watchRaf = 0
    watchMenu()

    if (pending && Date.now() <= watchUntil) {
      watchRaf = requestAnimationFrame(step)
    }
  }

  watchRaf = requestAnimationFrame(step)
}

function onContextMenu(event) {
  const row = rowFor(event.target)
  const path = row ? row.getAttribute('title') || '' : ''

  if (!row || !path) {
    pending = null

    return
  }

  pending = { at: Date.now(), isFolder: isFolderRow(row), path }
  hide()
  startWatch()
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

function installStyle() {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')

  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function createButton() {
  const el = document.createElement('button')

  el.id = BUTTON_ID
  el.type = 'button'
  el.textContent = '@'
  el.title = tr('buttonTip')
  el.setAttribute('aria-label', tr('buttonTip'))
  el.addEventListener('click', onButtonClick)
  el.addEventListener('pointerdown', event => event.stopPropagation())
  document.body.appendChild(el)

  return el
}

export default {
  id: ID,
  name: 'File to Chat',
  description: 'Add a file or folder from the sidebar tree to the current chat',
  version: VERSION,
  register(ctx) {
    api = ctx

    ctx.i18n.register({
      en: {
        added: 'Added to chat',
        buttonTip: 'Add to chat',
        menu: 'Add to chat',
        noComposer: 'No open chat input to add to'
      },
      ja: {
        added: 'チャットに追加しました',
        buttonTip: 'チャットに追加',
        menu: 'チャットに追加',
        noComposer: '追加できるチャット入力欄がありません'
      },
      zh: {
        added: '已添加到对话',
        buttonTip: '添加到对话',
        menu: '添加到对话',
        noComposer: '没有可用的对话输入框'
      }
    })

    installStyle()
    button = createButton()

    disposers.push(
      ctx.i18n.onLocaleChange(() => {
        if (button) {
          button.title = tr('buttonTip')
          button.setAttribute('aria-label', tr('buttonTip'))
        }
      })
    )

    ctx.addEventListener(document, 'pointerover', onPointerOver, true)
    ctx.addEventListener(document, 'pointerout', onPointerOut, true)
    ctx.addEventListener(document, 'contextmenu', onContextMenu, true)
    ctx.addEventListener(window, 'scroll', onScroll, true)
    ctx.addEventListener(window, 'resize', hide)
    ctx.addEventListener(window, 'blur', hide)

    ctx.onDispose(() => {
      if (watchRaf) {
        cancelAnimationFrame(watchRaf)
        watchRaf = 0
      }

      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* locale listener already gone */
        }
      }

      if (button && button.parentNode) {
        button.parentNode.removeChild(button)
      }

      button = null
      currentRow = null
      pending = null

      const style = document.getElementById(STYLE_ID)

      if (style) {
        style.remove()
      }

      api = null
    })
  }
}
