# Organizing your chats

## The sidebar list

Chats appear under **Recents**, newest first. Star a chat from its menu to move it into **Starred** at the top. **Group by** on Recents groups the list by date, by project, or not at all.

Each chat's menu (the **⋯** on hover, or the title in the top bar) has **Star**, **Add to project** or **Remove from project**, **Export as**, **Rename** and **Delete chat**. A chat that is still writing can be stopped from the same menu.

## All chats

**All chats** at the bottom of the sidebar list opens the full list, with **Active** and **Archived** tabs. Press **Select** to pick several chats, or **Select all**, then **Archive**, **Unarchive** or **Delete** them together. Archived chats leave the sidebar but are kept until you delete them.

## Search

`Ctrl+Shift+F`, or the search button at the top of the sidebar, searches the titles and text of all your chats. Type at least two characters. Matches are highlighted, and the arrow keys move between them.

## Projects

A project groups chats around shared context. Open **Projects** in the sidebar to see, search, sort or create them.

Inside a project you get:

- **Instructions** that apply to every chat in the project.
- **Files**: one shared workspace for the whole project. Upload files or folders, drag them in, create files and edit them in place. Every chat in the project can read, edit and run them. A bar shows how much of the storage is used, and **Download all** saves everything as a zip.
- A composer for starting a new chat in the project, and the list of chats already in it.

Move a chat in or out with **Add to project** in its menu or in the composer's **+** menu. Deleting a project deletes its files but keeps its chats.

## Artifacts

**Artifacts** in the sidebar lists every file the assistant has created across all your chats. Filter by file type, and click one to open the chat it came from. See [Artifacts and sandbox](artifacts-sandbox.md).

## Scheduled tasks

**Scheduled** in the sidebar, or the small button beside **New**, lists tasks that run a prompt for you on a schedule. Each task runs on its own schedule, such as every day at 9:00 AM, weekdays at 8:00 AM or every Friday. **New task** opens a blank task. The cards at the bottom of the page, such as **Morning plan**, **Language practice** or **Weekly review**, open the same editor already filled in, so you can change anything before saving. Click a task in the list to edit it again.

- **Name** and **Instructions**: the instructions are sent as your message on every run, so write them the way you would ask in a chat.
- **Repeat**: every day, weekdays, on chosen days (any mix of days of the week), every few minutes, hours or days (5 minutes to 7 days, counted from the last run), or once at a date and time. Daily and weekly tasks run at the time you pick.
- **Model**: the workspace default, or any model you can use.
- **Search the web**: shown when web search is set up on this server and the model allows it. Off, a run only uses what is on this server.
- **Keep runs in one chat**: every run continues the same chat, so the assistant can see what it said last time, which suits a running journal or a lesson series that should not repeat. Off, every run starts a new chat.
- **Active**: a paused task keeps its settings and only runs when you choose **Run now**.

Each run's reply lands in a chat you can answer like any other. Each task in the list shows its schedule, its next and last run and, when a scheduled run could not start (no model available, the budget reached, the previous run still going), the reason. It also has buttons to open the latest result, **Run now**, pause or resume it, and delete it. Sort the list by next run or by creation date.

A task runs on the server, so it only fires while the server is running, at the server's local time; a run missed while it was off happens once when it starts again. Beyond web search, a run works from the model's own knowledge plus your memory, instructions and any tools or connectors you have set up. That suits routines such as a plan for the day, a short lesson, practice drills, meal plans, a weekly review or journaling prompts. A task that starts a new chat each time does not see earlier runs, so instructions that should vary from day to day can ask the model to use today's date.

## Export and import

- **Settings → General → Your data → Export** downloads one JSON file with your chats, styles and memory.
- **Import** reads that file back. Its chats are added, your profile is merged, and nothing you already have is overwritten.
- **Export as** in a chat's menu saves a single chat as Markdown, JSON or PDF. The PDF has the title and export date, a summary if the chat has one, and each message labelled by who wrote it.