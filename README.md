# Day Hub

One page for your day: **tasks, daily habits with points and streaks, a journal, an expense manager, and a YouTube music player** that plays without leaving the app. Cream-paper, hand-written look.

**There is no database and no server-side data.** Day Hub is a static web page. Everything you enter is kept in *your browser, on your device*, and is never uploaded. Open it on another phone or computer and you start with a clean, separate Day Hub: your data is **per device** (more exactly, per browser profile). There are no accounts and no login, so nothing to sign in to and nothing for anyone else to read.

## Quick start

You need **Node 20 or newer** to serve the files. There is nothing to install (no `npm install`).

```
node server.js        # or: npm start
```

Open http://127.0.0.1:3000. The first time, a four-step setup asks for your name, your currency and monthly budget, a few starter habits, and an optional YouTube link. You can skip it.

`server.js` only hands the files in `public/` to your browser. It never sees your data. Any static host works the same way (see *Put it on Vercel* below), so you can also just open the hosted site.

### On your phone

Open the hosted site (or `HOST=0.0.0.0 node server.js` and `http://<your-computer-ip>:3000` on the same Wi-Fi) and use "Add to Home Screen" for an app icon. Your phone keeps its own data, separate from your computer's. To move data between devices, download a backup on one and use **Restore from backup** on the other.

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
- **Backup and restore**: Settings has a full JSON backup, an all-expenses CSV and a Markdown export of your stats, habits, badges and journal. "Restore from backup" reads a JSON backup back in. Backups are made on your device and handed to your browser's download; nothing is sent anywhere.

## The rules (how Day Hub decides things)

- **Streak**: counts consecutive days with real activity. Today never breaks it while it is still going. A day on which none of your habits is scheduled (say a weekday-only habit on a weekend) is a rest day: it neither adds to the streak nor breaks it. Going *over* a limit is not activity.
- **No time travel**: you cannot log a habit or write an entry for a day that has not happened yet.
- **Needs you now** (most urgent first, at most four): tasks that are overdue (longer overdue ranks higher) or due today, with starred ones ahead; habits whose reminder time has passed without being done; a nudge to write the day's entry after your journal reminder time (8 pm if you have not set one); and a warning once you pass the month's budget. Time-based items need the page's clock, so they refresh when you return to the tab.
- **Spending pace**: with a budget set, Home and Spending show roughly how much you can spend per day for the rest of the month, and from day 5 a warning if the month is on course to end over budget.
- **Timeline times**: something done now gets the current time. Something added to a past day gets no time unless you type one (the Day and Time fields in the entry sheet, Time in the expense sheet), instead of a made-up one. Within the same minute the order is habits, tasks, the journal entry, then its spending. A planned habit whose time has passed shows as "not done"; the timeline groups rows under Morning, Afternoon, Evening, Night and Late night.
- **Quick note on Home**: the Journal tile has a text box. Type, optionally pick a face for the mood, tick any spending it spotted and press Add to journal (or Ctrl/Cmd+Enter). It is saved with the current time. With the box empty, a face is still a one-tap mood check-in. "Full editor" opens the whole entry sheet (prompts, tags, day and time) carrying what you have typed. A half-typed note survives the dashboard refreshing.
- **Quick mood**: tapping a mood face within 30 minutes of the last quick tap corrects that check-in instead of adding another.
- **Expense detection**: ignores income and budgets ("earned ₹5000", "got paid", "refund", "budget ₹30000"); understands `k`, `lakh` and `crore`; reads "yesterday", "N days ago" and "on Friday" relative to the entry's day; and learns categories from your own past expenses (a word you have filed under the same category twice overrides the built-in word list). When you edit an entry, spending that is already saved with it is not suggested again, and you can add new spending found in the edited text. Editing an entry's day or time moves its linked spending too.

## Your data lives in your browser

This is the trade-off of having no server, so it is worth knowing:

