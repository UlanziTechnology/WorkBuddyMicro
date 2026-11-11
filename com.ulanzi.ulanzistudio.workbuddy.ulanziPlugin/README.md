# WorkBuddy for Ulanzi Studio

[中文说明](README.zh.md) · [Repository](https://github.com/UlanziTechnology/WorkBuddyMicro)

This guide describes the actions shipped with WorkBuddy Micro **1.11.8**. For source installation, development, compatibility records and licensing, see the [repository README](https://github.com/UlanziTechnology/WorkBuddyMicro#readme). The bundled [usage guide](usage-guide/index.html?language=en) is also available from the connection panel.

## Connect WorkBuddy

Deep-link actions—Wake WorkBuddy, New Task, Open Page and Install Skill—can be used directly. Choose `workbuddy://` for the domestic client or `workbuddy-ai://` for the overseas client in the inspector. This is a plugin-wide setting for deep-link routing. **CDP features currently target the domestic WorkBuddy client; WorkBuddy AI is outside the current CDP support scope.**

Live tasks, model switching, session interaction, voice input, sending, themes and credits require CDP. Save your work, then press **Launch WorkBuddy** or choose **Restart WorkBuddy** in the action's connection panel. Wait for **Connected**. No terminal command, hook configuration or separate Bridge service is required.

When disconnected, Launch starts or restarts the selected client with local debugging at `127.0.0.1:9223`. When connected, it brings WorkBuddy forward. Windows restart ends the selected installation's processes, including tray processes, and may interrupt tasks. If port 9223 is occupied, restart is blocked. After launch, connection detection waits up to 30 seconds.

On Windows, discovery checks running processes, protocol registration, per-user locations, Program Files and uninstall registry entries, including custom drives. If needed, set `WORKBUDDY_EXE` to the client's full executable path and restart Studio.

## Deep-link actions

| Action | Configure and use |
| --- | --- |
| Wake WorkBuddy | Open home or a selected destination. |
| New Task | Set a prompt template and optional working directory, expert, skills, connectors, model and mode. Press to open an unsent draft; sending remains your choice. |
| Open Page | Choose a destination. Opening a specific conversation requires its task ID; the key icon follows the selected page. |
| Install Skill | Enter a name and HTTPS package URL. Review and confirm installation inside WorkBuddy. |

New Task supports `{clipboard}`, `{date}` and `{time}`. For example:

```text
Summarize these notes and list next steps ({date}):
{clipboard}
```

Working directories must be absolute paths. Prompts are limited to 8,000 characters; skill and connector lists accept up to 20 unique entries each. Long prompts are truncated with feedback. Page destinations include home, projects, experts, skills, connectors, automation, colleagues, Claw, discovery, Tencent Docs, local/cloud files, IMA, Lexiang, mail and Space. Availability depends on the client version, region and enabled features. Earlier checks on WorkBuddy 5.3.14 found that Space left the current page unchanged and the cloud-files route opened the same file list.

## Recent tasks and session status

Add **WorkBuddy Task 1–5** to keys to show up to five recent conversations loaded by the client. Each key tracks its own conversation's state. Press to open the conversation displayed on that key. Slots follow the recent list rather than permanent assignments or a complete history query.

Green means idle, yellow means working, red means attention and gray means disconnected or unavailable. Completion attention requires an unread notification in WorkBuddy's conversation list. A task simply becoming idle does not create a completion alert.

**Current Session Status** is a separate Encoder action. During an approval, turn to choose an available native action, such as allow once, allow for the conversation or deny, and press to execute. There are no separate Allow/Deny key actions.

For standard question panels, turn through the actual options. Three rows are visible at a time, with a WorkBuddy marker on the highlighted row; long text is ellipsized. Single-choice actions follow the native panel's behavior. For multiple choices, press to toggle each item, then choose Submit. Paging and skip controls appear when the native panel provides them. **Other** brings WorkBuddy forward for typing; enter free text there. Custom dialogs may require separate support.

## Model Switch dial

Open the active conversation's composer with CDP connected. Turn to choose from the client's available models; the selection applies after a short pause. Press to apply the displayed selection immediately. The dial draws the model icon and label together in a rounded card.

Switching conversations refreshes the current model. If an approval temporarily hides the composer, the last known model is retained. Disconnection uses a gray card; `N` is shown when no model is known. Model availability and access remain controlled by WorkBuddy.

## Voice Input and Send Message

**Voice Input** starts or finishes WorkBuddy's native voice input. Recording is shown only after the client confirms it, with a blinking red dot. Allow microphone access in WorkBuddy and keep its composer available.

**Send Message** sends the current draft when WorkBuddy's send control is ready. Its icon follows the client's available, busy, unavailable or stop state. A stop image is a state indicator; it does not add a stop-task operation to this action.

## Switch Theme

1. Choose a local PNG, JPEG or WebP image, up to 20 MB, in the inspector. The plugin resizes it and creates a low-resolution key preview.
2. Optionally adjust text, secondary text, panels/input, user-message background, accent, selection and border colors. Reset to image colors restores the sampled palette.
3. Press the theme key to apply. Press the same key again to restore WorkBuddy's native theme. After editing the image or colors, the next press applies the updated theme.

You can also use **Restore native WorkBuddy theme** in the inspector. Different theme keys can hold different configurations. Styling is applied to the current renderer; a WorkBuddy reload clears the injected theme. Images and palette settings are stored with the action in Studio.

## Credit Balance

Add **Credit Balance** to either a key or a dial. It reads the remaining account credits through CDP, refreshes every 30 seconds and refreshes on press. Dial rotation has no balance action.

Initial or transient read failures retry every second. A temporary failure retains the last valid balance; disconnecting clears it. Without a readable balance, the display uses a gray unavailable image with a dash.

## Diagnosis and compatibility

Check the connection panel first when live controls stop updating. Reselect the action or restart Studio if the inspector receives no plugin status. Open WorkBuddy to verify that its native control is available. Review the installed plugin's `debug.log` for errors and redact private information before reporting a problem.

Key actions require a compatible Keypad surface; Model Switch and Current Session Status require an Encoder surface. Credit Balance supports both. Device visibility does not establish physical dial compatibility. Historical macOS and Windows verification records and remaining hardware/client limitations are listed in the repository README.

Code and artwork licensing are separate: retain [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). The repository has no project-level LICENSE; bundled brand and device artwork remains subject to its owners' rights.
