"use strict";

// Session locale écrite par `grok login`. Le fichier n'est jamais modifié ici.

var selectCredential = function selectCredential(auth, now) {
    if (!auth || typeof auth !== "object" || Array.isArray(auth))
        return null;

    const moment = now instanceof Date ? now : new Date(now);
    const entries = [];
    const ids = Object.keys(auth);
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const value = auth[id];
        if (!value || typeof value !== "object")
            continue;
        if (typeof value.key !== "string" || value.key.length === 0)
            continue;
        entries.push({
            id,
            token: value.key,
            email: typeof value.email === "string" ? value.email : "",
            principalType: typeof value.principal_type === "string" ? value.principal_type : "",
            expiresAt: parseDate(value.expires_at),
            preferred: id.indexOf("auth.x.ai") !== -1,
        });
    }
    if (entries.length === 0)
        return null;

    entries.sort((a, b) => {
        if (a.preferred !== b.preferred)
            return a.preferred ? -1 : 1;
        const at = a.expiresAt ? a.expiresAt.getTime() : 0;
        const bt = b.expiresAt ? b.expiresAt.getTime() : 0;
        return bt - at;
    });

    const chosen = entries[0];
    const expired = chosen.expiresAt
        ? chosen.expiresAt.getTime() <= moment.getTime()
        : false;
    return {
        token: chosen.token,
        email: chosen.email,
        principalType: chosen.principalType,
        expiresAt: chosen.expiresAt ? chosen.expiresAt.toISOString() : null,
        expired,
    };
};

var readClientVersion = function readClientVersion(versionJson, fallback) {
    if (versionJson && typeof versionJson.version === "string") {
        const version = versionJson.version.trim();
        if (version)
            return version;
    }
    return fallback;
};

function parseDate(value) {
    if (typeof value !== "string" || !value)
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        selectCredential,
        readClientVersion,
    };
}
