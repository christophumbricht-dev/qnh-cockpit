// Topics (Social → Themen): which posts belong together, e.g. the 3 weather reels, the accident story and the
// instrument reel of «Föhn». Stored in social_posts.topic (migration 20261023120000_social_topic.sql); until a
// post has one, it is guessed from the series line in the caption or the YouTube title («Föhn, part 2/3»).

export const NO_TOPIC = "Ohne Thema";

const SMALL = new Set(["of", "and", "the", "in", "on", "at", "und", "der", "die", "das", "im", "am"]);
const titleCase = (s) => s.split(" ").map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

// «Same air. 8 °C warmer. 🔥 Föhn, part 2/3.» → «Föhn»; «… | Mountain waves & rotor, part 2» → «Mountain Waves»
export function guessTopic(p) {
  for (const text of [p.title, p.caption]) {
    const m = String(text ?? "").match(/(?:^|[|.!?:\n]|[\p{Extended_Pictographic}️‍]+)\s*([\p{L}][\p{L}\d' .-]{1,40}?)\s*(?:&[^,]{0,30})?,?\s+(?:part|teil)\s+\d+(?:\s*\/\s*\d+)?/iu);
    if (!m) continue;
    const name = m[1].replace(/\s+explained$/i, "").replace(/\s+erklärt$/i, "").trim();
    if (name.length >= 2) return titleCase(name);
  }
  return null;
}

export const topicOf = (p) => (p.topic && String(p.topic).trim()) || guessTopic(p) || NO_TOPIC;
