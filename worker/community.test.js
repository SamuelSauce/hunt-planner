import assert from "node:assert/strict";
import test from "node:test";
import { validatePostDraft } from "./index.js";

function postDraft(overrides = {}) {
  return {
    title: "Which Area 70-1 season fits this plan?",
    body: "I am comparing the November and December muzzleloader seasons.",
    category: "planning",
    postType: "question",
    state: "id",
    species: "Elk",
    huntNumber: "2145",
    huntId: "id-81881",
    ...overrides,
  };
}

test("community drafts preserve a valid exact hunt ID", () => {
  const result = validatePostDraft(postDraft());

  assert.equal(result.state, "ID");
  assert.equal(result.huntNumber, "2145");
  assert.equal(result.huntId, "id-81881");
});

test("community drafts discard an exact ID without related hunt context", () => {
  const result = validatePostDraft(postDraft({ huntNumber: "" }));

  assert.equal(result.huntNumber, null);
  assert.equal(result.huntId, null);
});

test("community drafts reject malformed exact hunt IDs", () => {
  assert.throws(
    () => validatePostDraft(postDraft({ huntId: "id 81881!" })),
    /Hunt ID is invalid/,
  );
});
