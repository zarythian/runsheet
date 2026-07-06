# Runsheet

A one-stop-at-a-time route app for a solo ebike courier working the Sharon area, Israel.
Installable to an Android home screen — no app store, no backend, no account.

## Install on your phone

1. Open this site's URL in Chrome on your Android phone.
2. Tap the ⋮ menu → **Add to Home screen**.
3. Launch it from the home screen icon — it runs full-screen like a native app.

## First-time setup

1. Tap the ⚙️ settings icon (top right of the stop-list screen).
2. Paste your **OpenRouteService API key** (free at [openrouteservice.org](https://openrouteservice.org/dev/#/signup)).
   The key is stored only in your phone's browser (`localStorage`) — it is never committed to this
   repo and never sent anywhere except directly from your phone to OpenRouteService.
3. Without a key, the app still works: paste Google Maps links or `lat,lng` directly, and it'll fall
   back to straight-line distance estimates instead of real road routing. Address lookup and
   optimized road routing both require the key.

## Using it

- Add stops one at a time or paste a whole block of addresses/links at once (Bulk paste).
- Start point defaults to your GPS location — grant location permission when asked, or paste a
  different start manually.
- Tap **Optimize route**, then drag stops by the handle (⠿) to override the suggested order if you
  know better.
- **Start route** switches to the HUD screen: one stop at a time, Navigate/Done/Issue, swipe right
  for Done / left for Issue, undo, running distance/stop stats, and cash-on-delivery amounts stay
  visible on the card until the end-of-day summary.

## Notes

- All data (stops, route progress, settings) lives only in this browser's local storage — nothing
  syncs across devices, and clearing browser data clears the route too.
- Geolocation requires HTTPS (which GitHub Pages provides) or `localhost` — it will not work if this
  is opened over a plain `http://` LAN address.
