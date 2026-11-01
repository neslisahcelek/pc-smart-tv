# Smart TV Launcher — Agent Handoff

## 1. Project goal
Build a personal Smart-TV-like experience for a Windows PC permanently connected to a regular TV through HDMI. Control video browsing and playback from an iPhone without using the physical keyboard or mouse. The project is for a private home network; cloud hosting and accounts are not required for remote control.

## 2. Intended experience

### TV interface (Windows)
- Modern dark interface designed to be viewed from a distance.
- Large cards, readable typography, generous spacing, visible focus states, and keyboard navigation.
- Home screen with shortcuts for YouTube, Netflix, and configurable streaming websites.
- YouTube search and playback experience.
- Clear loading, empty, error, and unavailable-video states.
- Return-to-home action.
- Full-screen browser experience; do not require permanent Windows kiosk configuration for the MVP.
- Keep a practical way to exit and return to normal Windows desktop use.

### iPhone remote
- Separate responsive remote page accessible from iPhone Safari over the same home Wi-Fi/LAN.
- Search YouTube from the phone and display selectable results on the phone.
- Selecting a result should open/play that video in the TV interface.
- Provide play/pause, volume, home, back, and navigation controls where technically supported.
- Show connection status and recover gracefully after temporary disconnections.
- The iPhone acts as a remote; it does not need to mirror the TV screen.

## 3. Proposed technology
Use this stack unless workspace inspection gives a good reason to adapt:
- React + TypeScript + Vite frontend.
- Node.js + TypeScript local backend.
- WebSocket for real-time communication between the phone remote and TV interface.
- Separate TV UI, mobile remote UI, and server logic.
- npm scripts for development, production build, and tests.

If an existing project is present, inspect it first and adapt rather than overwrite unrelated work.

## 4. YouTube integration
- Use the official YouTube Data API v3 for search results.
- Keep the API key on the backend in an environment variable; never expose it in frontend code.
- Use the official YouTube IFrame Player API for playback and supported controls.
- Document API enablement, API-key setup, and quota considerations.
- Do not scrape YouTube pages or bypass ads, authentication, or playback restrictions.
- Handle videos that cannot be embedded or played gracefully and provide an option to open the video on YouTube.
- If no API key is configured, provide a fallback that opens YouTube search results in the TV browser.
- Do not assume third-party streaming services can be embedded. For Netflix and similar services, start with shortcuts that open their websites in the TV browser.

## 5. Local networking and security
- Phone and PC connect over the same private home Wi-Fi/LAN.
- Explain how to find the Windows PC's local IP address and open the remote page from iPhone Safari.
- Bind to the local network only when explicitly configured for LAN access.
- Validate WebSocket messages and allow only explicitly supported commands.
- Do not expose arbitrary shell execution, unrestricted URL launching, or filesystem access through remote commands.
- Keep remote access restricted to the private home network.
- Document any required Windows Firewall rule and avoid broad firewall access.
- No cloud hosting is required for the MVP.

## 6. Suggested MVP controls
- Connection status.
- YouTube search.
- Search results displayed on iPhone.
- Select a result and play it on TV.
- Play/pause.
- Volume buttons or slider.
- Home and back/navigation.
- Configured streaming-site shortcuts.
- Graceful handling of unavailable videos and lost connections.

Do not add features beyond this scope until the core flow works reliably.

## 7. Quality and project hygiene
- Include `.env.example` and `.gitignore`.
- Add basic automated tests for command validation and core behavior.
- Validate and sanitize user input.
- Include useful error handling and logs without leaking secrets.
- Keep dependencies limited and avoid overengineering.
- Run tests and production builds; fix failures before reporting completion.

## 8. Agent workflow
1. Inspect the current directory and existing files before making changes.
2. If empty, scaffold the project. Otherwise, preserve existing work and follow its conventions.
3. Implement a minimal vertical slice first: TV home screen, mobile remote page, local connection, and a test command proving remote-to-TV communication.
4. Verify the vertical slice before proceeding.
5. Add YouTube search and playback.
6. Add remaining supported remote controls and site shortcuts.
7. Run tests and production build. Fix failures.
8. Report what was implemented, what was tested, and any manual configuration still needed.

Do not stop at a plan or pseudocode. Implement the working MVP and verify it as far as the environment allows.

## 9. Windows setup and documentation
The README must provide exact copy-pasteable instructions for:
- Installing prerequisites.
- Installing dependencies.
- Creating/configuring `.env`.
- Enabling the YouTube Data API and setting the API key, if needed.
- Starting the app in development mode.
- Building and running the production version.
- Finding the PC's local IP address.
- Opening the remote page from iPhone Safari.
- Allowing required local traffic through Windows Firewall safely.
- Opening the TV UI in full-screen mode.
- Troubleshooting connectivity and playback issues.

## 10. Important constraints and decisions
- Target: Windows PC connected to a non-smart TV via HDMI.
- Remote: iPhone using Safari.
- Primary goal: TV-style interface with phone-based browsing and selection, not merely a generic mouse/keyboard remote.
- Keep the project local-first and simple.
- Avoid claiming universal support for third-party streaming playback; use official APIs where available and website shortcuts otherwise.
- Do not lock Windows permanently into kiosk mode for the MVP.
- The app should be easy to stop so the user can return to normal Windows use.
