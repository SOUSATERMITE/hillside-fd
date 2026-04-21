# Hillside FD — App User Guide

**URL:** hillside-fd.netlify.app

The app has three pages: **Sick**, **Recall**, and **Admin**. Use the navigation bar at the top to switch between them.

---

## 1. Sick Tracking — /sick

### Marking a firefighter sick

1. Go to the **Sick** page
2. Select the firefighter's name from the first dropdown
3. Select your name (the officer marking them) from the second dropdown
4. Tap **Mark Sick**

The firefighter immediately appears under "Currently Sick" and is blocked from the recall list until cleared.

---

### Clearing a firefighter (Return to Duty)

1. Find the firefighter under **Currently Sick**
2. Select your name from the **"Cleared by"** dropdown on their card
3. Tap **Clear — RTD**

The firefighter is removed from the sick list. They will now show as **RTD PENDING** on the Recall page until their first 24-hour shift back is confirmed.

---

### Status badges — what they mean

| Badge | Meaning |
|-------|---------|
| **SICK** (red) | Currently out sick. Cannot be recalled. |
| **RTD PENDING** (orange) | Cleared from sick but first 24hr shift not yet confirmed. Cannot be recalled. |
| *(no badge)* | Eligible — available for recall |

---

## 2. Recall List — /recall

### Reading the list

- Use the **Group 1 / 2 / 3 / 4** tabs to switch between tours
- Each group shows two lists: **FFs** on the left, **Captains** on the right
- The person at **Position 1** is next up for recall
- After a recall is recorded, that person moves to the bottom and everyone shifts up

### Color coding

| Color | Meaning |
|-------|---------|
| **Green** | Available — eligible for recall |
| **Yellow** | Worked a short minimum — one more short min sends them to the bottom |
| **Gray** | Not eligible — currently sick or RTD pending |

### Badges on the list

| Badge | Meaning |
|-------|---------|
| **SICK** (red) | Out sick, cannot be recalled |
| **RTD PENDING** (orange) | Cleared from sick, 24hr shift not confirmed yet |
| **⚠ Short min pending** | Has one short minimum on record |
| **Sub for [Name]** (blue) | Worked as a substitute — moves normally on their next recall |

---

### Recording a recall result

1. Select the **group tab** for the tour being recalled
2. In the **Record Recall** form at the top of the page:
   - **Select person** — the firefighter being recalled
   - **Recall type** — choose from the list below
   - **Recorded by** — your name (the officer recording it)
   - **Hours worked** — optional, fill in if relevant
3. Tap **Record Recall**

The list updates instantly and the entry is added to the Recall Log at the bottom of the page.

---

### Recall types — what each one does

| Type | What happens |
|------|-------------|
| **Full Shift (7hrs+)** | Person moves to the bottom of the list |
| **Short Minimum (4–7hrs)** | Person stays in place. A second short min moves them to the bottom. |
| **Refused** | Person moves to the bottom of the list |
| **Vacation Skip** | Person stays in place. No movement. |

---

### When someone refuses and another person takes the shift

1. Select the person who **refused** from the dropdown
2. Select **Refused** as the recall type
3. Check the box: **"Someone else took this shift"**
4. A second dropdown appears — select the person who substituted
5. Tap **Record Recall**

**What happens:**
- The person who refused moves to the bottom of the list
- The substitute stays in their current position
- A **"Sub for [Name]"** badge appears on the substitute's card
- The substitute moves to the bottom normally the **next time** they are recalled

---

### Confirming a 24hr shift from the Recall page

If a firefighter shows **RTD PENDING** on the recall list, you can confirm their 24hr shift directly here — you don't have to go to the Sick page.

1. Find the firefighter's card (gray with **RTD PENDING** badge)
2. Select your name from the **"Officer confirming"** dropdown on their card
3. Tap **Confirm 24hr**

The badge clears and the firefighter becomes eligible for recall immediately.

---

### Recall Log

At the bottom of each group tab is the full recall history for that group:

- **Date** — the shift date
- **Name** — who was recalled
- **Type** — color-coded: green = full shift, yellow = short min, red = refused, grey = vacation skip, blue = sub
- **Hrs** — hours worked (if entered)
- **By** — the officer who recorded it

---

## 3. Admin — /admin

The admin panel requires a password. Officers only.

### Adding a firefighter

1. Log into the **Admin** page
2. Fill in the firefighter's name, rank, and group number
3. Tap **Add Firefighter**

They are immediately added to the recall list for their group at the bottom position.

### Removing / deactivating a firefighter

1. Find the firefighter in the roster list
2. Tap **Deactivate**

They are removed from the recall list and no longer appear on the Sick or Recall pages.

### Adjusting recall list positions

If the list order ever needs to be manually corrected:

1. Go to the **Admin** page
2. Find the recall list section for the group
3. Change the position numbers directly and tap **Save**

---

### Viewing the audit log

The admin page shows a full log of all sick events — who was marked sick, when, by which officer, and when they were cleared.

### Viewing recall history

Full recall history for all groups is available in the Admin page under the Recall Log tab. You can see every recorded recall across all tours.

---

## Quick Reference Card

| What happened | Where to go | What to do |
|---------------|-------------|-----------|
| FF called in sick | Sick page | Select FF → Mark Sick |
| FF coming back | Sick page | Clear — RTD on their card |
| FF worked first shift back | Recall page or Sick page | Confirm 24hr on their card |
| FF worked a full recall (7hrs+) | Recall page | Record Recall → Full Shift |
| FF worked short (4–7hrs) | Recall page | Record Recall → Short Minimum |
| FF refused recall | Recall page | Record Recall → Refused |
| FF refused, someone else took it | Recall page | Refused + check "Someone else took this shift" |
| FF on vacation, skip their turn | Recall page | Record Recall → Vacation Skip |
| Need to check recall history | Admin page | Recall Log section |
| Need to add or remove a FF | Admin page | Roster section |
