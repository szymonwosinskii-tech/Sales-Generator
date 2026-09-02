const Anthropic = require("@anthropic-ai/sdk");
const odoo = require("./odoo");
const systemPrompt = require("./system-prompt");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const tools = [
  {
    name: "odoo_search_read",
    description:
      "Search and read records from an Odoo model. Use for res.partner, sale.order.line, product.product, etc.",
    input_schema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Odoo model, e.g. res.partner" },
        domain: {
          type: "array",
          description: "Odoo domain as a JSON array, e.g. [[\"name\",\"ilike\",\"acme\"]]",
        },
        fields: { type: "array", items: { type: "string" } },
        limit: { type: "integer" },
        order: { type: "string", description: "e.g. 'id desc'" },
      },
      required: ["model", "domain", "fields"],
    },
  },
  {
    name: "odoo_create",
    description: "Create a record in an Odoo model. Returns the new record id.",
    input_schema: {
      type: "object",
      properties: {
        model: { type: "string" },
        values: { type: "object", description: "Field values, e.g. sale.order fields incl. order_line commands" },
      },
      required: ["model", "values"],
    },
  },
  {
    name: "odoo_write",
    description: "Update an existing Odoo record.",
    input_schema: {
      type: "object",
      properties: {
        model: { type: "string" },
        id: { type: "integer" },
        values: { type: "object" },
      },
      required: ["model", "id", "values"],
    },
  },
];

async function runTool(name, input) {
  if (name === "odoo_search_read") {
    return odoo.execute(input.model, "search_read", [input.domain], {
      fields: input.fields,
      limit: input.limit || 20,
      order: input.order,
    });
  }
  if (name === "odoo_create") {
    const newId = await odoo.execute(input.model, "create", [input.values]);
    return { id: newId };
  }
  if (name === "odoo_write") {
    const ok = await odoo.execute(input.model, "write", [[input.id], input.values]);
    return { ok };
  }
  throw new Error(`Unknown tool: ${name}`);
}

// Runs the tool-calling loop starting from a given messages array, returns the outcome plus
// the full updated messages array so the caller can continue the conversation later (e.g. when
// the human replies to a clarifying question) without starting over.
async function runLoop(messages) {
  let finalText = "";

  for (let turn = 0; turn < 15; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const textBlocks = response.content.filter((b) => b.type === "text");
    finalText = textBlocks.map((b) => b.text).join("\n");

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      break; // Claude is done, or waiting on a human reply
    }

    const toolResults = [];
    for (const tu of toolUses) {
      try {
        const result = await runTool(tu.name, tu.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      } catch (err) {
        console.error(`Tool ${tu.name} failed:`, err.message);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `ERROR: ${err.message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  const orderIdMatch = finalText.match(/ORDER_ID:\s*(\S+)/i);
  const summaryMatch = finalText.match(/SUMMARY:\s*([\s\S]*)/i);
  const orderId =
    orderIdMatch && orderIdMatch[1] !== "none" ? parseInt(orderIdMatch[1], 10) : null;

  return {
    orderId: Number.isInteger(orderId) ? orderId : null,
    summary: summaryMatch ? summaryMatch[1].trim() : finalText,
    raw: finalText,
    messages, // hand back so the frontend can send it along with a reply to continue
  };
}

// Start a brand new conversation.
async function buildDraftOrder(userContent) {
  const messages = [{ role: "user", content: userContent }];
  return runLoop(messages);
}

// Continue an existing conversation with the human's reply (e.g. answering clarifying questions).
async function continueConversation(messages, replyText) {
  messages.push({ role: "user", content: [{ type: "text", text: replyText }] });
  return runLoop(messages);
}

module.exports = { buildDraftOrder, continueConversation };
