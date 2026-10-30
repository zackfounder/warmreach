# LinkedIn Autopilot

**The whole LinkedIn outreach workflow in one free Chrome extension:**

**Find** your ideal customers → **Connect** (no note) → **Message** the moment they accept → **Follow up** if they go quiet → **Learn** which message gets replies.

One button. Runs in your own Chrome. No account, no subscription, no server, no AI, no API keys. Free and open source.

> **Read this first.** LinkedIn's terms prohibit automation, and accounts get restricted, sometimes at low volume. LinkedIn Autopilot goes slowly and stops by itself if LinkedIn shows a warning, but it cannot make that risk zero. Use it on an account you can afford to lose, or don't use it. This project is not affiliated with LinkedIn.

## The workflow, step by step

| Step | What happens | You do |
|---|---|---|
| **1. Find** | Runs the searches you write (`solo founder`, `indie hacker`, anything you would type into LinkedIn), one page at a time, only on people you are not connected to. Saves everyone it finds. | Write the searches. Download everyone as a CSV whenever you want. |
| **2. Connect** | Presses Connect with **no note**. Skips anyone you already know. | Nothing. |
| **3. Message** | A few minutes after someone accepts, sends one of your first messages with their first name filled in. Versions go out in turn. | Write 1 to 3 versions (a question, feedback, a meeting ask). |
| **4. Follow up** | If there is no reply after a few days, sends a follow-up. Anyone who replies is left alone. | Choose 0 to 2 follow-ups and the gap in days. |
| **5. Learn** | A table shows how many people each version reached and how many answered. | Keep the winner, drop the rest. |

Messages use `{first_name}`, `{company}`, `{my_first_name}` and `{calendar_link}`. A version that needs something a person does not have (a company, say) is skipped for them.

## Why it is different

Looking for a free alternative to Waalaxy, Dripify, Expandi or Linked Helper? This is a different kind of tool.

| | LinkedIn Autopilot | Typical LinkedIn automation tools |
|---|---|---|
| **Price** | Free, MIT licensed | Usually a monthly subscription per account |
| **Where it runs** | In your own Chrome, on your computer | Often on the vendor's servers |
| **Your data** | Stays in your browser. It talks to LinkedIn and nothing else | Stored in the vendor's cloud |
| **Who gets messaged** | **Only people who accepted you.** Requests carry no note, and people you already know are never touched | Often cold messages or notes on the request |
| **Your messages** | Fixed texts you write, with the first name filled in. Nothing is generated | Often AI-written |
| **Learns what works** | Yes: versions rotate and a table shows the reply rate of each | Varies, often paid |
| **When LinkedIn warns you** | **Stops itself** and tells you (security check, logged out, "unusual activity", weekly invitation limit, three failed steps in a row) | Varies |
| **Pace** | Starts at 25% of your limits and ramps up over 14 days, working hours only, 3 to 9 minutes between actions | Varies |
| **Setup** | Load the folder in Chrome. About two minutes | Account, plan, onboarding |
| **Scriptable** | Optional local bridge so your own scripts or agents can read progress and queue messages, under the same limits | Rarely |

**What it is not:** it does not write messages for you, it does not run in the cloud (it works while Chrome is open), and it cannot promise your account will never be restricted.

## Install (2 minutes)

1. Download or clone this repository.
2. In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension` folder.
3. The settings page opens. Add your first name, check the searches and the messages, and press **Save**. (`examples/solo-founders.json` is a starting point you can import.)
4. Log in to LinkedIn in that same Chrome.
5. Click the LinkedIn Autopilot icon and press **Find people and message them**.

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
