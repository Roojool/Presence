# Presence. — your website, now with a real backend

You don't need to understand code to use this. Just follow the steps in order.

---

## What's in this folder?

| Thing | What it is | Do I touch it? |
|---|---|---|
| `START.bat` | **Double-click this to turn the website on.** | Yes, every time |
| `.env` | Your settings and password. Open it with Notepad. | Sometimes |
| `public/index.html` | Your website (the same design as before) | Only to change words or pictures |
| `public/admin.html` | Your private admin page | No |
| `server.js` | The "brain" that saves bookings | No |
| `data/presence.db` | **All your bookings live here.** It's created automatically. | **Never delete it.** Copy it somewhere safe sometimes as a backup. |
| `node_modules/` | Downloaded helper code | Never. You can ignore it. |

---

## 1. Turn it on (on your own computer)

1. Open the folder `C:\Users\Pratham\presence-website`
2. **Double-click `START.bat`**
3. A black window opens and your browser opens at **http://localhost:3000**
4. **Leave the black window open.** If you close it, the website turns off.

That's it. Try booking an hour on your own site.

> "localhost" means "this computer". Only **you** can see it right now.
> To let other people see it, do step 5 (putting it online).

---

## 2. See your bookings (the admin page)

1. With the black window open, go to **http://localhost:3000/admin**
2. Type your password. It's in the `.env` file on the line `ADMIN_PASSWORD=`

On the admin page you can:

- **confirm** a booking. Then click her phone number: WhatsApp opens with a confirmation message already typed for you.
- **cancel** a booking. That hour becomes free again on the website.
- see the **waitlist** (people who wanted an hour that was taken)
- **block out time** (holidays, busy days) so nobody can book it

### Change your password
1. Right-click `.env` → **Open with** → **Notepad**
2. Change the text after `ADMIN_PASSWORD=` (at least 8 characters, no spaces)
3. Save (Ctrl + S)
4. Close the black window and double-click `START.bat` again

**Any time you change `.env`, restart by closing the black window and double-clicking START.bat again.**

---

## 3. Get booking alerts on your phone (Telegram, free, about 5 minutes)

Right now new bookings only show up in the black window. Here's how to get them on your phone instead:

1. Install **Telegram** on your phone and open it.
2. Search for **@BotFather** (it has a blue tick) and press **Start**.
3. Send it: `/newbot`
4. It asks for a name. Type anything, e.g. `Presence Bookings`
5. It asks for a username ending in `bot`, e.g. `presence_pratham_bot`
6. It replies with a **token** that looks like `7412345678:AAH...xyz`. Copy it.
7. Open `.env` in Notepad and paste it after `TELEGRAM_BOT_TOKEN=`
8. Back in Telegram, open **your new bot** and send it any message (like "hi").
9. In your browser, go to this address, **replacing `TOKEN` with your token**:
   `https://api.telegram.org/botTOKEN/getUpdates`
10. Look for `"chat":{"id":` followed by a number, e.g. `"chat":{"id":123456789`. Copy that number.
11. Paste it in `.env` after `TELEGRAM_CHAT_ID=`
12. Save `.env`, restart (close the black window, double-click START.bat).

The black window should now say `telegram alerts : on`. Make a test booking and your phone will buzz.

---

## 4. Email alerts (optional, instead of or as well as Telegram)

With Gmail:

1. Your Google account needs **2-Step Verification** switched on.
2. Go to https://myaccount.google.com/apppasswords, create an app password called "Presence", and copy the 16 letters it shows.
3. In `.env`, fill in:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=youraddress@gmail.com
   SMTP_PASS=the16letterpassword
   NOTIFY_EMAIL=youraddress@gmail.com
   ```
4. Save and restart.

---

## 5. Put it on the internet (so other people can book)

The easiest option is **Render.com** (it has a free plan).

**Before you start:** the free plan wipes the database every time the site restarts or sleeps. For real bookings, pay for their cheapest plan **with a "Disk"** (about $7–8/month), or your bookings will vanish.

Steps:

1. Make a free account on **https://github.com**
2. Install **GitHub Desktop** (https://desktop.github.com), sign in, then
   **File → Add local repository →** choose `C:\Users\Pratham\presence-website` → it will offer to "create a repository". Say yes → **Publish repository** (keep it **Private**).
   *(Your `.env` file and your bookings are automatically NOT uploaded. That's on purpose, because they contain secrets.)*
3. Make an account on **https://render.com**, then **New + → Web Service →** pick your repository.
4. Fill in:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Under **Environment**, add each line from your `.env` file as a separate entry (name on the left, value on the right). Also add `TRUST_PROXY` = `1`.
6. (Paid plan) Under **Disks**, add a disk with **Mount Path** `/opt/render/project/src/data`
7. Click **Create**. In a few minutes you'll get an address like `https://presence-xyz.onrender.com`, which is your live website. The admin page is at `/admin` on that address.

You can connect your own domain name (like `presence.in`) in Render's settings later.

---

## 6. Taking a deposit with Razorpay (optional, and only when you're ready)

1. Sign up at https://razorpay.com and finish their business verification (KYC).
2. Dashboard → **Account & Settings → API Keys → Generate Key**.
3. In `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_live_xxxxx
   RAZORPAY_KEY_SECRET=xxxxx
   DEPOSIT_RUPEES=1000
   ```
   (Use the `rzp_test_` keys first to try it without real money.)
4. Restart. After booking, a payment window pops up. The admin page shows **deposit paid** or **not paid**.

Leave these empty and payments stay switched off. Bookings still work as normal.

---

## 7. Changing things

- **Hours on offer** (07:30, 10:00, 16:00, 19:00): change `SLOTS` near the top of `server.js` **and** the matching `<option>` lines in `public/index.html` (search for `07:30`). They must match.
- **Practices**: change `PRACTICES` in `server.js` **and** the `<option>` lines in `public/index.html` (search for `The Plus-One`).
- **Closed days**: `CLOSED_WEEKDAYS = [0]` in `server.js` (0 = Sunday, 6 = Saturday). For one-off days, use "Block out time" on the admin page instead.
- Restart after any change.

---

## When something goes wrong

| What you see | What to do |
|---|---|
| The black window flashes and closes | Open the folder, click the address bar, type `cmd`, press Enter, type `node server.js` and press Enter. Now you can read the error. |
| `EADDRINUSE` / "address already in use" | The website is already running in another black window. Close the extra one. |
| "Node.js is not installed" | Install the **LTS** version from https://nodejs.org, then try again. |
| Website says "cannot reach the server" | The black window is closed. Double-click START.bat. |
| Admin says "Admin is switched off" | Your `ADMIN_PASSWORD` in `.env` is too short (it needs 8 or more characters). |
| Telegram alerts don't arrive | Check the black window for a "notification failed" message. Usually the token or chat id has a typo, or you never sent your bot a message (step 3.8). |

**Backups:** every so often, copy `data\presence.db` to Google Drive or a USB stick. That one file holds every booking.
