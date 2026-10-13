#!/usr/bin/env python3
"""Indicateur de barre pour le quota Grok.

Utilise l'extension Ubuntu « Indicateurs d'applications », déjà active
quand la liste des extensions GNOME Shell est verrouillée.
"""

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import AyatanaAppIndicator3 as AppIndicator
from gi.repository import GLib, Gtk

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "check-usage.js"
USAGE_URI = "https://grok.com/?_s=usage"
INTERVAL = max(60, int(os.environ.get("GROK_QUOTA_INTERVAL", "300")))


def node_version(executable):
    try:
        completed = subprocess.run(
            [str(executable), "-p", "process.versions.node"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        parts = []
        for piece in completed.stdout.strip().split("."):
            if not piece.isdigit():
                return ()
            parts.append(int(piece))
        return tuple(parts)
    except (OSError, subprocess.TimeoutExpired):
        return ()


def node_binary():
    # Hors terminal, `node` est souvent /usr/bin/node 12, qui ne connaît ni
    # `node:` ni fetch. On prend le Node 18+ le plus récent, y compris nvm.
    override = os.environ.get("GROK_QUOTA_NODE", "").strip()
    candidates = []
    if override:
        candidates.append(Path(override))
    nvm = Path.home() / ".nvm" / "versions" / "node"
    if nvm.is_dir():
        candidates.extend(sorted(nvm.glob("*/bin/node")))
    found = shutil.which("node")
    if found:
        candidates.append(Path(found))
    candidates.append(Path("/usr/local/bin/node"))
    candidates.append(Path("/usr/bin/node"))

    best = None
    best_version = ()
    seen = set()
    for candidate in candidates:
        if not candidate.is_file():
            continue
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        version = node_version(resolved)
        if version >= (18, 0, 0) and version > best_version:
            best = resolved
            best_version = version
    if best is None:
        raise RuntimeError(
            "Node.js 18 ou plus récent est introuvable. /usr/bin/node est trop ancien."
        )
    return str(best)


class QuotaIndicator:
    def __init__(self):
        self.indicator = AppIndicator.Indicator.new(
            "grok-quota",
            "utilities-system-monitor-symbolic",
            AppIndicator.IndicatorCategory.APPLICATION_STATUS,
        )
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self._node = node_binary()
        self.indicator.set_label("…", "100%")
        self.indicator.set_title("Quota Grok")
        self.menu = Gtk.Menu()
        self.indicator.set_menu(self.menu)
        self._render({"ok": False, "error": "Lecture du quota…"})
        self.refresh()
        GLib.timeout_add_seconds(INTERVAL, self._on_tick)

    def _on_tick(self):
        self.refresh()
        return True

    def refresh(self, *_args):
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            completed = subprocess.run(
                [self._node, str(SCRIPT), "--json"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(ROOT),
            )
            raw = (completed.stdout or "").strip()
            try:
                data = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                data = {}
            if not data.get("ok"):
                detail = data.get("error") or (completed.stderr or "").strip()
                first = detail.splitlines()[0] if detail else "Quota indisponible."
                data = {"ok": False, "error": first[:240]}
        except Exception as error:
            data = {"ok": False, "error": str(error)}
        GLib.idle_add(self._render, data)

    def _render(self, data):
        for child in self.menu.get_children():
            self.menu.remove(child)

        if not data.get("ok"):
            self.indicator.set_label("—", "100%")
            self.menu.append(self._label(data.get("error") or "Quota indisponible."))
        else:
            total = data.get("totalPercent")
            self.indicator.set_label(self._compact(total), "100%")
            title = "Grok"
            if data.get("plan"):
                title = f"Grok · {data['plan']}"
            self.menu.append(self._label(title))
            if data.get("email"):
                self.menu.append(self._label(data["email"]))
            self.menu.append(self._label(
                f"{data.get('periodLabel') or 'Quota'} : {self._percent(total)}"))
            for bucket in data.get("buckets") or []:
                self.menu.append(self._label(
                    f"{bucket.get('label')} : {self._percent(bucket.get('percent'))}"))
            text = data.get("text") or ""
            for line in text.splitlines():
                if line.startswith("Renouvellement") or line.startswith("Crédit") or line.startswith("À la demande") or line.startswith("Actualisé"):
                    self.menu.append(self._label(line))

        self.menu.append(Gtk.SeparatorMenuItem())
        self.menu.append(self._action("Actualiser", self.refresh))
        self.menu.append(self._action("Ouvrir l'usage", self._open_usage))
        self.menu.append(self._action("Quitter", self._quit))
        self.menu.show_all()
        return False

    def _label(self, text):
        item = Gtk.MenuItem.new_with_label(text)
        item.set_sensitive(False)
        return item

    def _action(self, text, callback):
        item = Gtk.MenuItem.new_with_label(text)
        item.connect("activate", callback)
        return item

    def _open_usage(self, *_args):
        Gtk.show_uri_on_window(None, USAGE_URI, GLib.get_monotonic_time() // 1000)

    def _quit(self, *_args):
        Gtk.main_quit()

    @staticmethod
    def _compact(value):
        if not isinstance(value, (int, float)):
            return "—"
        return f"{round(value)}%"

    @staticmethod
    def _percent(value):
        if not isinstance(value, (int, float)):
            return "—"
        rounded = round(value, 1)
        if abs(rounded - round(rounded)) < 0.05:
            return f"{round(rounded)} %"
        return f"{rounded:.1f} %".replace(".", ",")


def main():
    QuotaIndicator()
    Gtk.main()


if __name__ == "__main__":
    main()
