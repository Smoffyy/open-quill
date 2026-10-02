# Getting Started

This page picks up once the server is running. For installing, see the [root README](../README.md#up-and-running).

## Creating your account

Open the app and you land on the sign-in screen. On a fresh install there are no accounts yet, so it opens on **Create account**. The first account becomes the **owner**, with every admin right. Whether anyone else can sign up is up to you, decided in the setup guide below and changeable later under **Admin Panel → Members → Accept new sign-ups**.

If an account has two-factor authentication on, signing in asks for a 6-digit code from the authenticator app, or a recovery code, after the password.

## The setup guide

The first time the owner signs in, a short setup guide walks through the basics. Every step can be skipped and done later in the Admin Panel.

1. **Basics**: name the workspace and choose who can create an account (anyone who can reach this server, or only you for now).
2. **Connect a model**: choose whether the model runs **on this machine** (free, nothing leaves your computer) or is **a paid service** that needs an API key. Enter the address, then **Check the connection**.
3. **Choose your models**: Open Quill lists every model the backend reports. Tick the ones you want.
4. **What does it cost?**: optional per-model input and output prices, used for the usage and spend numbers. Leave them empty for local models.
5. **Look**: choose a starting layout, Anthropic-style or OpenAI-style. You can change it any time under **Admin Panel → Interface**.

When it finishes, the models are published and everyone can start chatting.

## Connecting a model later

If you skipped the guide, or want to add another backend:

1. Start your model server. llama.cpp, Ollama, LM Studio and vLLM all work locally.
2. Open the profile menu (bottom-left) → **Admin Panel → Providers** → **Add connection**. Pick the type, check the base URL, add a key if the service needs one and press **Test**.
3. Press **Discover** to list the models the backend reports, and add the ones you want. Or go to **Admin Panel → Models → Add model** and enter the model id by hand.
4. Open **Review changes** in the top bar and **Publish**. Until then, members do not see the new models.

Cloud providers live on public addresses, which Open Quill blocks by default. Before a cloud connection will work, either add its host to the allowlist or turn off **Block public internet** under **Admin Panel → Network**.

See [Models & Reasoning](models.md) for what members see in the picker, and the [Admin Guide](admin-guide.md) for every model setting.

## Your first chat

- The **home screen** shows a greeting, the composer and, if set up, a row of starter prompts. Click one or just start typing.
- Press **Enter** to send and **Shift+Enter** for a new line.
- The reply streams in as it is written. The chat gets a title automatically after the first reply, unless an admin has turned chat titles off.
- The model picker sits at the bottom right of the composer (top left of the chat in the OpenAI layout).

From here, [Chatting](chatting.md) and [The Composer](composer.md) cover day-to-day use.