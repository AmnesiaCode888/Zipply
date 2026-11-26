# Classifier-driven uncensored visual mode

## Intent

Use the configured classifier to recognize messages that are about topics such as cybersecurity, vulnerability discovery, security testing, penetration testing, or hacking. When a regular chat receives such a message, offer to turn on the `uncensored` visual mode for that chat before the assistant responds.

For now this is only a visual mode. It does not change the provider model, system prompt, or response behavior. The setting is per chat and one-way: once enabled manually or through the classifier prompt, it stays enabled for that chat and cannot be switched back.

## Goals and non-goals

- Classify each new user message while the chat is still in regular mode.
- Ask before changing the chat's visual mode; accepting enables it for the current and later messages in that chat.
- Persist the mode with the chat session so it survives chat switches and app restarts.
- Keep ordinary chat working when no classifier is configured or a classifier request fails.
- Do not add an uncensored provider model ID or route messages to a different model yet.
- Do not offer a switch back to regular mode once uncensored mode is enabled.

## Approaches

1. **Classify in `AgentRunner` and reuse the existing user-question flow (selected).** Before the main model response, call `ChatService.classify`; if the result qualifies, pause on the existing question UI. On acceptance, emit a typed mode-enabled event and persist it to the current session. This reuses the existing pause/answer path and avoids a separate renderer-only preflight flow.
2. **Classify in the renderer before starting the agent.** This gives the renderer direct control over a custom prompt, but requires new pending-send state and another confirmation path alongside the existing question UI.
3. **Change the mode automatically.** This removes the confirmation the user asked for and risks turning on the visual mode without consent, so it is excluded.

The first approach is selected based on the existing classifier helper and the chat's existing question/answer path.

## Behavior and constraints

- Use the configured `classifierModel` through the existing API key, Base URL, and `ChatService.classify` helper. Do not send the full chat history or attachments to the classifier; classify the latest user text only.
- Require a clear classifier result for the cybersecurity / vulnerability-testing category. If the classifier is unset, errors, or returns an invalid result, continue the normal response without showing a prompt.
- The prompt must say that enabling `uncensored` changes only the visual mode for this chat; the current provider model stays the same. Offer explicit enable and continue-regular options.
- If the user declines, keep the chat regular and continue the request. A later qualifying message may prompt again.
- A chat that is already in uncensored mode is locked there. Do not ask to return it to regular mode, and disable the manual off action.
- Keep existing chats compatible by treating a missing session mode field as regular.
- Follow `AGENTS.md`: rounded controls, no borders, focus glow, or shadows; keep the switch's state and disabled state accessible.

## Implementation calls left to the builder

- Name the persisted `ChatSession` boolean `uncensoredMode`.
- Keep the existing toggle as a one-way enable control and bind it to the active or draft chat.
- Add a small `AgentEvent` for enabling the mode after the user accepts the classifier prompt, then update the matching chat session in the renderer.
- Use a strict, short classifier response format and fail open to the regular visual mode on parsing or transport errors.
