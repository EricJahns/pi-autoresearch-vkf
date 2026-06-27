import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assembleCard,
  parseFrontmatter,
  stringifyFrontmatter,
} from "../extensions/pi-autoresearch-vkf/frontmatter.ts";

test("parses scalars, lists, and nested maps", () => {
  const text = `---
id: claim:foo
type: claim
status: draft
belief: 0.5
owners:
  - agent:autoresearch
tags: []
access:
  allowed_uses:
    - internal_question_answering
  forbidden_uses:
    - public_release
---

# Body here
`;
  const { data, body } = parseFrontmatter(text);
  assert.equal(data.id, "claim:foo");
  assert.equal(data.status, "draft");
  assert.equal(data.belief, 0.5);
  assert.deepEqual(data.owners, ["agent:autoresearch"]);
  assert.deepEqual(data.tags, []);
  assert.deepEqual(data.access, {
    allowed_uses: ["internal_question_answering"],
    forbidden_uses: ["public_release"],
  });
  assert.match(body, /# Body here/);
});

test("round-trips through assemble + parse", () => {
  const data = {
    id: "paper:x",
    type: "paper",
    title: "A: B with colons",
    owners: ["agent:autoresearch"],
    year: 2026,
    nested: { a: ["one", "two"], b: 3 },
  };
  const card = assembleCard(data, "# hello\n\nworld");
  const parsed = parseFrontmatter(card);
  assert.equal(parsed.data.title, "A: B with colons");
  assert.equal(parsed.data.year, 2026);
  assert.deepEqual(parsed.data.nested, { a: ["one", "two"], b: 3 });
});

test("parses flow lists", () => {
  const { data } = parseFrontmatter(`---
type: claim
tags: [a, b, c]
---
body`);
  assert.deepEqual(data.tags, ["a", "b", "c"]);
});

test("preserves URLs with colons in values", () => {
  const out = stringifyFrontmatter({ source_url: "https://arxiv.org/abs/1234.5678" });
  const { data } = parseFrontmatter(`---\n${out}\n---\nx`);
  assert.equal(data.source_url, "https://arxiv.org/abs/1234.5678");
});

test("throws without frontmatter", () => {
  assert.throws(() => parseFrontmatter("no frontmatter here"));
});