- **Per device.** Each browser profile has its own Day Hub. Two devices (or two browsers on one computer, or a private window) do not share anything. Use Backup and Restore to copy data between them. Restore *replaces* what is on that device, and asks first.
- **Clearing site data deletes it.** "Clear browsing data", removing the site's data, or uninstalling the browser takes your entries with it. **Download a backup now and then** (Settings, Your data, Backup (JSON)).
- **iPhone / iPad Safari** may clear a website's data after about 7 days without a visit, unless the site is added to the Home Screen. Add Day Hub to your Home Screen, and keep a backup.
- **Room.** Browsers allow roughly 5 MB per site. That is years of text entries, but Settings shows how much you are using, and Day Hub tells you plainly if the browser is full (nothing is half-saved).
- **Blocked storage.** If the browser refuses to store site data, Day Hub still works for that visit, shows a warning, and forgets everything when the tab closes.
- **Several tabs** of one browser stay in step: a change in one shows up in the others.
- **If saved data cannot be read** (for example a damaged copy), Day Hub shows a recovery screen. It never overwrites it: you can download the saved text exactly as it was, then choose Start fresh (the unreadable copy is kept under another name).
- **The only outside requests** are the Google Fonts stylesheet (for the hand-written look) and the YouTube player when a link is playing. The page's Content-Security-Policy (`connect-src 'none'`) means the browser itself blocks the page from sending data anywhere.

### Moving over data from the earlier file-based version

If you used Day Hub when it kept data in `data/dayhub.db` on your computer (Node 22.13 or newer needed for this one step):

```
npm run export-old-data          # reads data/dayhub.db, writes dayhub-backup.json
```

Then open Day Hub, go to Settings, choose **Restore from backup** and pick `dayhub-backup.json`. The script only reads your database. A backup made by the earlier version's own "Backup (JSON)" button restores the same way.

## Put it on Vercel

The site is plain static files, so Vercel needs **no database, no storage add-on, no environment variables and no build**:

1. Push this folder to GitHub and import it in Vercel (or run `vercel`).
2. Leave the framework as "Other". `vercel.json` already says: no build, serve `public/`, add the security headers.
3. Deploy. That is all.

If you set it up earlier with Upstash and `DAYHUB_PASSWORD`, you can delete that Storage integration and those variables; nothing reads them any more. Data is not on Vercel at all, so the first visit to the new deployment starts empty: restore a backup (see above).

Anyone with the URL can open the site, but they get *their own* empty Day Hub; they cannot see yours, because yours is only in your browser.

## Things to know

- **Fonts** (Caveat, Patrick Hand) load from Google Fonts, so you need internet for the hand-written look. Offline it falls back to a plain font and still works.
- Some **YouTube** videos forbid embedding; try another link.
- Audio from embedded players may stop when a phone screen locks. That is a browser limit.
- A journal entry keeps your line breaks. (An earlier version flattened them to spaces.)
- The page sets a strict Content-Security-Policy, and the guard tests fail if any code in `public/` tries to use the network, a database or `fetch`.

## How it is built

The old "API" still exists, but it runs inside the page. `createBackend().call(method, url, body)` (in `public/js/core/backend.js`) matches a route, runs it against a JSON document held in the browser's `localStorage` (key `dayhub:data:v1`), and saves only if something changed. Every request is applied all-or-nothing: if saving fails (the browser is full) the change is undone and you get an error, never half a change. Calls are queued one at a time, and the document is re-read before each, so several tabs cannot overwrite each other.

All the rules (points, streaks, badges, the timeline, expense detection) are the same code as before. Money is stored as integer minor units (paise/cents). A restore or a load goes through a strict reader: a bad file is refused and changes nothing.

## Tests

```
npm test
```

53 tests cover validation, YouTube link parsing, habit points and streaks, badges, expense detection, every route (run in-process against an in-memory store), the browser store (saving, rollback when full, orphan clean-up, restore, damaged data, the older backup format), the static file server and its security headers, a guard that nothing in `public/` touches the network or a database, and a check that every `import { name }` between the page's modules really exists. They need no browser; the screens themselves were checked separately in a real browser (Chromium via Playwright), which is not part of `npm test`.

## Layout

```
server.js        a static file server for public/ (your computer); reads its headers from vercel.json
vercel.json      static deploy: no build, serve public/, security headers (CSP, nosniff, frame-deny)
public/          index.html, styles.css, manifest, icon
public/js/       the screens: plain ES modules, no build step
public/js/core/  the engine: store.js (the data), routes.js (what each action does), backend.js, router.js,
                 habits.js, commit.js, detect.js, insights.js, prompts.js, music.js, validate.js
scripts/         export-old-data.js (one-time: data/dayhub.db -> backup file)
test/            node:test suites
```
