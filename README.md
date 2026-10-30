# Open Outreach

Free, open source LinkedIn outreach in a Chrome extension. It finds people, sends connection requests, messages them when they accept, and follows up if they stay quiet. Everything stays on your computer: **no account, no server, no AI, no API keys.**

> **Read this first.** LinkedIn's terms prohibit automation, and accounts get restricted, sometimes at low volume. Open Outreach goes slowly and stops by itself if LinkedIn shows a warning, but it cannot make that risk zero. Use it on an account you can afford to lose, or don't use it. This project is not affiliated with LinkedIn.

## What it does

1. **Finds people.** You write the searches you would type into LinkedIn (for example `solo founder`, `indie hacker`). It runs them one page at a time, looking only at people you are not connected to yet, and saves everyone it finds. You can download them all as a CSV.
2. **Connects.** It presses Connect, with no note.
3. **Messages on accept.** A few minutes after someone accepts, they get one of your first messages with their first name filled in. You can write several versions; they go out in turn so you can see which one gets answered.
4. **Follows up.** If there is no reply after a few days, it sends a follow-up (you choose how many, 0 to 2, and how many days apart).
5. **Stops at a reply.** Anyone who answers gets nothing more automatically.

Messages are fixed texts you write, with `{first_name}`, `{company}`, `{my_first_name}` and `{calendar_link}` filled in. Nothing is generated.

## Install (2 minutes)

1. Download or clone this repository.
2. In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension` folder.
3. The settings page opens. Add your first name, check the searches and the messages, and press **Save**.
4. Log in to LinkedIn in that same Chrome.
5. Click the Open Outreach icon and press **Find people and message them**.

It only works while Chrome is open. It acts about once a minute, only in your working hours (8:00 to 19:00 on weekdays by default), with 3 to 9 minutes between invitations and messages.

## Safety

- **Warm-up.** Limits start at 25% of your daily numbers and rise to 100% over 14 days. Defaults at full speed: 20 connection requests, 40 messages and 6 search pages a day, 90 connection requests a week.
- **It stops itself** and shows a notification on a security check, a logged-out page, "unusual activity" or "restricted" text, the weekly invitation limit, or three failed steps in a row. It stays stopped until you press Resume.
- **Practice mode** (in the popup) walks through everything but never clicks Connect or Send. On some profiles Connect sends the invitation immediately, which is why practice never clicks it.
- **People you already know** are never invited or messaged.
- It never sees or stores your LinkedIn password. You log in yourself, in your own browser.

## Privacy

Everything is stored in your browser's extension storage on your computer. The extension talks to LinkedIn and nothing else. The one exception is an optional, off-by-default [local bridge](docs/BRIDGE.md) that you can point at a program on the same computer; it refuses any address that is not `localhost` or `127.0.0.1`.

## Status

Early. The decision logic is tested in plain Node, and the whole loop is tested in a real Chrome against a local stand-in for LinkedIn. LinkedIn changes its pages often and the selectors in `extension/actions.js` (found by visible text and aria-labels, not class names) will need fixing from time to time. If a step fails, the popup log says which button it could not find. Issues and pull requests are welcome.

## Develop

```bash
npm install            # only for the tests
npx playwright-core install chromium   # Chrome for Testing, used by the browser tests
npm test
```

- `extension/core.js` is all the decisions (who to invite, message or follow up, the daily budget) with no browser in it.
- `extension/actions.js` is the only code that touches LinkedIn's pages.
- `extension/background.js` connects the two and keeps the schedule.
- `test/fixtures/li.html` is a stand-in for LinkedIn's pages (including the shadow-DOM pop-ups LinkedIn uses).

## License

MIT. See [LICENSE](LICENSE).
