# Getting Started

For installation (Node.js, `npm run install:all`, `npm run build`, `npm start`) see the [root README](../README.md#setup). This page picks up once the server is running.

## Creating your account

Open the app and you'll land on the sign-in screen. On a brand-new install there are no accounts yet, so the screen forces **Create account** mode. The first account you create becomes the **owner**, with full admin rights. Every account after that follows whatever the admin has configured (open signup, or invite-only).

If two-factor authentication is enabled on an account, signing in asks for a 6-digit authenticator code (or a recovery code) after the password.

## Choosing an interface preset (admins, first run)

The first time an admin signs in, a **Choose your interface** modal appears, offering two complete looks:

- **Anthropic-style**, with a serif assistant voice and a warm cream/black palette.
- **OpenAI-style**, sans-serif, with a pill-shaped composer and a pure black/white palette.

Pick one and it applies instantly for every connected user. This isn't permanent. Change it any time from **Admin Panel → Appearance**, and it takes effect live for everyone with the app open.

## Connecting a model

Nothing works until a model provider is configured. As an admin:

1. Start your inference server (llama.cpp is the primary target; see [root README](../README.md#connecting-your-model)).
2. Open the profile menu (bottom-left) → **Admin Panel → Providers**, and set the base URL and API key.
3. Open **Admin Panel → Models**, add a model, and set its **internal model name** to whatever id your server expects.
4. Give it a display name, description, icon, and (optionally) a system prompt, then **Push to all clients**.

Once at least one model is published, it appears in the model picker for every user and chatting can begin. See [Models & Reasoning](models.md) for what each model setting does from a user's perspective, and [Admin Guide](admin-guide.md) for the full editor reference.

## Your first chat

- The **home screen** shows a greeting and, if configured, quick-prompt buttons. Click one or just start typing in the composer.
- Type a message and press **Enter** to send (**Shift+Enter** for a newline).
- The reply streams in token by token. Once it's a few messages long, the app auto-generates a title for the chat.

From here, [Chatting](chatting.md) and [The Composer](composer.md) cover the rest of day-to-day use.
