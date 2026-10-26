# Artifacts and Code sessions

## Artifacts in a chat

When you ask for something substantial that you will want to keep, such as a document, a plan, a letter, a web page, an SVG image, a Mermaid diagram or a script, the assistant can write it as an **artifact**. It opens in a panel beside the chat, and the reply shows a card you can click to open it again.

- Documents, web pages, SVG and Mermaid diagrams open rendered, with a switch to the source.
- **Edit** changes an artifact yourself, and the assistant sees your edits in the next turn.
- Ask for a change and the assistant edits the same artifact, so every change is a new version you can compare and restore, rather than a near-copy under a new name.
- **Add to project** copies an artifact into a project's knowledge, where every chat in that project can read it.
- Download one artifact, or **Download all** as a zip. `Alt+A` opens and closes the panel (**Artifacts panel, or files in Code** in the shortcut list).

An admin can switch artifacts off for a model under **Admin Panel → Models → Tools**. A forked chat keeps a copy of its artifacts, and deleting a chat deletes them. Incognito chats never have artifacts.

## Code mode

The sidebar has a **Chat / Code** switch. Chats are ordinary conversations. A **Code session** is a chat that also gets a sandbox: a workspace with a file system and a shell. The assistant can create and edit files, install packages, run builds and fix what fails.

To start one, switch to **Code** and start a chat, or use **Build in Code** on a project page to start one with a copy of the project's files. Only models an admin has marked **Available in Code** can run Code sessions, and they are greyed out in the Code model picker otherwise.

Only Code sessions have a sandbox. Chats, including chats in a project, never run commands or change files on the server; a project's documents are read-only knowledge. See [Organizing your chats](organizing-chats.md#projects).

## The files panel

Every file the assistant writes in a Code session appears in the files panel. Open it from the top bar, or with `Alt+A`. Its badge counts the files.

- Folders expand and collapse. Build and dependency folders such as `node_modules` are hidden, and so is anything in the workspace's `.gitignore`.
- **Filter files** narrows the list by name.
- Open a second file beside the first to compare them.
- Drag the edge to resize the panel, or use full screen.
- A file the assistant is still writing appears live, marked as being written.

## Viewing and editing

- **Code and text** are highlighted, with **Find in file**.
- **HTML, SVG, Markdown and Mermaid** (`.mmd`) switch between the source and a **Preview**.
- **Images** open in a viewer.
- Files that cannot be shown are offered as downloads.

**Edit** opens a file for changes, and **Save** writes a new version. Editing waits until the current reply finishes, so you and the assistant never write the same file at once.

## Versions

Every change to a file is kept.

- **Version history** steps through the versions.
- **Show changes from previous version** shows a diff, and **Jump to first change** moves to the first difference.

## Downloading

Download a single file, or **Download all** for the whole workspace as a zip. The **Artifacts** page in the sidebar lists chat artifacts, project knowledge and Code files in one place, each marked with where it lives.

## Where it runs

The sandbox runs on the same machine as Open Quill, in a folder for each workspace. Paths stay inside the workspace, and a fixed list of dangerous host commands is refused.

The sandbox has the same network access as the machine, so code it runs can make its own requests, just as if you ran it yourself. See [Privacy and security](privacy-security.md#what-leaves-the-machine).

An admin sets how much storage each sandbox can use under **Admin Panel → Quotas**.