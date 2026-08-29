var response = http.post(
  FIXTURE_ORIGIN +
    "/runs/" +
    FIXTURE_RUN_ID +
    "/" +
    RACE_CASE +
    "/release/" +
    RACE_SOURCE +
    "/" +
    RACE_OUTCOME,
  { body: "" },
);
if (!response.ok) {
  throw new Error("Image request release failed with " + response.status);
}
