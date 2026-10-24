# Getting started

This page picks up once the server is running. To install it, see [Building and running](building.md).

## Create your account

On a new install there are no accounts, so the first screen is **Create account**. The first account becomes the owner and has every admin right.

If an account has two-factor authentication on, signing in asks for a 6-digit code after the password.

## Follow the setup guide

The owner sees a short setup guide the first time they sign in. Every step can be skipped and finished later in the Admin Panel.

1. **Basics**: name the workspace and choose who can create an account.
2. **Look**: pick a starting layout, Anthropic-style or OpenAI-style. You can change it later under **Admin Panel → Interface**.
3. **Connection**: use a model on this machine, which keeps everything local, or a paid service that needs an API key. Enter the address and press **Check the connection**.
4. **Choose your models**: tick the models you want from the list the backend reports.
5. **What does it cost?**: optional prices per model, used for usage and spend numbers. Leave them empty for local models.

When the guide finishes, the models are published and members can start chatting.

## Connect a model later

1. Start your model server. llama.cpp, Ollama, LM Studio and vLLM all work locally.
2. Open the profile menu at the bottom left, then **Admin Panel → Providers → Add connection**. Pick the type, check the base URL, add a key if the service needs one and press **Test**.
3. Press **Discover** to list the models the backend reports and add the ones you want. Or go to **Admin Panel → Models → Add model** and type a model id.
4. Open **Review changes** in the top bar and press **Publish**. Members do not see new models until you publish.

Cloud providers use public addresses, which are blocked by default. Either add the provider's host under **Admin Panel → Network**, or turn off **Block public internet** there.

See [Models and reasoning](models.md) for what members see, and the [Admin guide](admin-guide.md) for every model setting.

## Your first chat

- The home screen shows a greeting, the composer and any starter prompts. Click one or start typing.
- **Enter** sends. **Shift+Enter** starts a new line.
- The reply streams in as it is written. The chat gets a title after the first reply.
- The model picker sits at the bottom right of the composer, or at the top left of the chat in the OpenAI layout.

Next, read [Chatting](chatting.md) and [The composer](composer.md).