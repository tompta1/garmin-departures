# Odjezdy — Prague transit departures for Garmin

A Garmin Connect IQ watch app that shows real-time public transport departures for stops near your current location, backed by a Vercel serverless API.

Currently covers **Prague and Středočeský kraj** via the [Golemio PID API](https://api.golemio.cz/pid/docs/openapi/).

---

## Features

- Finds the nearest transit stops using GPS
- Shows departures for the next 60 minutes (up to 10 per direction)
- Groups stops by name and lists each platform direction separately (A / B / C …)
- Colour-codes lines by mode: amber = tram, blue = metro, light-blue = trolleybus, grey = bus
- Smooth finger-drag scrolling through the departure list
- Swipe left / right to cycle through up to 5 nearby stop groups
- Tap the screen to switch between platform directions at the same stop
- 30-second inactivity timeout returns to the watch face
- In-app menu: manual refresh or exit

Supported devices: Venu 2/3 series, vivoactive 4/5/6, Forerunner 255/265/570/965/970, Fenix 7/8, Epix 2, Instinct 3 AMOLED, MARQ 2, D2 Mach 1.

---

## Repository layout

```
api/                    Vercel serverless function
  nearby-departures.ts  Main endpoint
lib/
  golemio.ts            Golemio departure-board client
  stop-index.ts         Nearest-stop grouping logic
  geo.ts                Haversine distance helper
  types.ts              Shared TypeScript types
data/
  stops-index.json      Pre-built GTFS stop index (gitignored — generate with npm run build:stops)
scripts/
  build-stops.ts        Downloads PID GTFS and builds stops-index.json
  garmin-toolbox.sh     Build helper — runs monkeyc inside an Ubuntu toolbox container
  make-icon.py          Generates the launcher icon PNG
connectiq-watch/        Garmin Connect IQ app source (Monkey C)
  source/
  resources/
  manifest.xml
vercel.json             Vercel region + function config
```

---

## Backend setup

### Requirements

- Node.js 20+
- A [Golemio API key](https://api.golemio.cz/api-keys/auth/sign-in) (free registration)

### Local development

```bash
npm install
npm run build:stops      # downloads PID GTFS (~25 MB) and builds data/stops-index.json
npm run check            # TypeScript type-check
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOLEMIO_API_KEY` | Yes | API key for Golemio PID departure boards |
| `ALLOWED_ORIGIN` | No | Restrict CORS to a specific origin |

### Deploy to Vercel

```bash
vercel --prod
```

The `data/stops-index.json` is bundled with the function via `vercel.json` → `includeFiles`.

### API

```
GET /api/nearby-departures?lat=50.083&lon=14.425
```

| Parameter | Default | Range | Description |
|---|---|---|---|
| `lat` | required | | WGS-84 latitude |
| `lon` | required | | WGS-84 longitude |
| `groups` | 5 | 1–10 | Number of nearby stop groups |
| `limit` | 10 | 1–10 | Departures per direction |
| `modes` | all | tram,metro,bus,trolleybus | Filter by transport mode |

---

## Watch app build

The watch app requires the Garmin Connect IQ SDK. The `garmin-toolbox.sh` script manages a disposable Ubuntu toolbox container so the SDK does not need to be installed on the host.

### First-time setup

```bash
# Create the container and install runtime dependencies
./scripts/garmin-toolbox.sh create

# Launch SDK Manager inside the container to sign in and download device support
./scripts/garmin-toolbox.sh sdkmanager
```

You will also need a [Garmin developer key](https://developer.garmin.com/connect-iq/programmers-guide/getting-started/) placed at `.tools/connectiq/keys/developer_key.der`.

### Build

```bash
# Build .prg for sideloading to a specific device (default: venu3)
./scripts/garmin-toolbox.sh prg venu3

# Build .iq package for Connect IQ Store submission
./scripts/garmin-toolbox.sh iq
```

The output is written to `connectiq-watch/build/`.

### Sideload to watch (USB Mass Storage)

1. Connect the watch via USB
2. Enable **USB Mass Storage** mode on the watch
3. Copy `connectiq-watch/build/garmin-departures.prg` to `GARMIN/APPS/` on the watch

---

## IQ Store submission

1. Register / log in at [apps.garmin.com/developer](https://apps.garmin.com/developer)
2. Build the `.iq` package: `./scripts/garmin-toolbox.sh iq`
3. Submit `connectiq-watch/build/garmin-departures.iq` through the developer portal

The app currently covers Prague and Středočeský kraj. The backend URL is configured in `connectiq-watch/source/GarminDeparturesConfig.mc`.

---

## License

MIT
