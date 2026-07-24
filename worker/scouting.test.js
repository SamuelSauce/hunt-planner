import assert from "node:assert/strict";
import test from "node:test";
import worker, { validateScoutWorkspace } from "./index.js";

function workspace(overrides = {}) {
  const now = 1_785_000_000_000;
  return {
    version: 1,
    state: "utah",
    huntNumber: "db1001",
    name: "Paunsaugunt archery",
    layers: [
      {
        id: "layer_scratch",
        name: "Scratch",
        visible: true,
        sortOrder: 0,
        color: "#f2c94c",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pins: [
      {
        id: "pin_water_1",
        layerId: "layer_scratch",
        location: { latitude: 37.52, longitude: -112.31 },
        title: "Upper spring",
        type: "water",
        status: "field",
        species: "Deer",
        observationYear: 2026,
        notes: "Flowing in July",
        waterSeasonality: "seasonal",
        colorOverride: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    updatedAt: now,
    ...overrides,
  };
}

test("validates and normalizes a private scout workspace document", () => {
  const result = validateScoutWorkspace(workspace());

  assert.equal(result.state, "utah");
  assert.equal(result.huntNumber, "DB1001");
  assert.equal(result.layers[0].color, "#f2c94c");
  assert.equal(result.pins[0].location.longitude, -112.31);
});

test("rejects pins outside coordinate bounds", () => {
  const invalid = workspace();
  invalid.pins[0].location.latitude = 91;

  assert.throws(
    () => validateScoutWorkspace(invalid),
    /Pin coordinates are invalid/,
  );
});

test("rejects pins that reference a missing layer", () => {
  const invalid = workspace();
  invalid.pins[0].layerId = "layer_missing";

  assert.throws(
    () => validateScoutWorkspace(invalid),
    /Every pin must belong/,
  );
});

test("enforces the signed-in workspace pin ceiling", () => {
  const source = workspace();
  source.pins = Array.from({ length: 1001 }, (_, index) => ({
    ...source.pins[0],
    id: `pin_${index}`,
  }));

  assert.throws(
    () => validateScoutWorkspace(source),
    /up to 1,000 pins/,
  );
});

test("requires authentication before reading a scout workspace", async () => {
  const response = await worker.fetch(
    new Request(
      "https://hunt-planner-seo-preview.samuelfbridge.chatgpt.site/api/maps/workspace?state=utah&hunt=DB1001",
    ),
    {
      DB: { prepare() {} },
      ASSETS: { fetch() { return new Response(null, { status: 404 }); } },
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Sign in to continue." });
});
