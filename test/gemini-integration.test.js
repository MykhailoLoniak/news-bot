const assert = require("node:assert/strict");
const { createArticleGenerator } = require("../src/gemini");

const immediateQueue = { add: (task) => task() };

test("uses one structured Gemini request for translation and summary", async () => {
  const calls = [];
  const client = {
    models: {
      generateContent: async (request) => {
        calls.push(request);
        return { text: JSON.stringify({ title: "Український заголовок", summary: "Переказ" }) };
      },
    },
  };
  const generate = createArticleGenerator({ client, queue: immediateQueue });
  assert.deepEqual(await generate("English title", "Article body"), {
    title: "Український заголовок",
    summary: "Переказ",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gemini-test-flash");
  assert.equal(calls[0].config.responseMimeType, "application/json");
  assert.doesNotMatch(JSON.stringify(calls[0]), /chat[_ -]?id/i);
});

test("falls back when mocked Gemini invents an extra field", async () => {
  const client = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({ title: "Вигадка", summary: "Вигадка", location: "невідомо" }),
      }),
    },
  };
  const generate = createArticleGenerator({ client, queue: immediateQueue });
  assert.deepEqual(await generate("Original", "Original facts"), {
    title: "Original",
    summary: "Original facts",
  });
});
