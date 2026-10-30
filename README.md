# Warmreach

**Free, open source LinkedIn outreach that runs inside your own Chrome.** It connects with no note, messages people only after they accept, follows up if they go quiet, and tells you which of your messages actually gets replies. No account, no subscription, no server, no AI, no API keys.

> **Read this first.** LinkedIn's terms prohibit automation, and accounts get restricted, sometimes at low volume. Warmreach goes slowly and stops by itself if LinkedIn shows a warning, but it cannot make that risk zero. Use it on an account you can afford to lose, or don't use it. This project is not affiliated with LinkedIn.

If you are looking for a free alternative to subscription tools like Waalaxy, Dripify, Expandi or Linked Helper, this is a different kind of tool: it lives in your browser, your data never leaves your computer, and it costs nothing.

## Why it is different

| | Warmreach | Typical LinkedIn automation tools |
|---|---|---|
| **Price** | Free, MIT licensed | Usually a monthly subscription per account, sometimes with a limited free tier |
| **Where it runs** | In your own Chrome, on your computer | Often on the vendor's servers, or tied to a vendor account |
| **Your data** | Stays in your browser. It talks to LinkedIn and nothing else | Stored in the vendor's cloud |
| **Who gets messaged** | **Only people who accepted you.** Connection requests carry no note, and people you are already connected to are never touched | Often cold direct messages or notes on the request |
| **Your messages** | Fixed texts you write, with the first name filled in. Nothing is generated, so nothing surprising goes out under your name | Often AI-written or sequence builders |
| **Does it learn what works?** | Yes: your versions go out in turn and a table shows the reply rate of each | Varies, often a paid feature |
| **When LinkedIn warns you** | It **stops itself** and tells you (security check, logged out, "unusual activity", weekly invitation limit, or three failed steps in a row) | Varies |
| **Pace** | Starts at 25% of your limits and ramps up over 14 days, working hours only, 3 to 9 minutes between actions | Varies |
| **Setup** | Load the folder in Chrome. About two minutes. No Docker, Python or model keys | Account, plan, onboarding |
| **Scriptable** | Optional local bridge so your own scripts or agents can read progress and queue messages, under the same limits | Rarely |

**What it is not:** it does not write messages for you, it does not run in the cloud (it works while Chrome is open), and it cannot promise your account will never be restricted.

## What it does

1. **Finds people.** You write the searches you would type into LinkedIn (for example `solo founder`, `indie hacker`). It runs them one page at a time, looking only at people you are not connected to yet, and saves everyone it finds. You can download them all as a CSV.
2. **Connects.** It presses Connect, with no note.
3. **Messages on accept.** A few minutes after someone accepts, they get one of your first messages with their first name filled in. Write several versions: they go out in turn so you can see which one gets answered.
4. **Follows up.** If there is no reply after a few days, it sends a follow-up (you choose how many, 0 to 2, and how many days apart).
5. **Stops at a reply.** Anyone who answers gets nothing more automatically.

Messages use `{first_name}`, `{company}`, `{my_first_name}` and `{calendar_link}`. A version that needs something a person does not have (a company, say) is skipped for them.

## Install (2 minutes)

1. Download or clone this repository.
2. In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension` folder.
3. The settings page opens. Add your first name, check the searches and the messages, and press **Save**. (`examples/solo-founders.json` is a starting point you can import.)
4. Log in to LinkedIn in that same Chrome.
5. Click the Warmreach icon and press **Find people and message them**.

It only works while Chrome is open. It acts about once a minute, only in your working hours (8:00 to 19:00 on weekdays by default).

## Safety

- **Warm-up.** Limits start at 25% of your daily numbers and rise to 100% over 14 days. Defaults at full speed: 20 connection requests, 40 messages and 6 search pages a day, 90 connection requests a week.
- **It stops itself** and shows a notification on any warning from LinkedIn. It stays stopped until you press Resume.
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
