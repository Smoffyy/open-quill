# Artifacts & Sandbox

## What it is

With **Sandbox tools** on (composer **+** menu, `Alt+S`, or on by default for some models), the assistant gets a workspace of its own: a file system and a shell. It can create and edit files, install packages, build and run code, and fix what fails. Every chat has its own workspace; chats inside a project share the project's workspace, so files you upload to the project are ordinary files in it.

Every file the assistant writes appears in the **Artifacts** panel. Open it with the artifacts button in the top bar, whose badge counts the files, or `Alt+A`.

Sandbox tools are only offered when the admin allows them for the selected model, and never in incognito chats.

## The panel

- A file tree, or a flat list if you prefer. Folders collapse and expand, and build and dependency folders such as `node_modules` are hidden, as is anything in the workspace's `.gitignore`.
- **Filter files** narrows the list by name.
- Open a second file beside the first to compare them, and close the split when you are done.
- Drag the panel's edge to resize it, or switch to **Full screen**.
- A file the assistant is still writing streams in live, marked as being written.

## Viewing and editing

- **Code and text** are highlighted, with **Find in file** and word wrap.
- **HTML, SVG and Markdown** can switch between the source and a live **Preview**.
- **Images** open in a viewer with zoom.
- Files that cannot be shown are offered as a download.

**Edit** opens a file for changes; **Save** writes them as a new version. Editing waits until the current reply has finished, so you and the assistant never write the same file at once.

## Versions

Every change to a file is kept. **Version history** steps through the versions, and **Show changes from previous version** shows a diff with **Jump to first change**. **Restore** brings back an older version as the newest one, so nothing after it is lost.

## Downloading

Download any single file, or **Download all** for the whole workspace as a zip. The **Artifacts** page in the sidebar lists files from every chat in one place.

## Where it runs

The sandbox runs on the same machine as Open Quill, in a folder per workspace, with a fixed list of dangerous host commands refused and paths kept inside the workspace. It has the same network access as the machine itself, so code it runs can make its own requests, just as if you ran it yourself. See [Privacy & Security](privacy-security.md#what-leaves-the-machine).

An admin sets how much storage each member's sandbox may use under **Admin Panel → Quotas**.