# The Agricope POS demo

A live, fully working copy of the system for the client to try. Send them
**§ For the client** below; the rest is for you.

---

## What it is

The whole POS, running in the browser. Every feature works — ringing sales,
split payments, credit accounts, table service, the kitchen screen, shifts and
reports — because the app carries a complete mock server inside itself.

**Nothing is saved.** There is no database and no server. Each visitor gets
their own private copy of the demo world, and **refreshing the page resets it**.
That is the point: the client can void an order, blow a credit limit or close a
shift short, and simply reload to start clean. They cannot break it for anyone
else.

## Publishing it

The `Deploy demo to GitHub Pages` workflow builds and publishes on every push to
`main`. One-time setup on GitHub: **Settings → Pages → Source: GitHub Actions**.

The URL is `https://<your-username>.github.io/<repo-name>/`.

### Before you send the link

**A GitHub Pages site on a public repository is public** — anyone with the URL
can open it, and search engines can find it. The seed data contains Drumsticks'
real menu and prices. A menu is public information anyway, so this is usually
fine; decide knowingly rather than by accident. Private repositories cannot serve
Pages without a paid GitHub plan, so if the demo must be password-protected, host
it on Netlify or Cloudflare Pages instead — the built `app/dist/` folder is
plain static files and works on any of them.

### Testing the exact build before you push

```bash
cd "/Applications/Agricope/POS System/app" && VITE_BASE=/YOUR_REPO_NAME/ npm run build && cp dist/index.html dist/404.html && npx vite preview --base /YOUR_REPO_NAME/
```

`VITE_BASE` must match the repository name — Pages serves a project site from
`/<repo>/`, not from the domain root, and every asset URL carries that prefix.

---

## § For the client

**Agricope POS — try it here:** `https://<username>.github.io/<repo>/`

Works in any modern browser, on a laptop, tablet or phone. Nothing to install.

Sign in is two steps, exactly as it is on a real till: **the business signs in
once**, then **a PIN says who is standing at the till**.

**Business login:** `drumsticks@agricope.qa` — password `demo123`

Then pick the branch, and enter a PIN:

| PIN | Who | What they can reach |
|---|---|---|
| `3333` | Rhea, cashier | Register, orders, customers, shifts |
| `2222` | Imran, manager | The above, plus catalog, staff, reports and settings |
| `1111` | Yousuf, owner | Everything, including users and the floor plan |
| `4444` | Aisha, waiter | Tables, orders and the kitchen — no cash drawer |

Sign in as the manager or owner first — they see the most.

### Worth trying

- **Ring a sale.** Register → tap a few items → *Charge*. Pay part in cash and
  the rest by card; the change is calculated for you.
- **Put a sale on account.** Attach a customer at the charge screen and pay by
  *Credit*. Try a customer whose limit is too low — the till refuses, and offers
  to raise the limit if a manager PIN approves it.
- **Run a table.** Tables → seat a table → add a round → *Send to kitchen*. This
  branch prints a kitchen ticket; switch it to a kitchen screen in *Settings*
  and send another round to see the difference.
- **Ask for a big discount.** Anything above the threshold stops and asks for a
  manager's PIN.
- **Close the drawer.** Shifts → count the cash → the Z report shows whether the
  till is over or short.
- **Look at the numbers.** Reports covers the day, the week or the month, with
  payment mix, best sellers and who owes what.

The system speaks **QAR**, and every price already includes tax.

### Two things to expect

- **Refreshing the page starts the demo over.** Orders you rang will be gone.
  This is a demonstration copy with no database behind it — the real system
  keeps everything.
- **Printing opens a preview** rather than reaching a printer, since there is no
  hardware attached.

Please note anything that feels wrong, slow or missing — that feedback is the
reason this demo exists.
