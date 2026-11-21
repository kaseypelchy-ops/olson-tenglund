# My Garage - Vehicle directory and saved selections

## What this update does
- Adds a year -> make -> model selection flow on `/vehicle-directory`.
- Adds a separate `/api/vehicle-directory/options` endpoint for full model choice lists instead of a 50-row paginated browse result.
- Saves up to 20 vehicles on a customer's own device using `localStorage`, with a selectable active vehicle.
- Connects the storefront My Garage header link to the vehicle directory and displays the selected garage vehicle on the storefront.
- Keeps verified vehicle configuration / parts compatibility data separate from public reference vehicle entries.

## Install
Overlay this ZIP onto the **current** project checkout (not an older source archive).

```powershell
Set-Location -LiteralPath "C:\Users\Kasey Pelchy\Downloads\olson-tenglund-vercel\olson-tenglund-vercel"
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\olson-my-garage-update.zip" -DestinationPath (Get-Location).Path -Force
npm.cmd run typecheck
npm.cmd run build
```

If checks pass, deploy via GitHub. There is **no database migration** in this package. Existing `0003_vehicle_reference_library.sql` and the imported reference rows are required.

## Testing
1. Visit `/vehicle-directory`. Select a year/make/model, save it, refresh. It must persist.
2. Save a second vehicle and use Make active / Remove. Refresh.
3. Visit `/` and check the MY GARAGE header shows the active reference vehicle.
4. Click header MY GARAGE; it should return to the garage page.
5. Verify the regular storefront vehicle finder still requires verified engine/configuration information for part compatibility.

## Coverage and limits
- The previously generated EPA file is a **partial 1984-2026** reference set, not comprehensive US year/make/model/trim/engine coverage. Imported data can be checked in Inventory Workspace.
- An EPA model record doesn't prove exact configuration or parts compatibility. Future licensed ACES/PIES feed and curated vehicle normalization needed for production-grade lookup.
- Vehicles are stored in browser localStorage and are not synced to accounts or other devices.
- No automatic parts filtering based on a broad reference record; this would imply unverified fitment.
