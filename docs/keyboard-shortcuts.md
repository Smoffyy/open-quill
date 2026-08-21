# Keyboard Shortcuts

Every shortcut below is rebindable at **Settings → Keybinds**, so treat this as the factory defaults, not a fixed layout. On macOS, `Ctrl` in a combo becomes `Cmd`.

## General

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Open command palette |
| `Ctrl+Shift+F` | Search all chats |
| `Ctrl+Shift+O` | New chat |
| `Ctrl+Shift+S` | Toggle sidebar |
| `Ctrl+,` | Open settings |
| `Alt+I` | Toggle incognito chat |
| `Alt+T` | Switch light/dark |
| `?` | Shortcuts help |

## Composer

| Shortcut | Action |
| --- | --- |
| `/` | Focus the message bar |
| `Ctrl+U` | Attach files |
| `Alt+W` | Toggle web search |
| `Alt+S` | Toggle sandbox |
| `Ctrl+.` | Stop generating |

## Inside a conversation

| Shortcut | Action |
| --- | --- |
| `Ctrl+F` | Find in conversation (only when the open chat has messages; otherwise the browser's own find runs) |
| `B` | Branch map |
| `J` / `K` | Next / previous message |
| `Alt+↓` | Jump to latest message |
| `Alt+L` | Context ledger |
| `Alt+P` | "What gets sent" (prompt inspector) |
| `Alt+A` | Artifacts panel |
| `Alt+J` / `Alt+K` | Next / previous chat in the sidebar |

## On a focused message

Focus a message with `J`/`K` first, then:

| Shortcut | Action |
| --- | --- |
| `C` | Copy |
| `E` | Edit |
| `R` | Retry |
| `Y` | Branch into new chat |
| `Escape` | Clear focus |

## Chords

A few bindings are two-key chords, like `space` followed by a letter. Pressing the first key arms it and shows a hint overlay of everything bound under it. The chord only arms while focus isn't inside a text field, so it never interferes with typing a literal space.

## Customizing

**Settings → Keybinds** lets you:

- Record a new combo for any action by clicking it and pressing the keys you want.
- Switch between the **default** layout and a **Vim-flavored** preset in one click.
- See conflicts flagged when two actions share a combo. The first-listed action wins if you save one anyway.
- **Export**/**import** your bindings as a file, to carry a layout between devices or accounts.

Shortcuts tied to a navigation feature (thread rail, find, branch map, message shortcuts) only work while that feature is turned on in **Settings → Chat → Navigation**. Turning the feature off removes both the button and the shortcut, not just one or the other. Some bindings, like `Escape` to clear focus, aren't rebindable at all.
