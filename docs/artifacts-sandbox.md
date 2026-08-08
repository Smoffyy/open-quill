# Artifacts & Sandbox

## What it is

When **Sandbox tools** is turned on for a chat (composer **+** menu, if the selected model allows it), the assistant gets a real per-chat workspace: it can create, edit, and run files, use a shell, install packages, and build/test things, all scoped to that one chat. Every file it touches shows up in the **Artifacts** panel (`Alt+A`, or the header button) for you to browse, preview, and download. This is the same mechanism behind interactive code/document artifacts the assistant produces inline.

## Browsing files

The panel shows a file tree (folders collapsible; common build and dependency directories like `node_modules` are auto-hidden, and it respects `.gitignore`). Open multiple files as tabs, and split the view to see two at once.

While the assistant is actively writing a file, the panel shows it streaming in live rather than waiting for the write to finish.

## Viewing content

- **Code**: syntax-highlighted, with word-wrap and an in-file search.
- **HTML/SVG**: a live rendered preview alongside the source.
- **Markdown**: rendered preview mode.
- **Images**: a zoom/pan viewer.
- **Binary files**: shown as a download card rather than an attempted preview.

## Versions

Every edit to a file is kept as a version. Open a file's version history to see a diff against the previous version, and restore any earlier version if the assistant's later edit wasn't what you wanted. Restoring doesn't lose the newer versions, it just adds the restored content as the newest one.

## Downloading

Download any single file, or use **Download all** to get the entire workspace as a zip.

## Where it runs

The sandbox executes with the same network access as the machine Open Quill is running on. A script the assistant runs can make its own outbound requests, the same as if you'd run it yourself. See [Privacy & Security](privacy-security.md) for how this fits into the app's local-only networking model.
