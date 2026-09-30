# Faculty Attendance (Netlify + Google Sheets)

Faculty check-in karta hai -> photo leta hai -> data **Google Sheet** me row ban jaata hai
aur photo **Google Drive** ke folder me save hoti hai. Admin panel `/admin` par hai.

```
Phone (PWA)  ->  Netlify Function (/api/*)  ->  Google Apps Script  ->  Google Sheet + Drive
```

## Step 1: Google Sheet + Apps Script

1. Nayi Google Sheet banao (naam kuch bhi, e.g. "Faculty Attendance").
2. **Extensions -> Apps Script** kholo.
3. `apps-script/Code.gs` ka poora code wahan paste karo (purana code hata do).
4. Upar `SECRET` ki value ko apne khud ke lambe random text se badlo. Ise yaad rakho.
5. Editor me function `authorizeOnce` select karke **Run** karo -> permissions Allow karo
   (Sheet aur Drive access maangega). Isse "Attendance" tab aur Drive me "Faculty Attendance Photos" folder ban jaata hai.
6. **Deploy -> New deployment -> type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy -> **Web app URL** copy karo (`https://script.google.com/macros/s/.../exec`).

> Code.gs baad me edit karo to **Deploy -> Manage deployments -> Edit -> New version** karna padega, warna purana code chalta rahega.

## Step 2: GitHub par push

```bash
git init && git add . && git commit -m "Faculty attendance"
# GitHub par empty repo banao, phir:
git remote add origin <repo-url> && git push -u origin main
```

## Step 3: Netlify par deploy

1. [app.netlify.com](https://app.netlify.com) -> **Add new site -> Import an existing project** -> apna repo choose karo.
2. Build settings apne aap `netlify.toml` se aa jaati hain (publish = `public`, functions = `netlify/functions`). Build command khali chhod do.
3. **Site configuration -> Environment variables** me ye add karo:

| Key | Value |
|---|---|
| `ADMIN_USER` | admin login username |
| `ADMIN_PASS` | strong password |
| `JWT_SECRET` | lamba random string |
| `APPS_SCRIPT_URL` | Step 1 ka Web app URL |
| `APPS_SCRIPT_SECRET` | wahi secret jo `Code.gs` me daala |
| `TIMEZONE` | optional, default `Asia/Kolkata` |

4. **Deploy** (env vars add karne ke baad ek baar redeploy zaroori hai).

## Step 4: Use

- `https://<your-site>.netlify.app/admin` -> login -> QR download karke faculty ko do.
- Har check-in Google Sheet ke "Attendance" tab me live dikhega.
- Sheet me se koi row delete/edit kar sakte ho; header row aur column order mat badalna.

## Local test

```bash
npm i -g netlify-cli
npm install
cp .env.example .env   # values bharo
netlify dev
```

## Notes

- Photos "Anyone with the link" se share hoti hain (admin table me dikhane ke liye). Link unguessable hota hai, par publicly search nahi hota.
- Google Sheet ki limit ~10 million cells hai; photos Drive me hain to attendance ke liye bahut kaafi hai.
- Apps Script ko ek request me 1-3 second lag sakte hain; sync background me hota hai, isliye faculty ko farak nahi padta.
