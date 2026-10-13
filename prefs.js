// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const { Adw, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

function init() {
}

function buildPrefsWidget() {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();

    const refresh = new Adw.PreferencesGroup({
        title: "Actualisation",
        description: "Le quota est lu avec la session déjà créée par grok login.",
    });
    page.add(refresh);
    refresh.add(spinRow(settings, "refresh-interval", "Intervalle", "Secondes entre deux lectures", 60, 3600, 30));
    refresh.add(spinRow(settings, "warn-threshold", "Seuil d'attention", "Le pourcentage du panneau passe à l'orange", 1, 100, 5));
    refresh.add(spinRow(settings, "critical-threshold", "Seuil critique", "Le pourcentage du panneau passe au rouge", 1, 100, 5));

    const session = new Adw.PreferencesGroup({
        title: "Session",
        description: "Laissez vide pour utiliser ~/.grok, ou GROK_HOME s'il est défini pour GNOME.",
    });
    page.add(session);
    session.add(entryRow(settings, "grok-home", "Dossier Grok", "Chemin absolu, par exemple /home/moi/.grok"));
    session.add(entryRow(settings, "proxy-base-url", "URL du proxy", "Vide : https://cli-chat-proxy.grok.com/v1"));

    return page;
}

function spinRow(settings, key, title, subtitle, lower, upper, step) {
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 2,
            value: settings.get_int(key),
        }),
        valign: Gtk.Align.CENTER,
        numeric: true,
        climb_rate: step,
    });
    spin.connect("value-changed", widget => {
        const next = widget.get_value_as_int();
        if (settings.get_int(key) !== next)
            settings.set_int(key, next);
    });
    const row = new Adw.ActionRow({ title, subtitle });
    row.add_suffix(spin);
    return row;
}

function entryRow(settings, key, title, subtitle) {
    const entry = new Gtk.Entry({
        text: settings.get_string(key),
        placeholder_text: subtitle,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        width_chars: 28,
    });
    entry.connect("changed", widget => {
        const next = widget.get_text();
        if (settings.get_string(key) !== next)
            settings.set_string(key, next);
    });
    const row = new Adw.ActionRow({ title, subtitle });
    row.add_suffix(entry);
    return row;
}
