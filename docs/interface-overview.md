# Interface Overview

## Layout

- **Sidebar** (left): your chat list, folders, and the profile menu at the bottom-left (Settings, Personas, Admin Panel if you're an admin, sign out). Toggle it with `Ctrl+Shift+S`.
- **Home screen**: shown when no chat is open. A greeting, optional quick-prompt buttons, and the composer. Text and quick prompts are configurable per-workspace by an admin under **Admin Panel → Home Screen**.
- **Chat view**: the message thread plus the composer pinned at the bottom. A topbar above it holds the model picker, chat menu, and (when enabled) navigation aids like the thread rail and find bar.
- **Composer**: the input box, always at the bottom of whichever view you're in. See [The Composer](composer.md).

## Themes

**Settings → Appearance** controls:

- **Theme**: System, Light, or Dark. System follows your OS preference.
- **Accent color**: a handful of presets plus a custom color picker.
- **Message density**: Comfortable or Compact spacing.
- **Font**: Default (matches the active preset), Literata, Newsreader, Source Serif, or Open Sans.
- **OLED screen protection**: deepens dark mode toward pure black, useful on OLED displays.

Theme and font choices are stored per-device before you're even signed in, so a reload never flashes the wrong theme, and they're synced to your account afterward.

## Interface presets vs. themes

These are two different settings that often get confused:

- **Preset** (Anthropic-style or OpenAI-style) is set workspace-wide by an admin under **Admin Panel → Appearance**. It changes the entire visual language: fonts, composer shape, spacing, iconography.
- **Theme** (System/Light/Dark) is per-user, set in **Settings → Appearance**, and only changes light vs. dark within whichever preset the admin chose.

## Command palette

`Ctrl+K` opens a searchable command palette for jumping to any chat, opening settings, starting a new chat, or triggering most of the actions described throughout these docs. It's the fastest way to find something if you don't remember which menu it's in.

## Localization

The interface language is a per-device setting in **Settings → General**, separate from the model. Changing it only changes UI text, not what language the model replies in. Open Quill currently ships English, Spanish, Chinese, French, and Portuguese; more can be added by the project (see the root README for details on the codebase side).
