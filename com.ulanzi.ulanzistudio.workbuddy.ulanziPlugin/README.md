# WorkBuddy for Ulanzi Studio

Launch WorkBuddy, prefill task drafts, navigate pages, install skills and choose models with a dial.

## Use directly

Install the plugin ZIP, drag an action onto a key or encoder and configure its inspector. Deep-link actions require no extra service or setup flow.

- **Wake:** open home or a selected page.
- **New Task:** prefill an unsent draft. Supports `{clipboard}`, `{date}`, `{time}` and optional directory, expert, skills, connectors, model and mode. Prompts are limited to 8000 characters; deduplicated skill/connector lists accept up to 20 items each. Sending remains your choice.
- **Open Page:** select a destination; opening a specific task requires its ID. The key icon follows the page. Brand-disabled pages may fall back to home.
- **Model Switch:** enable CDP in setup and open the WorkBuddy composer. Turn the dial to switch between its available models.
- **Install Skill:** supply a name and HTTPS URL, then confirm installation inside WorkBuddy.

Select `workbuddy://` for the domestic client or `workbuddy-ai://` for the overseas package. Scheme is shared across plugin actions. Keypad actions cover D200, D200H, D200X and compatible hosts; the model action is Encoder-only. Device enums are left unrestricted for AU05/Vibe Key host compatibility.

## CDP connection

Press Launch WorkBuddy to start in CDP mode. When connected, the key brings WorkBuddy forward. When disconnected, it starts or restarts WorkBuddy in CDP mode. Voice Input, Send Message, Current Session Status and Switch Theme each include connection setup.

[Usage guide](usage-guide/index.html?language=en)

## Development and verification

Zero runtime npm dependencies; no build step. `package.json` declares CommonJS to avoid inherited module settings. Run `npm run check` and the Ulanzi plugin validator before packaging. ZIP the complete `.ulanziPlugin` folder as the archive root; keep the ZIP extension.

User-supplied icons/animations are normalized to 196×196; banners are 960×640 and use real Ulanzi device references. Artwork and brands remain with their respective owners; no extra redistribution license is granted.

Verified locally with macOS, WorkBuddy 5.3.14, Studio 3.4.13 and host Node 20.18.0. Windows, the overseas client and physical AU05/D200X encoder behavior require their corresponding environments; protocol simulations do not establish hardware behavior.

## 1.1.1 follow-up verification

Fixed empty prompts not opening home, long clipboard text splitting emoji before URL encoding, and missing truncation feedback. Wake now emits immediate feedback and fractional model indexes are rejected.

Simulated dial events changed the real client from GLM-5.3-Flash to Auto on a new task. Page routes were checked individually: in WorkBuddy 5.3.14 the Space entry leaves the current page unchanged, and the cloud-files parameter opens the same file list. These are current client behaviors.

Task keys 1–5 show recent chats from CDP. Press a key to open its displayed chat.

Credit Balance supports keys and encoders and reads remaining account credits via CDP every 30 seconds. Press to refresh. The inspector includes connection setup. An unavailable balance displays a gray dash.
