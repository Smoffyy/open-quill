# Code sessions and the sandbox

## Code mode

The sidebar has a **Chat / Code** switch. Chats are ordinary conversations. A **Code session** is a chat that also gets a sandbox: a workspace with a file system and a shell. The assistant can create and edit files, install packages, run builds and fix what fails.

To start one, switch to **Code** and start a chat. Only models an admin has marked **Available in Code** can run Code sessions, and they are greyed out in the Code model picker otherwise.

Chats inside a project get the same sandbox. They share the project's workspace, so files in the project's **Files** are ordinary files the chats can read and edit. See [Organizing your chats](organizing-chats.md#projects).

Ordinary chats outside a project have no sandbox, and incognito chats never have one.

## The files panel

Every file the assistant writes in a Code session appears in the files panel. Open it from the top bar, or with `Alt+A` (**Files panel (Code)** in the shortcut list). Its badge counts the files.

- Folders expand and collapse. Build and dependency folders such as `node_modules` are hidden, and so is anything in the workspace's `.gitignore`.
- **Filter files** narrows the list by name.
- Open a second file beside the first to compare them.
- Drag the edge to resize the panel, or use full screen.
- A file the assistant is still writing appears live, marked as being written.

## Viewing and editing

- **Code and text** are highlighted, with **Find in file**.
- **HTML, SVG and Markdown** switch between the source and a **Preview**.
- **Images** open in a viewer.
- Files that cannot be shown are offered as downloads.

**Edit** opens a file for changes, and **Save** writes a new version. Editing waits until the current reply finishes, so you and the assistant never write the same file at once.

## Versions

Every change to a file is kept.

- **Version history** steps through the versions.
- **Show changes from previous version** shows a diff, and **Jump to first change** moves to the first difference.

## Downloading

Download a single file, or **Download all** for the whole workspace as a zip. The **Artifacts** page in the sidebar lists the files from every chat in one place.

## Where it runs

The sandbox runs on the same machine as Open Quill, in a folder for each workspace. Paths stay inside the workspace, and a fixed list of dangerous host commands is refused.

The sandbox has the same network access as the machine, so code it runs can make its own requests, just as if you ran it yourself. See [Privacy and security](privacy-security.md#what-leaves-the-machine).

An admin sets how much storage each sandbox can use under **Admin Panel → Quotas**.