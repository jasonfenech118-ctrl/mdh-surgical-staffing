# Duty Input Logic — notes & rules

This is the portable version of the **Duty Card** logic from the MDH Surgical
Staffing app. It's the part that lets you add an **extra duty (usually
Overtime)** on top of someone's rostered day — even when that day is Leave,
Sick, or Off — and record **when** it happens so a ☀️ sun (day) or 🌙 moon
(night) icon shows automatically.

- **Code:** [`duty-input-logic.js`](./duty-input-logic.js) — one self-contained
  file, no framework, no database, no page. Drop it into any project.
- Everything is editable: the menus are plain arrays and the code names are a
  simple alias map. Change them to fit your own project's words.

---

## The core idea

Each person has **one primary duty per day** (a shift code like `AL` = Leave).
Any **extra** duties for the same day are tucked into that row's free-text
**notes** as little tokens — so you never need a second table:

| Token in notes | Means |
| --- | --- |
| `[ALSO:OT]` | also did Overtime (no time given) |
| `[ALSO:OT@19-7]` | also did Overtime, 19:00 → 07:00 |
| `[TIME:7-14]` | the **primary** duty ran 07:00 → 14:00 |

So "on **Leave** in the day but **also** did Overtime 19:00–07:00" is stored as
one row: primary code `AL`, notes `[ALSO:OT@19-7]`.

---

## The rules, in plain English

### ☀️ / 🌙 icons
- **By hour** (`iconForHour`): `07:00`–`18:59` → ☀️ sun, everything else → 🌙 moon.
  This is what picks the icon for a typed Overtime time.
- **By code** (`dutyIcon`): Night → 🌙, any day-working code (All Day / Morning /
  Day / Evening) → ☀️.
- **Sick Leave is automatic** (`CODES_AUTO_ICON`): it shows **no** From/Till and
  borrows its icon from the person's core rostered duty.

### What you can add, and when (`allowedDutyOptions`)
The "add a duty" menu hides options that make no sense for the day:
- The raw pattern letters, Maternity, and COD-in/COD-off are hidden from the
  extra-duty menu by default.
- The day's **own** rostered duty is hidden (no point re-picking it).
- **TIL In** is hidden when the core duty is **All Day** or **Night**.
- **Sick / TIL Out / Leave / Study** are hidden when the core duty is **Off** or
  **Rest** — you can't take leave from a day you weren't working.
- Whatever is already selected always stays visible, so existing entries render.

### Overtime + leave together
- Overtime (`OT`) appears in the extra-duty menu as **"Overtime (Night)"** — it's
  usually a night. You can still give it any From/Till time.
- Add it as a second entry while the first entry stays Leave/Sick/Off. On save
  it becomes an `[ALSO:OT@from-to]` token on the same row.

### Safety — rest between a night and a day (`shiftSafetyIssue`)
- A nurse who finishes a **night** at 07:00 can't start a **day** the same
  morning. The function returns a plain-English warning if the proposed codes
  break that gap (in either direction — night-then-day, or day-after-night).
- Overtime counts as a night for this rule.
- **Charge nurses never work nights** — in the original UI their hour picker is
  limited to 06:00–19:00 and the "next day" night hours are removed. (That's a
  UI detail; the rest-gap rule itself is in this module.)

### Long Leave (`computeLongLeaveDisplay`)
- You never type "LL". Enter **Leave** (`L`); a block of **3+ consecutive leave
  days** displays as **Long Leave**.
- **Off / Rest days don't break the block**; any real working shift does.

### Change of Duty (COD)
- `COD-in` / `COD-off` can only sit on the **first (primary)** row, because they
  carry a "vice" (paired) date. `buildDutySave` rejects them as extras.

---

## How to use it

```js
// ES module
import * as Duty from "./duty-input-logic.js";
// or CommonJS
const Duty = require("./duty-input-logic.js");
// or a plain <script src="duty-input-logic.js"></script>  (functions become globals)
```

**Read the extra duties on a day:**
```js
Duty.parseSecondaryShifts(row);   // [{ code:"OT", time:"19-7" }]
```

**Build the menu for an "add duty" dropdown** (day is Leave):
```js
Duty.allowedDutyOptions("L");     // [{code,label}, ...]  (Overtime included)
```

**Turn the filled-in Day Card into something to store** — entry 0 is the
primary duty, entries 1+ are extras:
```js
const out = Duty.buildDutySave(
  [
    { code:"L",  time:"" },        // primary: on Leave all day
    { code:"OT", time:"19-7" }     // extra:   Overtime 19:00–07:00
  ],
  { staff, shiftDate:"2026-06-14" } // optional — enables the rest-gap check
);
// out => { shiftCode:"AL", reason:"leave", notes:"[ALSO:OT@19-7]" }
// or   => { error:"...human message..." }
```

**Pick the icon for a typed time:**
```js
const [from] = "19-7".split("-").map(Number);
Duty.iconForHour(from);           // "🌙"
```

---

## What to change for another project

- **`normaliseRosterCode` aliases** — the map of "annual leave"/"sick"/etc → your
  canonical codes. This is the one place code names are decided.
- **`SHIFT_PICKER_CHOICES`** / **`SECONDARY_SHIFT_CHOICES`** — the menus.
- **`DAY_CARD_HIDDEN_CODES`** and the `if` rules in `allowedDutyOptions` — the
  "what can I add, and when" policy.
- **`storeRosterCode`** — only special case is `L` → `AL`; adjust to your DB.
- The `[ALSO:...]` / `[TIME:...]` token format is just regex in a handful of
  functions if you'd rather store extras in a real column instead of notes.

---

## Where this came from in the original app

All of it was lifted from `index.html`:

| This module | In `index.html` |
| --- | --- |
| icons | `dutyIcon`, `iconForHour`, `CODES_AUTO_ICON` |
| extra-duty tokens | `parseSecondaryShifts`, `withSecondaryShiftTokens`, `SECONDARY_SHIFT_CHOICES` |
| menu rules | `dayCardCodeOptions`, `DAY_CARD_HIDDEN_CODES`, `SHIFT_PICKER_CHOICES` |
| save | `saveDayCard` (rewritten DOM-free as `buildDutySave`) |
| safety | `shiftSafetyIssue`, `isNightCode`, `isDayWorkCode` |
| long leave | `computeLongLeaveDisplay` |
| codes | `normaliseRosterCode`, `storeRosterCode`, `shiftLabel`, `reasonForShift` |

The two DOM-bound functions (`dayCardCodeOptions`, `saveDayCard`) were rewritten
as pure functions (`allowedDutyOptions`, `buildDutySave`) that take data and
return data — no page required.
