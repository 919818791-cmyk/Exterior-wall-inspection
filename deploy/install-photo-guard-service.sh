#!/usr/bin/env bash
set -Eeuo pipefail

guard_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard_unit_path="$guard_root_dir/deploy/systemd/building-photo-guard.service"
guard_unit_name="building-photo-guard.service"
guard_user="$(id -un)"

if [ ! -f "$guard_unit_path" ]; then
  echo "Missing service unit: $guard_unit_path" >&2
  exit 1
fi

chmod +x "$guard_root_dir/scripts/run-photo-guard-vllm.sh"
loginctl enable-linger "$guard_user"
systemctl --user link --force "$guard_unit_path"
systemctl --user daemon-reload
systemctl --user enable --now "$guard_unit_name"

printf 'Enabled %s for %s. Check with:\n' "$guard_unit_name" "$guard_user"
printf '  systemctl --user status %s\n' "$guard_unit_name"
printf '  journalctl --user -u %s -f\n' "$guard_unit_name"
