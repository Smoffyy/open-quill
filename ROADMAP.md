# Roadmap

This roadmap outlines the planned direction of the project. Priorities may shift over time as the project evolves, community feedback is incorporated, and new ideas emerge.

---

## Planned in the Future

* [X] New Model Showcase. (Customizable interface background when model is selected (toggleable per model), smooth transition animation between switching models and if they have a background, as well as making other UI elements frosted glass to blend in well with custom backgrounds. Toggle button for IF background persists during conversation or uses default theme background.)
* [ ] Frosted Glass theme. (All UI elements get a nice frosted glass theme such as input bar, side bar, chats, and settings as well as menus such as model dropdown.)
* [X] Web Search Support. (Implementing a way to enable web search, url fetch, locally all on machine without using API's.)
* [ ] Text-To-Speech / Speech-To-Text (Ability to transcribe input microphone audio as well as playback from assistant responses) v2027?
* [X] Spaces. (A chat in which allows other users/admins to chat in including the Assistant. Inside the chat it will display the current user, messages with their appropriate avatar, and the assistant will know when to properly respond. A custom system prompt will be put in place for the assistant within a chat so that it knows when to respond and when a user is talking to it. Upon creating a chat, users/admins can search for a user and invite them to the chat, that user will then have the ability to accept/decline said chat.)
* [X] Proper support for Ollama, OpenAI API, VLLM, llama.cpp-server, LM-Studio, Open Router, MoonshotAI Kimi, Mistral, Meta. (Properly support these API endpoints, and all editable parameters properly.)
* [X] Track Usage / Token Consumption. (Allow users to view their token consumption as well as the cost per their model for that API endpoint.)
* [X] Revamp Database. (Current database is NOT secure for professional deployment, everything is stored in a json file for now.) <- Major overhaul.
* [X] Revamp Sandbox. (Whole terminal rework)
* [X] Toggle allow users to display reasoning.
* [X] Revamp toolcalling view.
* [X] Fix tool calling. (Make the tool calling better instead of a ```tool block, it keeps interfearing with the outputs of the assistant.) <- Major, when this is fixed the release will come out.
* [X] File Memory Bank. (Allow admins to upload files, and have a small system prompt that'll append to all models system prompt on tools for the model to view a certain file, or only certain lines of a file for best context management. It allows the assistant to learn in real time when needed without web search. This features can be enabled/disbale in the admin panel and is for all models)
* [X] Exporting and Importing All Chats.


* [X] Safety model, adds an option to enable a safety check, making the currently active model output either "Yes" or "No" based on the inputted text, allowing the model to then answer the question.

* [X] When "Show reasoning to users" is disabled, the "Thinking..." status doesnt shimmer, and if the user has the cursor enabled it must not show the cursor until the model stops thinking, then it will show the cursor.

* [ ] Create 2 presets, Anthropic preset, OpenAI preset. The OpenAI preset will arrage and reshape all icons to match OpenAI theme, same goes for anthropic. OpenAI theme will have circle cursor on by default unless overriden by user. When the first admin logs in, theyre given the choice of choosing between Anthropic or OpenAI theming. The OpenAI theme will have the Compact density between messages by default. Whenever openAI theme is enabled all models created by default will use icon size of 28px, show model name, as well as having "Left of text" logo position by default, as well as the "Static", "Generating", and "Thinking" will all NOT have any animation, meaning all those values by default will be "No motion". "Show logo in picker" will be off by default in OpenAI theming. OpenAI themeing will use Open Sans for all the Typographgy and footer by default everywhere.

* [ ] Fully refactor admin panel to be organized better overall.

* [ ] Localization, adding other languages support.

* [X] Fix in OpenAI theme whenever you input a long input it keeps switching and glitching.


---

## Notes

This roadmap is not final and will continue evolving as the project grows.