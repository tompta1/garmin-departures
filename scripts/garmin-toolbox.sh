#!/usr/bin/env bash

set -euo pipefail

CONTAINER_NAME="${GARMIN_TOOLBOX_NAME:-garmin-ubuntu-host}"
CONTAINER_IMAGE="${GARMIN_TOOLBOX_IMAGE:-docker.io/library/ubuntu:22.04}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SDK_MANAGER_REL=".tools/connectiq/sdk-manager/bin/sdkmanager"
MONKEYC_REL=".tools/connectiq/sdk/9.1.0/bin/monkeyc"
SIMULATOR_REL=".tools/connectiq/sdk/9.1.0/bin/simulator"
WATCH_DIR_REL="connectiq-watch"
DEVELOPER_KEY_REL=".tools/connectiq/keys/developer_key.der"

APT_PACKAGES=(
  libcap2-bin
  sudo
  ca-certificates
  wget
  unzip
  xz-utils
  openjdk-17-jre
  libsecret-1-0
  libxext6
  libx11-6
  libxkbcommon0
  libxxf86vm1
  libsm6
  libatk1.0-0
  libgtk-3-0
  libwebkit2gtk-4.0-37
  libsoup2.4-1
  libjpeg8
  libcurl4
  libusb-1.0-0
  file
  binutils
)

host() {
  flatpak-spawn --host "$@"
}

toolbox_run() {
  host toolbox run -c "$CONTAINER_NAME" bash -lc "$1"
}

podman_root() {
  host podman exec --user root "$CONTAINER_NAME" bash -lc "$1"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  create      Create the Ubuntu toolbox and install Garmin runtime dependencies
  status      Show Connect IQ SDK Manager config and downloaded devices state
  sdkmanager  Launch Garmin Connect IQ SDK Manager inside the toolbox
  simulator   Launch the Connect IQ simulator inside the toolbox
  prg [id]    Build a device-specific .prg for sideloading (default: venu3)
  iq          Build the watch app as a packaged .iq
  run [id]    Launch simulator and sideload the built app for a device id (default: venu3)
EOF
}

ensure_container() {
  host toolbox create --assumeyes --image "$CONTAINER_IMAGE" "$CONTAINER_NAME" >/dev/null 2>&1 || true
  host podman start "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

patch_systemd_postinst() {
  podman_root "$(cat <<'SH'
python3 - <<'PY'
from pathlib import Path

p = Path("/var/lib/dpkg/info/systemd.postinst")
if not p.exists():
    raise SystemExit(0)

text = p.read_text()
old_copy = """    if [ -e /etc/resolv.conf ]; then
            cp /etc/resolv.conf /run/systemd/resolve/stub-resolv.conf
    fi
"""
new_copy = """    if [ -e /etc/resolv.conf ] && [ ! /etc/resolv.conf -ef /run/systemd/resolve/stub-resolv.conf ]; then
            cp /etc/resolv.conf /run/systemd/resolve/stub-resolv.conf
    fi
"""
old_tmpfiles = "        systemd-tmpfiles --create --prefix /var/log/journal\n"
new_tmpfiles = "        systemd-tmpfiles --create --prefix /var/log/journal || true\n"

if old_copy in text:
    text = text.replace(old_copy, new_copy, 1)
if old_tmpfiles in text:
    text = text.replace(old_tmpfiles, new_tmpfiles, 1)

p.write_text(text)
PY
SH
)"
}

install_deps() {
  patch_systemd_postinst
  local packages
  packages="$(printf '%s ' "${APT_PACKAGES[@]}")"
  podman_root "export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ${packages}
apt-get clean"
}

show_status() {
  toolbox_run "echo Container: $CONTAINER_NAME
echo
echo SDK Manager config:
find \$HOME/.Garmin/ConnectIQ -maxdepth 1 -type f 2>/dev/null | sort || true
echo
echo Downloaded device ids:
find \$HOME/.Garmin/ConnectIQ/Devices -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort || true"
}

launch_sdkmanager() {
  toolbox_run "cd '$REPO_ROOT' && exec './$SDK_MANAGER_REL'"
}

launch_simulator() {
  toolbox_run "cd '$REPO_ROOT' && exec './$SIMULATOR_REL'"
}

run_app() {
  local device_id="${1:-venu3}"
  toolbox_run "pkill -x simulator >/dev/null 2>&1 || true
pkill -x monkeydo >/dev/null 2>&1 || true
cd '$REPO_ROOT'
rm -f /tmp/garmin-simulator.log /tmp/monkeydo.log
nohup './$SIMULATOR_REL' >/tmp/garmin-simulator.log 2>&1 &
for _ in 1 2 3 4 5 6 7 8; do
  pgrep -x simulator >/dev/null 2>&1 && break
  sleep 1
done
'$HOME/.Garmin/ConnectIQ/Sdks/connectiq-sdk-lin-9.1.0-2026-03-09-6a872a80b/bin/monkeydo' './$WATCH_DIR_REL/build/garmin-departures.prg' '$device_id' >/tmp/monkeydo.log 2>&1 || {
  cat /tmp/monkeydo.log >&2
  exit 1
}
echo 'simulator ready'
echo 'device: $device_id'
echo 'simulator log: /tmp/garmin-simulator.log'
echo 'monkeydo log: /tmp/monkeydo.log'"
}

build_prg() {
  local device_id="${1:-venu3}"
  toolbox_run "cd '$REPO_ROOT/$WATCH_DIR_REL' && '../$MONKEYC_REL' -f monkey.jungle -y '../$DEVELOPER_KEY_REL' -d '$device_id' -o build/garmin-departures.prg -w"
}

build_iq() {
  toolbox_run "if [ ! -d \"\$HOME/.Garmin/ConnectIQ/Devices\" ]; then
  echo 'Missing \$HOME/.Garmin/ConnectIQ/Devices. Launch sdkmanager, sign in, and download device support first.' >&2
  exit 1
fi
cd '$REPO_ROOT/$WATCH_DIR_REL' && '../$MONKEYC_REL' -e -f monkey.jungle -y '../$DEVELOPER_KEY_REL' -o build/garmin-departures.iq -w"
}

main() {
  case "${1:-}" in
    create)
      ensure_container
      install_deps
      show_status
      ;;
    status)
      show_status
      ;;
    sdkmanager)
      launch_sdkmanager
      ;;
    simulator)
      launch_simulator
      ;;
    run)
      run_app "${2:-venu3}"
      ;;
    prg)
      build_prg "${2:-venu3}"
      ;;
    iq)
      build_iq
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
