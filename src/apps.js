// The QNH apps shown in the cockpit. Add a new app here.
// `stats` maps keys of the app's admin_stats() result to overview tiles.

export const APPS = [
  {
    id: "downwind",
    name: "Downwind",
    tagline: "Fly, Log, Share",
    color: "#1673BD",
    url: import.meta.env.VITE_DOWNWIND_SUPABASE_URL,
    anonKey: import.meta.env.VITE_DOWNWIND_SUPABASE_ANON_KEY,
    tabs: ["trend", "feedback", "errors", "beta", "verify", "reports"],
    // progress bar on "Heute" and the app page
    goal: { key: "pilots", target: 50, label: "Beta-Ziel", unit: "Piloten" },
    // tab "Store & Builds": App Store Connect (bundle ID) and Codemagic (part of the Codemagic app name)
    store: { bundleId: "ch.umbricht.downwind", codemagic: "downwind" },
    // tab "Verlauf": columns of admin_timeseries(); "line" = running total, "bar" = count per day/week
    trend: [
      { key: "pilots_total", kind: "line", label: "Piloten total" },
      { key: "pilots_new", kind: "bar", label: "Neue Piloten" },
      { key: "flights", kind: "bar", label: "Erfasste Flüge" },
      { key: "beta", kind: "bar", label: "Beta-Anmeldungen" },
      { key: "feedback", kind: "bar", label: "Feedback" },
      { key: "errors", kind: "bar", label: "Fehlermeldungen" },
    ],
    // tiles with `list` count rows of a loaded list instead of an admin_stats() key
    stats: [
      { key: "pilots", spark: ["pilots_total", "line"], label: "Piloten", sub: (s) => `+${s.pilots_7d ?? 0} in 7 Tagen` },
      { key: "active_7d", spark: ["active", "bar"], label: "Aktiv (7 Tage)", sub: (s) => `${s.flights_7d ?? 0} Flüge in 7 Tagen` },
      { key: "flights", spark: ["flights", "bar"], label: "Flüge total" },
      { key: "feedback_new", spark: ["feedback", "bar"], label: "Feedback neu", tab: "feedback", alert: (s) => s.feedback_new > 0 },
      { key: "errors_24h", spark: ["errors", "bar"], label: "Fehler (24 h)", sub: (s) => `${s.errors_7d ?? 0} in 7 Tagen`, tab: "errors", alert: (s) => s.errors_24h > 0 },
      { key: "beta_new", spark: ["beta", "bar"], label: "Beta neu", sub: (s) => `${s.beta_total ?? 0} Anmeldungen total`, tab: "beta", alert: (s) => s.beta_new > 0 },
      { list: "verify", count: (rows) => rows.filter((r) => r.status === "pending").length, label: "Verifizierungen offen", one: "Verifizierung offen", tab: "verify" },
      { list: "reports", count: (rows) => rows.filter((r) => r.status === "open").length, label: "Meldungen offen", one: "Meldung offen", tab: "reports" },
    ],
  },
  {
    id: "secondseat",
    name: "SecondSeat",
    tagline: "Voice checklist",
    color: "#0B1220",
    offline: true,
    note: "Offline-App ohne Server: In Version 1 gibt es hier keine Daten.",
  },
];

// QNH's own Supabase project ("QNH Core"): cockpit login gate, social media posts.
export const QNH = {
  id: "qnh",
  name: "QNH Core",
  url: import.meta.env.VITE_QNH_SUPABASE_URL,
  anonKey: import.meta.env.VITE_QNH_SUPABASE_ANON_KEY,
};

export const appById = (id) => (id === QNH.id ? QNH : APPS.find((a) => a.id === id));
