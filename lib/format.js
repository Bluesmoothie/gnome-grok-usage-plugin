"use strict";

var formatPercent = function formatPercent(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return "—";
    const rounded = Math.round(value * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.05)
        return `${Math.round(rounded)} %`;
    return `${rounded.toFixed(1).replace(".", ",")} %`;
};

var panelText = function panelText(snapshot) {
    if (!snapshot || !snapshot.ok || !Number.isFinite(snapshot.totalPercent))
        return "—";
    return `${Math.round(snapshot.totalPercent)}%`;
};

var severity = function severity(percent, warn, critical) {
    const value = Number.isFinite(percent) ? percent : 0;
    const warnAt = Number.isFinite(warn) ? warn : 70;
    const criticalAt = Number.isFinite(critical) ? Math.max(critical, warnAt) : Math.max(90, warnAt);
    if (value >= criticalAt)
        return "critical";
    if (value >= warnAt)
        return "warn";
    return "ok";
};

var formatRemaining = function formatRemaining(endIso, now) {
    if (typeof endIso !== "string" || !endIso)
        return null;
    const end = new Date(endIso);
    const moment = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(end.getTime()))
        return null;
    const ms = end.getTime() - moment.getTime();
    if (ms <= 0)
        return "renouvelé";
    const minutes = Math.round(ms / 60000);
    if (minutes < 60)
        return `dans ${Math.max(minutes, 1)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 48)
        return mins ? `dans ${hours} h ${mins} min` : `dans ${hours} h`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours ? `dans ${days} j ${remHours} h` : `dans ${days} j`;
};

var formatWhen = function formatWhen(iso) {
    const date = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "";
    return new Intl.DateTimeFormat("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
};

var formatCents = function formatCents(cents) {
    if (typeof cents !== "number" || !Number.isFinite(cents))
        return "";
    return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "USD",
    }).format(Math.abs(cents) / 100);
};

var bucketDetail = function bucketDetail(details, bucketId) {
    const rows = (details || []).filter(row => row.bucket === bucketId && row.percent > 0);
    if (rows.length === 0)
        return "";
    if (bucketId !== "other" && rows.length < 2)
        return "";
    return rows.map(row => `${row.label} ${formatPercent(row.percent)}`).join(" · ");
};

var renderText = function renderText(snapshot, meta) {
    const info = meta || {};
    if (!snapshot || !snapshot.ok) {
        return info.error || "Quota indisponible.";
    }
    const lines = [];
    const title = snapshot.plan ? `Grok · ${snapshot.plan}` : "Grok";
    lines.push(title);
    if (info.email)
        lines.push(info.email);
    lines.push(`${snapshot.periodLabel} : ${formatPercent(snapshot.totalPercent)}`);
    const buckets = snapshot.buckets || [];
    for (let i = 0; i < buckets.length; i++) {
        const bucket = buckets[i];
        lines.push(`  ${bucket.label} : ${formatPercent(bucket.percent)}`);
        const detail = bucketDetail(snapshot.details, bucket.id);
        if (detail)
            lines.push(`    ${detail}`);
    }
    const remaining = formatRemaining(snapshot.periodEnd, info.now || new Date());
    const when = formatWhen(snapshot.periodEnd);
    if (when && remaining)
        lines.push(`Renouvellement : ${when} (${remaining})`);
    else if (remaining)
        lines.push(`Renouvellement : ${remaining}`);
    if (snapshot.prepaidCents)
        lines.push(`Crédit prépayé : ${formatCents(snapshot.prepaidCents)}`);
    if (snapshot.onDemandCapCents)
        lines.push(`À la demande : ${formatCents(snapshot.onDemandUsedCents || 0)} / ${formatCents(snapshot.onDemandCapCents)}`);
    if (info.fetchedAt)
        lines.push(`Actualisé : ${formatWhen(info.fetchedAt)}`);
    if (info.error)
        lines.push(info.error);
    return lines.join("\n");
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        formatPercent,
        panelText,
        severity,
        formatRemaining,
        formatWhen,
        formatCents,
        bucketDetail,
        renderText,
    };
}
