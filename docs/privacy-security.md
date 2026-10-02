# Privacy & Security

## Incognito chats

Press the ghost button at the top right, `Alt+I`, or use the command palette to start an incognito chat. While it is open:

- Nothing is saved to your history. Leaving it ends it for good.
- Sandbox tools, web search and voice calls are unavailable.
- Model backdrops are not shown.
- Nothing you type is stored as a draft.
- Replies cannot be rated, edited or deleted, since nothing is kept.

Leave with the close button on the incognito bar, or by opening or starting a normal chat.

## Two-factor authentication

Set it up under **Settings → Security**. Scan the QR code with an authenticator app, or type the secret in by hand, then confirm with a code. You get one-time recovery codes: keep them somewhere safe, because they are the only way back in if you lose the device. From then on, signing in asks for a 6-digit code after your password. Recovery codes can be regenerated and two-factor can be turned off, both with your password.

## Sessions

**Settings → Security → Active sessions** lists every device signed in to your account, with its browser, address and last activity. **Revoke** any one of them, or **Revoke others** to sign out everywhere except here. Sessions end on their own after 30 days without use by default, and an admin can limit how many devices may be signed in at once.

## Deleting your data

- **Settings → General → Delete all chats** removes every chat and its files, and keeps your account.
- **Delete account** removes the account and everything in it. The owner account cannot be deleted, so the workspace always has an owner.
- **Settings → Memory → Forget everything** clears your saved memories.
- An admin can remove a member from **Admin Panel → Members**, which deletes that member's chats too.

## Spending caps

If an admin has set a monthly spending cap, a banner appears above the composer as you approach it. Once you reach it, sending may be paused until next month, depending on how the admin set it up.

## What leaves the machine

Open Quill is built to run entirely on your own hardware. By default nothing is sent anywhere. Traffic leaves only for features someone deliberately set up, and only to the address they gave:

- **Model requests** go to the provider address configured for each model. That is a local server unless an admin added a cloud provider.
- **Voice** uses the speech services an admin configured, or your browser's own speech recognition.
- **Web search** is off unless an admin sets it up, and then only reaches their SearXNG instance, plus the result pages it reads.
- **MCP servers** run or connect only where an admin, or you under **Settings → MCP**, pointed them.
- **The sandbox** runs code with the same network access as the machine, so a script it runs can make its own requests.

Requests to public internet addresses are blocked by default. An admin can see every outbound attempt, and allow specific hosts, under **Admin Panel → Network**.

There is no telemetry, analytics or crash reporting anywhere in the app. The usage numbers in Settings and the Admin Panel are computed from this server's own database and are never sent anywhere.

## Prompt screening

An admin can turn on **Guardrails**, which has a model check each message before it reaches the assistant. A blocked message shows a banner above the composer, and the admin can see what was refused.