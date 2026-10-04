# Handy Little Lists – the Claude / ChatGPT connector

Lets people use Claude or ChatGPT to see and change their lists on DobyToday (to-do), PackbyBag (packing)
and ListbyAisle (shopping). It works on the copy of the lists saved in their account, so they need to be
signed in on the sites.

- `index.ts` – the connector. It runs on Supabase as the Edge Function **lists**:
  `https://nlbeqaoffratriysazrx.supabase.co/functions/v1/lists`
- `/oauth/consent` on each site – the page where people sign in and press **Allow** when they connect.

## Setting it up (once)

1. **Supabase → Authentication → URL Configuration.** The Site URL must be one of the three sites,
   e.g. `https://dobytoday.com` (the Allow page is on all three).
2. **Supabase → Authentication → OAuth Server.** Turn the OAuth server on. Authorization Path: `/oauth/consent`.
   Turn on **Allow dynamic client registration**. Save.
3. **Supabase → Edge Functions → Deploy a new function → Via editor.** Name it `lists`, paste the whole of
   `index.ts`, deploy. Then in the function's settings turn **Verify JWT** off (the connector checks sign-ins itself).

## Connecting

- **Claude:** Settings → Connectors → Add custom connector → name *Handy Little Lists*, URL above → Add → Connect.
- **ChatGPT:** Settings → Apps & Connectors → Advanced settings → turn on Developer mode → Create →
  name *Handy Little Lists*, URL above, Authentication: OAuth → Create.

## Tools

| Tool | What it does |
| --- | --- |
| get_my_lists | Shows the to-do, packing and shopping lists, sections/bags, urgent jobs, later days, saved lists |
| add_items | Adds items (DobyToday: section, later day, ❗ urgent; PackbyBag: bag, child's first name) |
| update_items | Tick, untick, remove, ❗ urgent on/off, move to a section, bag or later day |
| save_list | Saves a named list to My saved lists (new items, or a copy of the current list) |

Changes carry a new timestamp, so the sites take them the next time they open, come back on screen,
or within 20 seconds while open.
