var response = http.get(
  FIXTURE_ORIGIN +
    "/runs/" +
    encodeURIComponent(FIXTURE_RUN_ID) +
    "/" +
    RACE_CASE +
    "/wait/" +
    RACE_SOURCE,
);
if (!response.ok) {
  throw new Error("Image request wait failed with " + response.status);
}
