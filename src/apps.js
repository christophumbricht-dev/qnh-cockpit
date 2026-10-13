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
      { key: "pilots", label: "Piloten", sub: (s) => `+${s.pilots_7d ?? 0} in 7 Tagen` },
      { key: "active_7d", label: "Aktiv (7 Tage)", sub: (s) => `${s.flights_7d ?? 0} Flüge in 7 Tagen` },
      { key: "flights", label: "Flüge total" },
      { key: "feedback_new", label: "Feedback neu", tab: "feedback", alert: (s) => s.feedback_new > 0 },
      { key: "errors_24h", label: "Fehler (24 h)", sub: (s) => `${s.errors_7d ?? 0} in 7 Tagen`, tab: "errors", alert: (s) => s.errors_24h > 0 },
      { key: "beta_new", label: "Beta neu", sub: (s) => `${s.beta_total ?? 0} Anmeldungen total`, tab: "beta", alert: (s) => s.beta_new > 0 },
      { list: "verify", count: (rows) => rows.filter((r) => r.status === "pending").length, label: "Verifizierungen offen", tab: "verify" },
      { list: "reports", count: (rows) => rows.filter((r) => r.status === "open").length, label: "Meldungen offen", tab: "reports" },
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

export const appById = (id) => APPS.find((a) => a.id === id);
