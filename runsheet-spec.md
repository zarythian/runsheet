# Runsheet — PWA Build Spec

## What this is
A one-stop-at-a-time route app for a solo ebike courier working the Sharon area, Israel.
Installable to an Android home screen (PWA) — no app store needed.

## Core flow
1. **Add stops** — three ways, all should work:
   - Paste a Google Maps link (extract lat/lng from the URL)
   - Type/paste raw `lat,lng`
   - Type a plain address → geocode it via API
   - **Bulk mode**: paste a multi-line block (one stop per line, mixed formats OK) and parse all of them at once
2. **Start point** — auto-detect current GPS location by default (browser geolocation, ask permission), with a manual override field for pasting a different start.
3. **Optimize** — compute the fastest visiting order (open path, no forced return to start). Use the routing API's optimization if available; fall back to a nearest-neighbor + 2-opt heuristic on straight-line distance if not.
4. **Manual override** — after optimizing, allow drag-to-reorder in the stop list, since the courier sometimes knows better than the algorithm.
5. **Work the route (HUD screen)** — one stop shown at a time:
   - Big glowing progress ring: "Stop X of N"
   - **Live running stat**, always visible (not just at the end): total km ridden and stops completed so far this route
   - Stop name/address, delivery notes, distance + ETA chips
   - Optional phone number field per stop — if present, show a **Call** button and an **ETA share** button (opens WhatsApp/share sheet with a pre-filled "On my way, ETA ~X min" message) on the HUD
   - If the stop is marked cash-on-delivery, show a clear **COD badge with the amount** on the card — must not be hidden until the end-of-day summary
   - **Navigate** button → opens that single stop in Google Maps (or Waze), turn-by-turn
   - **Done** button → optional quick camera capture for delivery photo proof, then marks delivered, mascot plays a happy animation, advances to next stop
   - **Skip** replaced by a **reason picker** — short tap-to-pick list: "No answer," "Wrong address," "Refused," "Gate locked" (customizable). Marks the stop pending with that reason attached, leaves it in place in the queue (does NOT auto-move it to the end). Mascot plays a disappointed/shake animation. Pending stops get a small orange flag/marker wherever they appear in the "Up next" list so they're never silently missed.
   - **Swipe gestures** on the stop card as a shortcut: swipe right = Done, swipe left = opens the reason picker. Buttons remain the primary/visible controls; swipe is a faster alternative for one-handed riding use.
   - **Undo last action** — a small, unobtrusive button that reverses the most recent Done/reason-pick in case of a mis-tap.
   - **Haptic buzz** (Vibration API) on Done/Skip/Undo taps, since the rider may not always be looking at the screen.
   - **Sunlight-readable mode** — a manual toggle for a high-contrast alternate theme, for riding in bright daylight versus the default dark HUD theme.
6. **Mascot** — small animated courier character near the bottom of the HUD screen. Happy hop + sparkles + cheerful line on Done. Sad shake + frown + short line on Skip. Idle gentle bob otherwise. (Reference implementation already built — ask for the `runsheet-hud-preview-v2.html` file for exact animation code/timing to reuse directly.)
7. **End-of-day summary** — once the last stop is marked Done, show a small recap screen: total distance, total time elapsed, stops completed, stops still pending (if any), and total cash collected (from COD stops). Pairs with a bigger mascot celebration moment.

## Mascot
A small animated character near the bottom of the HUD screen (reference implementation: `runsheet-hud-preview-v2.html` — reuse this code directly, don't rebuild from scratch):
- **Look**: original low-poly/flat-shaded character (inspired by, not copied from, old-school MMO art — hard two-tone shadow facets on face/hair/dress instead of smooth gradients), ginger bob hair, small cap, eyepatch, vest-over-apron outfit, holding a simple stylized scythe (generic design, not a specific named game item)
- **Overhead nameplate**: "RUNSHEET lv-X" text above the character with a small progress bar underneath — X and the bar fill are tied to real route progress (current stop number / total stops)
- **Idle**: gentle vertical bob loop
- **On Done**: happy hop animation, sparkle particles, a random cheerful line displayed prominently above the character, PLUS a small combat easter egg — the scythe swings and a tiny enemy character standing beside her flinches with a floating "69" damage number (comic/reference number, not literal)
- **On Skip**: sad shake animation, frown, a random "shake it off" style line — no combat animation, enemy unaffected
- Reactions auto-reset to idle after ~1.4s

## Visual design
Dark HUD aesthetic, built for glanceability at a red light, not a spreadsheet:
- Background: near-black asphalt (#0B0D10) with a very faint scanline texture
- Accent: hi-vis lime green (#C6FF3D) — matches courier safety gear
- Secondary: teal (#3DE0C8) for the "Done" action
- Glowing SVG progress ring, tabular (monospaced-style) numerals for anything numeric
- Big touch targets — Navigate/Done should be comfortably tappable one-handed while stopped on a bike

## Technical requirements
- Build as a PWA: proper manifest.json + icons, service worker for offline shell caching
- Must run over HTTPS or localhost — geolocation won't work otherwise
- Geocoding + route optimization via OpenRouteService API (I have a free API key)
- Persist stop list, route state, and pending/done status locally (localStorage or IndexedDB) so nothing is lost on app close
- Interface language: English for v1. Addresses can be typed in Hebrew or English — geocoding doesn't care, this is just about UI labels.
- Reference files to hand to Claude Code alongside this spec: `courier-route-optimizer.html` (list/optimizer UI direction) and `runsheet-hud-preview-v2.html` (HUD screen + mascot — reuse this code, don't rebuild it from memory)

## Explicitly not in v1
- No Hebrew UI / RTL layout yet
- No multi-day route history/saving yet
- No account system / cloud sync — single device, local only for now
