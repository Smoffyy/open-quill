# Privacy and security

## Incognito chats

Press the ghost button at the top right, `Alt+I`, or start one from the command palette. While an incognito chat is open:

- Nothing is saved to your history. Leaving it ends it for good.
- Web search and voice calls are unavailable.
- Nothing you type is stored as a draft.

Leave with the close button on the incognito bar, or by opening or starting a normal chat.

## Two-factor authentication

Set it up under **Settings → Security**. Scan the QR code with any authenticator app, or type the key it shows, then enter the 6-digit code the app gives you to confirm. Your organization may require two-factor; if so, you are asked to set it up before anything else.

You get 10 one-time recovery codes. Keep them somewhere safe. They are your way back in if you lose the device; otherwise an admin can reset your two-factor. After that, signing in asks for a 6-digit code after your password, and a code can never be used twice.

You can regenerate the recovery codes or turn two-factor off. Both ask for your password, or for a code when your account has no password.

## Signing in with your organization

If your organization uses single sign-on, sign in with its button on the sign-in page. **Settings → Security → Sign-in methods** lists the providers linked to your account. **Link** adds another one, and you can unlink any provider as long as another way in remains. If your organization uses a directory, the sign-in form asks for your email or username and checks your directory password, which Open Quill never stores.

## Sessions

**Settings → Security → Active sessions** lists every device signed in to your account, with how it signed in. **Revoke** any one, or **Revoke others** to sign out everywhere except here. Sessions end after 30 days without use by default. An admin can change that and limit how many devices may be signed in at once.

## Deleting your data

- **Settings → General → Delete all saved chats** removes every chat and its files, and keeps your account.
- **Delete account** removes the account and everything in it. The last owner cannot be deleted. If your organization manages your account through its directory, it is removed there instead.
- **Settings → Memory → Forget everything** clears your saved memories.
- An admin can remove an account under **Admin Panel → Users**, which also deletes its chats.

## Who can see your chats

Your chats are yours. Other people see one only when you share it from the **Share** button, and then only read it. Chats you start in a shared project stay private to you. Admins cannot browse your chats: an admin can open one only through quality review, when a reply failed a quality check, was rated, or was turned into a test case, and every such view is recorded in the event log.

## Spending caps

If an admin set a monthly spending cap, a banner appears above the composer as you approach it. Once you reach it, sending may be paused until next month, depending on how the admin configured it.

## What leaves the machine

Open Quill runs entirely on your own hardware. By default nothing is sent anywhere. Traffic leaves only for features someone set up, and only to the address they gave:

- **Model requests** go to the provider address for each model. That is a local server unless an admin added a cloud provider.
- **Voice** uses the speech services an admin configured, or your browser's own speech recognition.
- **Web search** is off unless an admin sets it up. Then it reaches only their SearXNG instance and the result pages it reads.
- **MCP servers** run or connect only where an admin, or you under **Settings → MCP**, pointed them.
- **Sign-in** with single sign-on or a directory reaches only the identity provider or directory an admin configured.
- **The sandbox** runs code with the machine's network access, so a script it runs can make its own requests.

Requests to public internet addresses are blocked by default. An admin can see every outbound attempt, and allow specific hosts, under **Admin Panel → Network**.

There is no telemetry, analytics or crash reporting. The usage numbers in Settings and the Admin Panel come from this server's own database and are never sent anywhere.

## Prompt screening

An admin can turn on **Guardrails**. A model checks each message before it reaches the assistant. A blocked message shows a banner above the composer, and the admin can see what was refused.