// Stand-in for the OpenRouter chat completions API used by the e2e suite.
// It reads the board from the system prompt, moves card-2 to the last column,
// and replies in the same shape as OpenRouter.
import http from "node:http";

const port = Number(process.env.STUB_PORT);
const BOARD_MARKER = "Current board JSON:";

http
  .createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method !== "POST") {
        response.end("ok");
        return;
      }

      const systemPrompt = JSON.parse(body).messages[0].content;
      const board = JSON.parse(
        systemPrompt.slice(systemPrompt.indexOf(BOARD_MARKER) + BOARD_MARKER.length)
      );
      for (const column of board.columns) {
        column.cardIds = column.cardIds.filter((id) => id !== "card-2");
      }
      board.columns.at(-1).cardIds.push("card-2");

      const content = JSON.stringify({ response: "Moved card-2 to Done.", board });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  })
  .listen(port, "127.0.0.1");
