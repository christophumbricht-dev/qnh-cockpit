import { assertEquals } from "jsr:@std/assert@1";
import { missingVideos } from "./playlists.ts";

Deno.test("missingVideos: only what is not there yet, in order, once", () => {
  assertEquals(missingVideos(["a", "b", "c", "b", ""], ["c"]), ["a", "b"]);
  assertEquals(missingVideos([], ["x"]), []);
});
