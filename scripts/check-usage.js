#!/usr/bin/env node
"use strict";

// Affiche le même quota que l'extension, sans ouvrir GNOME.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { selectCredential, readClientVersion } = require("../lib/auth");
const {
    DEFAULT_BASE_URL,
    DEFAULT_CLIENT_VERSION,
    normalizeCredits,
    applySettings,
    billingUrl,
    settingsUrl,
    requestHeaders,
} = require("../lib/billing");
const { renderText } = require("../lib/format");

function fail(message, asJson) {
    if (asJson)
        console.log(JSON.stringify({ ok: false, error: message }));
    else
        console.error(message);
    process.exitCode = 1;
}

async function main() {
    const asJson = process.argv.includes("--json");
    const home = process.env.GROK_HOME || path.join(os.homedir(), ".grok");
    const authPath = path.join(home, "auth.json");
    let auth;
    try {
        auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    } catch (error) {
        fail("Session introuvable. Lancez : grok login", asJson);
        return;
    }

    const credential = selectCredential(auth, new Date());
    if (!credential) {
        fail("Session introuvable. Lancez : grok login", asJson);
        return;
    }
    if (credential.expired) {
        fail("Session expirée. Lancez : grok login", asJson);
        return;
    }

    let version = DEFAULT_CLIENT_VERSION;
    try {
        version = readClientVersion(
            JSON.parse(fs.readFileSync(path.join(home, "version.json"), "utf8")),
            DEFAULT_CLIENT_VERSION);
    } catch (error) {
        version = DEFAULT_CLIENT_VERSION;
    }

    const base = process.env.GROK_CLI_CHAT_PROXY_BASE_URL || DEFAULT_BASE_URL;
    const headers = requestHeaders(credential.token, version);
    const usageResponse = await fetch(billingUrl(base), { headers });
    if (!usageResponse.ok) {
        fail(`Quota indisponible (HTTP ${usageResponse.status}).`, asJson);
        return;
    }

    let snapshot = normalizeCredits(await usageResponse.json());
    if (!snapshot.ok) {
        fail(snapshot.error || "Réponse de facturation inattendue.", asJson);
        return;
    }

    try {
        const settingsResponse = await fetch(settingsUrl(base), { headers });
        if (settingsResponse.ok)
            snapshot = applySettings(snapshot, await settingsResponse.json());
    } catch (error) {
        // Le forfait est optionnel.
    }

    const fetchedAt = new Date();
    const view = {
        email: credential.email,
        fetchedAt,
    };
    if (asJson) {
        console.log(JSON.stringify({
            ok: true,
            plan: snapshot.plan,
            email: credential.email,
            periodLabel: snapshot.periodLabel,
            periodEnd: snapshot.periodEnd,
            totalPercent: snapshot.totalPercent,
            buckets: snapshot.buckets,
            details: snapshot.details,
            prepaidCents: snapshot.prepaidCents,
            onDemandCapCents: snapshot.onDemandCapCents,
            onDemandUsedCents: snapshot.onDemandUsedCents,
            fetchedAt: fetchedAt.toISOString(),
            text: renderText(snapshot, view),
        }));
        return;
    }
    console.log(renderText(snapshot, view));
}

main().catch(error => {
    const message = error && error.message ? error.message : "Lecture impossible.";
    if (process.argv.includes("--json"))
        console.log(JSON.stringify({ ok: false, error: message }));
    else
        console.error(message);
    process.exitCode = 1;
});
