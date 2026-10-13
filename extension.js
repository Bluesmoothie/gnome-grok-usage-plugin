// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const { Clutter, Gio, GLib, GObject, Soup, St } = imports.gi;
const ByteArray = imports.byteArray;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Me = ExtensionUtils.getCurrentExtension();
const Auth = Me.imports.lib.auth;
const Billing = Me.imports.lib.billing;
const Format = Me.imports.lib.format;

const USAGE_URI = "https://grok.com/?_s=usage";
const BAR_WIDTH = 220;

const Indicator = GObject.registerClass(
class GrokQuotaIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, "Quota Grok", false);

        this._settings = settings;
        this._alive = true;
        this._generation = 0;
        this._timeoutId = 0;
        this._settingsId = 0;
        this._snapshot = null;
        this._email = "";
        this._fetchedAt = null;
        this._error = null;
        this._session = new Soup.Session({ timeout: 20 });

        const iconFile = Me.dir.get_child("icons").get_child("grok-quota-symbolic.svg");
        const box = new St.BoxLayout({ style_class: "panel-status-menu-box" });
        box.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(iconFile.get_path()),
            style_class: "system-status-icon grok-quota-icon",
            icon_size: 16,
        }));
        this._label = new St.Label({
            text: "…",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "grok-quota-label",
        });
        box.add_child(this._label);
        this.add_child(box);

        this.menu.actor.add_style_class_name("grok-quota-menu");
        this._settingsId = this._settings.connect("changed", () => {
            this._schedule();
            this._refresh();
        });
        this._schedule();
        this._refresh();
    }

    _onDestroy() {
        this._alive = false;
        this._generation += 1;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        super._onDestroy();
    }

    _schedule() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        const seconds = this._settings.get_int("refresh-interval");
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _grokHome() {
        const custom = this._settings.get_string("grok-home").trim();
        if (custom)
            return custom;
        const env = GLib.getenv("GROK_HOME");
        if (env)
            return env;
        return GLib.build_filenamev([GLib.get_home_dir(), ".grok"]);
    }

    _baseUrl() {
        const custom = this._settings.get_string("proxy-base-url").trim();
        if (custom)
            return custom;
        return GLib.getenv("GROK_CLI_CHAT_PROXY_BASE_URL") || Billing.DEFAULT_BASE_URL;
    }

    _thresholds() {
        return {
            warn: this._settings.get_int("warn-threshold"),
            critical: this._settings.get_int("critical-threshold"),
        };
    }

    _refresh() {
        if (!this._alive)
            return;
        const generation = ++this._generation;
        let auth;
        let version = Billing.DEFAULT_CLIENT_VERSION;
        const home = this._grokHome();
        try {
            auth = readJson(GLib.build_filenamev([home, "auth.json"]));
        } catch (error) {
            this._fail(generation, "Session introuvable. Lancez grok login.");
            return;
        }
        try {
            const versionJson = readJson(GLib.build_filenamev([home, "version.json"]));
            version = Auth.readClientVersion(versionJson, Billing.DEFAULT_CLIENT_VERSION);
        } catch (error) {
            version = Billing.DEFAULT_CLIENT_VERSION;
        }

        const credential = Auth.selectCredential(auth, new Date());
        if (!credential) {
            this._fail(generation, "Session introuvable. Lancez grok login.");
            return;
        }
        if (credential.expired) {
            this._email = credential.email;
            this._fail(generation, "Session expirée. Lancez grok login.");
            return;
        }

        const headers = Billing.requestHeaders(credential.token, version);
        const base = this._baseUrl();
        this._email = credential.email;
        this._load(generation, Billing.billingUrl(base), Billing.settingsUrl(base), headers);
    }

    _load(generation, usageUrl, settingsUrl, headers) {
        this._fetch(usageUrl, headers).then(usage => {
            if (!this._alive || generation !== this._generation)
                return null;
            if (usage.status === 401 || usage.status === 403) {
                this._fail(generation, "Session refusée. Lancez grok login.");
                return null;
            }
            if (usage.status < 200 || usage.status >= 300)
                throw new Error(`HTTP ${usage.status}`);
            let snapshot = Billing.normalizeCredits(JSON.parse(usage.body));
            if (!snapshot.ok)
                throw new Error(snapshot.error || "Réponse inattendue.");
            return this._fetch(settingsUrl, headers).then(settings => {
                if (settings.status >= 200 && settings.status < 300)
                    snapshot = Billing.applySettings(snapshot, JSON.parse(settings.body));
            }).catch(error => {
                log(`grok-quota: forfait illisible : ${error.message}`);
            }).then(() => {
                if (!this._alive || generation !== this._generation)
                    return;
                this._snapshot = snapshot;
                this._fetchedAt = new Date();
                this._error = null;
                this._render();
            });
        }).catch(error => {
            if (!this._alive || generation !== this._generation)
                return;
            const message = error && error.message ? error.message : "Lecture impossible.";
            if (this._snapshot) {
                this._error = "Dernière lecture impossible.";
                this._render();
            } else {
                this._fail(generation, message.indexOf("HTTP") === 0 ? "Quota indisponible." : "Quota indisponible.");
            }
            log(`grok-quota: ${message}`);
        });
    }

    _fetch(url, headers) {
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new("GET", url);
                if (!message) {
                    reject(new Error("URL invalide."));
                    return;
                }
                const names = Object.keys(headers);
                for (let i = 0; i < names.length; i++)
                    message.request_headers.append(names[i], headers[names[i]]);
                this._session.queue_message(message, (_session, msg) => {
                    if (!this._alive) {
                        reject(new Error("Annulé."));
                        return;
                    }
                    let body = "";
                    try {
                        const data = msg.response_body ? msg.response_body.data : "";
                        body = typeof data === "string" ? data : ByteArray.toString(data || new Uint8Array());
                    } catch (error) {
                        body = "";
                    }
                    resolve({ status: msg.status_code, body });
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    _fail(generation, message) {
        if (!this._alive || generation !== this._generation)
            return;
        this._snapshot = null;
        this._fetchedAt = null;
        this._error = message;
        this._render();
    }

    _render() {
        const thresholds = this._thresholds();
        const level = this._snapshot
            ? Format.severity(this._snapshot.totalPercent, thresholds.warn, thresholds.critical)
            : "ok";
        this._label.text = this._snapshot ? Format.panelText(this._snapshot) : "—";
        this._label.style_class = `grok-quota-label ${level}`;

        this.menu.removeAll();
        if (!this._snapshot) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(this._error || "Quota indisponible.", {
                reactive: false,
                can_focus: false,
            }));
            this._addActions();
            return;
        }

        const snapshot = this._snapshot;
        const header = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        header.setOrnament(PopupMenu.Ornament.HIDDEN);
        const headerBox = new St.BoxLayout({ vertical: true, x_expand: true });
        headerBox.add_child(new St.Label({
            text: snapshot.plan ? `Grok · ${snapshot.plan}` : "Grok",
            style_class: "grok-title",
        }));
        if (this._email) {
            headerBox.add_child(new St.Label({
                text: this._email,
                style_class: "grok-muted",
            }));
        }
        header.add_child(headerBox);
        this.menu.addMenuItem(header);

        this._addBar(snapshot.periodLabel, snapshot.totalPercent, level, "");
        const buckets = snapshot.buckets || [];
        for (let i = 0; i < buckets.length; i++) {
            const bucket = buckets[i];
            this._addBar(
                bucket.label,
                bucket.percent,
                bucket.id,
                Format.bucketDetail(snapshot.details, bucket.id));
        }

        const notes = [];
        const remaining = Format.formatRemaining(snapshot.periodEnd, new Date());
        const when = Format.formatWhen(snapshot.periodEnd);
        if (when && remaining)
            notes.push(`Renouvellement : ${when} (${remaining})`);
        if (snapshot.prepaidCents)
            notes.push(`Crédit prépayé : ${Format.formatCents(snapshot.prepaidCents)}`);
        if (snapshot.onDemandCapCents) {
            notes.push(
                `À la demande : ${Format.formatCents(snapshot.onDemandUsedCents || 0)} / ${Format.formatCents(snapshot.onDemandCapCents)}`);
        }
        if (this._fetchedAt)
            notes.push(`Actualisé : ${Format.formatWhen(this._fetchedAt)}`);
        if (this._error)
            notes.push(this._error);
        if (notes.length > 0) {
            const noteItem = new PopupMenu.PopupMenuItem(notes.join("\n"), {
                reactive: false,
                can_focus: false,
            });
            this.menu.addMenuItem(noteItem);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addActions();
    }

    _addBar(label, percent, styleName, detail) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        item.setOrnament(PopupMenu.Ornament.HIDDEN);
        const box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: "grok-row" });
        const top = new St.BoxLayout({ x_expand: true });
        top.add_child(new St.Label({
            text: label,
            x_expand: true,
            style_class: "grok-row-label",
        }));
        top.add_child(new St.Label({
            text: Format.formatPercent(percent),
            style_class: "grok-row-value",
        }));
        const track = new St.BoxLayout({ style_class: "grok-track", x_expand: true });
        const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
        track.add_child(new St.Widget({
            style_class: `grok-fill ${styleName}`,
            y_expand: true,
            style: `min-width: ${Math.round(BAR_WIDTH * clamped / 100)}px;`,
        }));
        box.add_child(top);
        box.add_child(track);
        if (detail) {
            box.add_child(new St.Label({
                text: detail,
                style_class: "grok-detail",
            }));
        }
        item.add_child(box);
        this.menu.addMenuItem(item);
    }

    _addActions() {
        this.menu.addAction("Actualiser", () => this._refresh());
        this.menu.addAction("Ouvrir l'usage", () => {
            try {
                Gio.AppInfo.launch_default_for_uri(USAGE_URI, null);
            } catch (error) {
                log(`grok-quota: ouverture impossible : ${error.message}`);
            }
        });
        this.menu.addAction("Préférences", () => ExtensionUtils.openPrefs());
    }
});

function readJson(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error(`Lecture impossible : ${path}`);
    return JSON.parse(ByteArray.toString(bytes));
}

var indicator = null;

function init() {
}

function enable() {
    indicator = new Indicator(ExtensionUtils.getSettings());
    Main.panel.addToStatusArea("grok-quota", indicator);
}

function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
}
