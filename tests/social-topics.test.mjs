import { test } from "node:test";
import assert from "node:assert/strict";
import { guessTopic, topicOf, NO_TOPIC } from "../src/social/topics.js";

test("topic guessed from the series line in caption or YouTube title", () => {
  assert.equal(guessTopic({ caption: "Same air. 8 °C warmer. 🔥 Föhn, part 2/3." }), "Föhn");
  assert.equal(guessTopic({ caption: "Why does the air bounce behind a ridge? 🏔️ Mountain waves, part 1/3." }), "Mountain Waves");
  assert.equal(guessTopic({ caption: "Full power. 😳 Mountain waves & rotor, part 2/3." }), "Mountain Waves"); // same topic as part 1
  assert.equal(guessTopic({ caption: "Grey and 3 °C on the Plateau. ☁️ Sea of fog, part 1/3." }), "Sea of Fog");
  assert.equal(guessTopic({ title: "Why is there a sea of fog over Switzerland? | Nebelmeer explained, part 1 #Shorts" }), "Nebelmeer");
  assert.equal(guessTopic({ caption: "Abendrunde über dem Birrfeld." }), null);
});

test("a stored topic wins; nothing found → «Ohne Thema»", () => {
  assert.equal(topicOf({ topic: "Vereisung", caption: "🔥 Föhn, part 2/3." }), "Vereisung");
  assert.equal(topicOf({ topic: "  ", caption: "🔥 Föhn, part 2/3." }), "Föhn");
  assert.equal(topicOf({ caption: "Hallo" }), NO_TOPIC);
});
