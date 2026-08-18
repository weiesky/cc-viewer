# SuggestPluginInstall

Renders an inline plugin install card from `SearchPlugins` results, tying plugin suggestions to the user's request.

## When to Use

- A plugin search surfaced plugins that match what the user is trying to do, and you want to offer them for installation.

## Parameters

- `contextLabel` (string, required): Short header tying the suggestion to the user request (max 128 characters).
- `plugins` (array, required): Plugins sourced from `SearchPlugins` results — 1–16 entries, each with:
  - `pluginId` (string, required)
  - `pluginName` (string, required)
  - `description` (string, required)
  - `skills` (array, optional): Up to 32 `{name, description?}` entries describing the plugin's skills.

## Examples

### Example 1: Offer a matching plugin

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

The card is rendered for the user; enabling the plugin happens out of band. Call `ListPlugins` on follow-up to discover what was actually installed.

## Notes

- Only include plugins that came from search results — never invent plugin entries.
- Disabled under HIPAA enterprise configurations.
