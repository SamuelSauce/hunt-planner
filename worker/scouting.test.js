import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  buildScoutShareDocument,
  scoutLibraryFromWorkspaces,
  scoutWorkspacesFromLibrary,
  validateScoutLibrary,
  validateScoutWorkspace,
} from "./index.js";

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

test("preserves an optional exact hunt ID in workspaces and shared snapshots", () => {
  const source = workspace({
    state: "idaho",
    huntNumber: "2145",
    huntId: "id-81881",
  });
  const result = validateScoutWorkspace(source);
  const shared = buildScoutShareDocument(
    source,
    {
      title: "December Area 70-1",
      layerIds: ["layer_scratch"],
      includeNotes: false,
    },
    1_785_000_100_000,
  );

  assert.equal(result.huntId, "id-81881");
  assert.equal(result.layers[0].hunt.huntId, "id-81881");
  assert.equal(shared.workspace.huntId, "id-81881");
});

test("rejects invalid exact hunt IDs", () => {
  assert.throws(
    () => validateScoutWorkspace(workspace({ huntId: "bad id!" })),
    /hunt ID is invalid/i,
  );
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

test("builds a selected-layer snapshot without private notes by default", () => {
  const source = workspace();
  source.layers.push({
    ...source.layers[0],
    id: "layer_glassing",
    name: "Glassing",
    sortOrder: 1,
  });
  source.pins.push({
    ...source.pins[0],
    id: "pin_glassing_1",
    layerId: "layer_glassing",
    title: "North knob",
    notes: "Private access detail",
  });

  const result = buildScoutShareDocument(
    source,
    {
      title: "Opening weekend",
      layerIds: ["layer_glassing"],
      includeNotes: false,
    },
    1_785_000_100_000,
  );

  assert.equal(result.title, "Opening weekend");
  assert.deepEqual(result.workspace.layers.map((layer) => layer.id), [
    "layer_glassing",
  ]);
  assert.deepEqual(result.workspace.pins.map((pin) => pin.id), [
    "pin_glassing_1",
  ]);
  assert.equal(result.workspace.pins[0].notes, "");
});

test("includes notes only when the publisher opts in", () => {
  const result = buildScoutShareDocument(
    workspace(),
    {
      title: "Water checks",
      layerIds: ["layer_scratch"],
      includeNotes: true,
    },
    1_785_000_100_000,
  );

  assert.equal(result.workspace.pins[0].notes, "Flowing in July");
});

test("rejects empty or foreign layer selections for shared maps", () => {
  assert.throws(
    () => buildScoutShareDocument(
      workspace(),
      { title: "Bad share", layerIds: ["layer_missing"] },
    ),
    /does not belong/,
  );

  const emptyLayerWorkspace = workspace({
    pins: [],
  });
  assert.throws(
    () => buildScoutShareDocument(
      emptyLayerWorkspace,
      { title: "Empty share", layerIds: ["layer_scratch"] },
    ),
    /contains a pin/,
  );
});

test("allows anonymous read-only access to an unlisted scout map", async () => {
  const document = buildScoutShareDocument(
    workspace(),
    {
      title: "Water checks",
      layerIds: ["layer_scratch"],
      includeNotes: false,
    },
    1_785_000_100_000,
  );
  const db = {
    prepare(sql) {
      return {
        async all() {
          return sql.includes("table_info")
            ? { results: [{ name: "hunt_id" }] }
            : { results: [] };
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        bind() {
          return {
            async first() {
              if (sql.includes("FROM scout_shares")) {
                return {
                  title: document.title,
                  document_json: JSON.stringify(document),
                  created_at: document.createdAt,
                };
              }
              return null;
            },
            async run() {
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };

  const response = await worker.fetch(
    new Request(
      "https://hunt-planner-seo-preview.samuelfbridge.chatgpt.site/api/maps/shares/map_public123",
    ),
    {
      DB: db,
      ASSETS: { fetch() { return new Response(null, { status: 404 }); } },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  const payload = await response.json();
  assert.equal(payload.share.title, "Water checks");
  assert.equal(payload.share.workspace.pins[0].notes, "");
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

test("combines hunt workspaces into a global library and partitions them for storage", () => {
  const second = workspace({
    huntNumber: "EA1189",
    name: "Wasatch Mtns, West-Central",
    layers: [{
      ...workspace().layers[0],
      id: "layer_wasatch",
      name: "Scratch",
    }],
    pins: [{
      ...workspace().pins[0],
      id: "pin_wasatch_1",
      layerId: "layer_wasatch",
      species: "Elk",
    }],
  });

  const library = scoutLibraryFromWorkspaces([workspace(), second], 1_785_000_200_000);

  assert.equal(library.version, 2);
  assert.equal(library.layers.length, 2);
  assert.equal(library.pins.length, 2);
  assert.match(library.layers[0].name, /^DB1001 ·/);
  assert.match(library.layers[1].name, /^EA1189 ·/);

  const partitioned = scoutWorkspacesFromLibrary(library);
  assert.deepEqual(
    partitioned.map((candidate) => candidate.huntNumber).sort(),
    ["DB1001", "EA1189"],
  );
});

test("validates global layer hunt metadata and per-hunt limits", () => {
  const library = scoutLibraryFromWorkspaces([workspace()]);
  assert.equal(validateScoutLibrary(library).layers[0].hunt.huntNumber, "DB1001");

  const invalid = structuredClone(library);
  invalid.layers[0].hunt.huntNumber = "";
  assert.throws(
    () => validateScoutLibrary(invalid),
    /hunt number is invalid/i,
  );
});
