# Day Hub

One page for your day: **tasks, daily habits with points and streaks, a journal, an expense manager, and a YouTube music player** that plays without leaving the app. Cream-paper, hand-written look. Runs on your own computer (your data stays in one file) or on Vercel (your data stays in storage you own).

## Quick start

You need **Node 22.13 or newer**. There is nothing to install (no `npm install`). (`package.json` asks for Node 24 because that is what the Vercel copy runs; on your computer npm may print a warning about it, which you can ignore.)

```
node server.js        # or: npm start
```

Open http://127.0.0.1:3000. The first time, a four-step setup asks for your name, your currency and monthly budget, a few starter habits, and an optional YouTube link. You can skip it.

### On your phone

Run it with `HOST=0.0.0.0 node server.js`, then open `http://<your-computer-ip>:3000` on the same Wi-Fi. Use "Add to Home Screen" in the browser to get an app icon. **There is no login unless you set `DAYHUB_PASSWORD`**, so only do this on a network you trust, or set a password.

## What it does

- **Home tiles**: "Needs you now" (see *The rules* below), today's tasks, today's habits, the journal (today's prompt and a one-tap mood check-in), this month's spending against your budget, and the music player. On a wide screen the tiles sit in two columns.
- **Tasks**: due dates, star for priority, grouped as Overdue / Today / Upcoming / No date, undo after delete.
- **Habits** (from the commit() app): three kinds. *Daily check* (done or not), *Goal* (count up to a target, such as 8 glasses or 8,000 steps) and *Limit* (stay under a number, such as 3 coffees). Choose which weekdays each repeats on and an optional reminder time. Points: a check earns its points; a goal earns points in proportion; a limit earns its points while you are under it and **costs** them when you go over. Deleting a habit hides it but keeps your points and streak.
- **Streaks and badges**: a day counts for your streak when you make progress on a habit or write a journal entry (the first entry of a day is worth 10 points). 13 badges, from "First step" to "30-day streak", "10,000 words", "Night owl", "Early bird" and "Clean build" (finish every habit in a day with 3 or more habits, at least two of them real check-ins or goals, not just untouched limits). Each badge records the date you earned it.
- **Journal with a daily timeline**: the Day view shows one day top to bottom, in time order. Journal entries (you can write several a day), habits you ticked, spending and finished tasks all land on it with the time they happened. Habits with a reminder time show as dashed "planned" rows at that time and can be ticked right there. Limits and goals sit above it as a small tile, and untimed daily habits under "Anytime". Step back or forward a day, add an entry or expense for a past day, or tap a day in the Calendar tab to open it. The Entries tab is the month as a plain list. Free write or one of five rotating prompts, a 5-point mood, tags and word counts; a mood-only check-in is a valid entry.
- **Times**: new activity records the clock time. Things logged before this version have no time, so they show at the bottom of their day with a "·" instead of a time.
- **Expenses from the journal**: while you type an entry, Day Hub spots spending ("spent ₹250 on lunch", "paid 400 for fuel", "bought groceries for 540") and offers each one as a ticked box. Tick what you want and it is saved as a linked expense in the entry's day. It only suggests; nothing is added without your tick.
- **Spending**: amounts in ₹ by default (any currency code), 7 categories, month-by-month view, category bars, CSV export.
- **Music**: paste a YouTube video or playlist link into the box on Home (it plays the moment you paste). Saved links are listed. Music keeps playing while you switch tabs inside the app.
- **Reminders**: a daily journal reminder and a time per habit. They show inside Day Hub and, if you allow it in Settings, as system notifications. A web page cannot wake itself, so they only fire while Day Hub is open in a tab or window.
- **Backup**: Settings has a full JSON backup, an all-expenses CSV and a Markdown export of your stats, habits, badges and journal.

## The rules (how Day Hub decides things)

- **Streak**: counts consecutive days with real activity. Today never breaks it while it is still going. A day on which none of your habits is scheduled (say a weekday-only habit on a weekend) is a rest day: it neither adds to the streak nor breaks it. Going *over* a limit is not activity.
- **No time travel**: you cannot log a habit or write an entry for a day that has not happened yet.
- **Needs you now** (most urgent first, at most four): tasks that are overdue (longer overdue ranks higher) or due today, with starred ones ahead; habits whose reminder time has passed without being done; a nudge to write the day's entry after your journal reminder time (8 pm if you have not set one); and a warning once you pass the month's budget. Time-based items need the page's clock, so they refresh when you return to the tab.
- **Spending pace**: with a budget set, Home and Spending show roughly how much you can spend per day for the rest of the month, and from day 5 a warning if the month is on course to end over budget.
- **Timeline times**: something done now gets the current time. Something added to a past day gets no time unless you type one (the Day and Time fields in the entry sheet, Time in the expense sheet), instead of a made-up one. Within the same minute the order is habits, tasks, the journal entry, then its spending. A planned habit whose time has passed shows as "not done"; the timeline groups rows under Morning, Afternoon, Evening, Night and Late night.
- **Quick note on Home**: the Journal tile has a text box. Type, optionally pick a face for the mood, tick any spending it spotted and press Add to journal (or Ctrl/Cmd+Enter). It is saved with the current time. With the box empty, a face is still a one-tap mood check-in. "Full editor" opens the whole entry sheet (prompts, tags, day and time) carrying what you have typed. A half-typed note survives the dashboard refreshing.
- **Quick mood**: tapping a mood face within 30 minutes of the last quick tap corrects that check-in instead of adding another.
- **Expense detection**: ignores income and budgets ("earned ₹5000", "got paid", "refund", "budget ₹30000"); understands `k`, `lakh` and `crore`; reads "yesterday", "N days ago" and "on Friday" relative to the entry's day; and learns categories from your own past expenses (a word you have filed under the same category twice overrides the built-in word list). When you edit an entry, spending that is already saved with it is not suggested again, and you can add new spending found in the edited text. Editing an entry's day or time moves its linked spending too.

## Put it on Vercel

Vercel has no hard disk your app can keep, so the Vercel copy keeps your data in **Upstash Redis**, a small hosted store you add from Vercel's Marketplace (the free plan is plenty). Everything else is the same code: the points, streaks, timeline and spending rules all run unchanged.

1. **Deploy** this folder to a Vercel project (push to GitHub and import it, or run `vercel`). Leave the framework as "Other"; `vercel.json` already tells Vercel what to do.
2. **Add the storage**: in the project, open **Storage**, choose **Upstash Redis** (Marketplace), create a free database and connect it to the project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
3. **Set a password**: Settings, Environment Variables, add `DAYHUB_PASSWORD` with a password you will remember. Anyone who knows the address can reach a site on the internet, and this holds your journal, so **a hosted Day Hub shows nothing until a password is set**.
4. **Redeploy** (Deployments, the three dots, Redeploy). Open the site and sign in. Your sign-in lasts 30 days on that device.

Already have entries on your computer? Put the two storage values in a local `.env` file (copy them from the Upstash database page in Vercel) and run `npm run upload` once. It refuses to overwrite data that is already online unless you add `--force`.

How it works, so there are no surprises:

- Each request loads your data into a throw-away in-memory database, runs, and saves back only if something changed. Saves are checked ("only if nobody saved since I looked"), so two devices can never silently overwrite each other; if two collide, the later one is retried on the newer data.
- Everything is stored as one compressed snapshot. Upstash's free plan allows about 1 MB per request, so Day Hub stops saving at about 900 KB compressed and tells you. In plain text that is years of journal entries; use Backup in Settings now and then regardless.
- If you see "Storage is not connected", step 2 is missing or the project has not been redeployed since. `/api/health` on your site shows which storage and sign-in mode it is using (no secrets).
- Optional settings: `DAYHUB_SESSION_SECRET` (a long random string, signs the sign-in cookie), `DAYHUB_KEY_PREFIX` (to run two copies in one database), `DAYHUB_MAX_SNAPSHOT_KB` (raise it on a bigger Upstash plan).
- Reminders still only fire while the page is open; Vercel cannot wake your phone.

## Configuration (environment variables, or a `.env` file)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to allow other devices |
| `DB_PATH` | `data/dayhub.db` | SQLite file |
| `DB_CLIENT` | `sqlite` (`upstash` on Vercel) | Where data is kept |
| `DAYHUB_PASSWORD` | none | Ask for this password. Required on Vercel |
| `DAYHUB_SESSION_SECRET` | derived | Extra secret for the sign-in cookie |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | none | Upstash Redis (Vercel adds these). `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too |

Copy `.env.example` to `.env` to use a file.

## Things to know

- **Fonts** (Caveat, Patrick Hand) load from Google Fonts, so you need internet for the hand-written look. Offline it falls back to a plain font and still works.
- Some **YouTube** videos forbid embedding; try another link.
- Audio from embedded players may stop when a phone screen locks. That is a browser limit.
- One shared password at most (`DAYHUB_PASSWORD`), no accounts. Wrong guesses are rate-limited (best effort on Vercel, where each server instance counts for itself). On your computer the default is local-only (`127.0.0.1`) with no password. The server also checks the Host and Origin headers, sets a strict Content-Security-Policy, and limits request size.

## Switching databases

Storage sits behind a small interface in `src/store/`. `DB_CLIENT` picks the implementation in `src/store/index.js`: `sqlite` (a file) or `upstash` (Redis over HTTPS, for Vercel; it wraps the SQLite store as a per-request snapshot, see `src/store/serverless.js`). To use PostgreSQL or MySQL, write a module that exports a factory returning the same methods as `src/store/sqlite.js` and register it in `index.js`:

```
getSettings, setSettings,
listTasks, getTask, createTask, updateTask, deleteTask, dashboardTasks,
createExpense, deleteExpense, listExpenses, summarizeExpenses,
getHabit, listHabits, createHabit, updateHabit, setHabitLog, listLogs,
getEntry, listEntries, createEntry, updateEntry, deleteEntry,
listBadges, unlockBadges,
listMusic, getMusic, addMusic, deleteMusic,
exportAll, close
```

The rest of the app only talks to these methods. Money is stored as integer minor units (paise/cents). SQLite and Upstash are implemented today. A PostgreSQL or MySQL store would not need the snapshot trick, but it does need its own copies of the rules' queries.

## Tests

```
npm test
```

55 tests cover validation, YouTube link parsing, habit points and streaks, badges, expense detection, an upgrade from the first database version, security checks, every API route (using an in-memory database), and the Vercel side: the Upstash backend, snapshot store, two servers writing at once, the password sign-in and the Vercel entry point. The Vercel tests run against a small fake Upstash server in `test/helpers/`, so they need no account.

## Layout

```
server.js        start-up and shutdown (your computer)
api/index.js     the entry Vercel runs (see vercel.json)
vercel.json      Vercel settings: static files from public/, /api to the function, security headers
src/             router, API, store, sign-in, habits and journal rules, expense detection, music link parsing
src/store/       sqlite.js (file), upstash.js + serverless.js (Vercel)
scripts/         upload-data.js (copy your local data to Vercel)
public/          index.html, styles.css, js/ (plain ES modules, no build step)
test/            node:test suites
```
