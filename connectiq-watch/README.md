# Connect IQ Watch App Scaffold

This folder contains a minimal Garmin Connect IQ watch app that talks to the deployed backend:

- Backend URL: `https://garmin-departures.vercel.app/api/nearby-departures`
- App type: `watch-app`
- Permissions: `Communications`, `Positioning`

## Intended behavior

- First screen shows the nearest grouped stop
- Swipe down toggles the opposite direction for the current stop
- Swipe left and right move between nearest stop groups
- `Select` or `Menu` refreshes location and departures

On non-touch watches, the delegate also maps:

- `Next Page` to next stop
- `Previous Page` and `Next Mode` to direction toggle
- `Previous Mode` to previous stop

## Build In The Ubuntu Toolbox

From the repo root:

```bash
./scripts/garmin-toolbox.sh create
./scripts/garmin-toolbox.sh sdkmanager
```

That launches Garmin Connect IQ SDK Manager from the `garmin-ubuntu-host` Ubuntu 22.04 toolbox. Sign in with your Garmin account and download device support there once.

After the device catalog exists in `~/.Garmin/ConnectIQ/Devices`, build from the repo root with:

```bash
./scripts/garmin-toolbox.sh prg
./scripts/garmin-toolbox.sh iq
./scripts/garmin-toolbox.sh simulator
./scripts/garmin-toolbox.sh run venu3
```

If you only want the raw app binary, `prg` works before packaging. Packaging as `.iq` requires the downloaded Garmin device database. `simulator` opens Garmin's simulator UI from the toolbox so you can load the built app there.
`run venu3` is the faster debug loop: it starts the simulator and immediately sideloads the rebuilt `.prg`.

## Notes

- The manifest is currently narrowed to the downloaded touch targets `venu3`, `venu3s`, `vivoactive4`, `vivoactive4s`, `vivoactive5`, and `vivoactive6`.
- If your watch model is different, download it in SDK Manager first, then add its product ID in `manifest.xml`.
- The scaffold is intentionally simple and should be treated as a starting point, not store-ready UI.
- SDK Manager currently launches from the Ubuntu toolbox, but Garmin sign-in is still required before device downloads happen.
