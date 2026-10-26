# Privacy and security

## Incognito chats

Press the ghost button at the top right, `Alt+I`, or start one from the command palette. While an incognito chat is open:

- Nothing is saved to your history. Leaving it ends it for good.
- Web search and voice calls are unavailable.
- Nothing you type is stored as a draft.

Leave with the close button on the incognito bar, or by opening or starting a normal chat.

## Two-factor authentication

Set it up under **Settings → Security**. In your authenticator app, add an account using the secret key (or paste the setup URL), then enter the 6-digit code it shows to confirm.

You get one-time recovery codes. Keep them somewhere safe. They are the only way back in if you lose the device. After that, signing in asks for a 6-digit code after your password.

You can regenerate the recovery codes or turn two-factor off. Both need your password.

## Sessions

**Settings → Security → Active sessions** lists every device signed in to your account. **Revoke** any one, or **Revoke others** to sign out everywhere except here. Sessions end after 30 days without use by default. An admin can limit how many devices may be signed in at once.

## Deleting your data

- **Settings → General → Delete all saved chats** removes every chat and its files, and keeps your account.
- **Delete account** removes the account and everything in it. The owner account cannot be deleted.
- **Settings → Memory → Forget everything** clears your saved memories.
- An admin can remove a member under **Admin Panel → Members**, which also deletes that member's chats.

## Spending caps

If an admin set a monthly spending cap, a banner appears above the composer as you approach it. Once you reach it, sending may be paused until next month, depending on how the admin configured it.

## What leaves the machine

Open Quill runs entirely on your own hardware. By default nothing is sent anywhere. Traffic leaves only for features someone set up, and only to the address they gave:

- **Model requests** go to the provider address for each model. That is a local server unless an admin added a cloud provider.
- **Voice** uses the speech services an admin configured, or your browser's own speech recognition.
- **Web search** is off unless an admin sets it up. Then it reaches only their SearXNG instance and the result pages it reads.
- **MCP servers** run or connect only where an admin, or you under **Settings → MCP**, pointed them.
- **The sandbox** runs code with the machine's network access, so a script it runs can make its own requests.

Requests to public internet addresses are blocked by default. An admin can see every outbound attempt, and allow specific hosts, under **Admin Panel → Network**.

There is no telemetry, analytics or crash reporting. The usage numbers in Settings and the Admin Panel come from this server's own database and are never sent anywhere.

## Prompt screening

An admin can turn on **Guardrails**. A model checks each message before it reaches the assistant. A blocked message shows a banner above the composer, and the admin can see what was refused.