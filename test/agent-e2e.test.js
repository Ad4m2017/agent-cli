const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function makeResponse(statusCode, payload) {
  return {
    statusCode,
    payload,
  };
}

function startMockProvider(toolName, toolArgs, finalText) {
  let callCount = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      callCount += 1;
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = JSON.parse(body);

      if (callCount === 1) {
        const response = makeResponse(200, {
          id: "chatcmpl-mock-1",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_mock_1",
                    type: "function",
                    function: {
                      name: toolName,
                      arguments: JSON.stringify(toolArgs || {}),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
        });
        res.statusCode = response.statusCode;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(response.payload));
        return;
      }

      const response = makeResponse(200, {
        id: "chatcmpl-mock-2",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: parsed.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: finalText,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 15,
          total_tokens: 95,
        },
      });
      res.statusCode = response.statusCode;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(response.payload));
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on("error", reject);
  });
}

function writeConfigs(tmpDir, port) {
  const agentConfigPath = path.join(tmpDir, "agent.json");
  const authConfigPath = path.join(tmpDir, "agent.auth.json");

  fs.writeFileSync(
    agentConfigPath,
    JSON.stringify(
      {
        version: 1,
        runtime: {
          defaultProvider: "mock",
          defaultModel: "mock/test-model",
          profile: "dev",
          defaultApprovalMode: "auto",
          defaultToolsMode: "on",
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    authConfigPath,
    JSON.stringify(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            kind: "openai_compatible",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            apiKey: "",
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return { agentConfigPath, authConfigPath };
}

async function runAgentOnce(tmpDir, message) {
  const { stdout } = await execFileAsync(
    "node",
    [
      path.join(__dirname, "..", "agent.js"),
      "-m",
      message,
      "--json",
      "--profile",
      "dev",
      "--approval",
      "auto",
      "--tools",
      "on",
      "--config",
      path.join(tmpDir, "agent.json"),
      "--auth-config",
      path.join(tmpDir, "agent.auth.json"),
    ],
    { encoding: "utf8", cwd: tmpDir, timeout: 30000 }
  );
  return JSON.parse(stdout);
}

describe("agent.js e2e tool smoke", () => {
  it("runs read_file flow with normalized tool call output", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-e2e-read-"));
    fs.writeFileSync(path.join(tmpDir, "sample.txt"), "hello\nworld\n", "utf8");

    const server = await startMockProvider("read_file", { path: "sample.txt", offset: 1, limit: 1 }, "done");
    try {
      writeConfigs(tmpDir, server.port);
      const json = await runAgentOnce(tmpDir, "Read sample.txt first line");
      assert.equal(json.ok, true);
      assert.equal(json.profile, "dev");
      assert.equal(Array.isArray(json.toolCalls), true);
      assert.equal(json.toolCalls.length, 1);
      assert.equal(json.toolCalls[0].tool, "read_file");
      assert.equal(json.toolCalls[0].ok, true);
      assert.equal(typeof json.toolCalls[0].meta.duration_ms, "number");
      assert.equal(json.usage.has_usage, true);
    } finally {
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs search_content flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-e2e-search-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "a.txt"), "alpha\nbeta\n", "utf8");
    fs.writeFileSync(path.join(tmpDir, "src", "b.txt"), "beta\ngamma\n", "utf8");

    const server = await startMockProvider("search_content", { path: "src", pattern: "beta", include: "*.txt" }, "done");
    try {
      writeConfigs(tmpDir, server.port);
      const json = await runAgentOnce(tmpDir, "Search content");
      assert.equal(json.ok, true);
      assert.equal(json.toolCalls.length, 1);
      assert.equal(json.toolCalls[0].tool, "search_content");
      assert.equal(json.toolCalls[0].ok, true);
      assert.equal(Array.isArray(json.toolCalls[0].result.matches), true);
      assert.equal(json.toolCalls[0].result.matches.length >= 2, true);
    } finally {
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs apply_patch flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-e2e-patch-"));
    fs.writeFileSync(path.join(tmpDir, "x.txt"), "before\n", "utf8");

    const server = await startMockProvider(
      "apply_patch",
      { operations: [{ op: "update", path: "x.txt", content: "after\n" }] },
      "done"
    );
    try {
      writeConfigs(tmpDir, server.port);
      const json = await runAgentOnce(tmpDir, "Patch x.txt");
      assert.equal(json.ok, true);
      assert.equal(json.toolCalls[0].tool, "apply_patch");
      assert.equal(json.toolCalls[0].ok, true);
      const content = fs.readFileSync(path.join(tmpDir, "x.txt"), "utf8");
      assert.equal(content, "after\n");
    } finally {
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs run_command flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-e2e-cmd-"));

    const server = await startMockProvider("run_command", { cmd: 'node -p "process.cwd()"' }, "done");
    try {
      writeConfigs(tmpDir, server.port);
      const json = await runAgentOnce(tmpDir, "Run cwd check");
      assert.equal(json.ok, true);
      assert.equal(json.toolCalls[0].tool, "run_command");
      assert.equal(json.toolCalls[0].ok, true);
      assert.equal(json.toolCalls[0].result.executionMode, "shell");
      assert.equal(typeof json.toolCalls[0].result.stdout, "string");
      assert.equal(json.toolCalls[0].result.code, 0);
      assert.equal(json.toolCalls[0].result.stdout.trim().length > 0, true);
    } finally {
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
