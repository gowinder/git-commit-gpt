#!/usr/bin/env node
import { Configuration, OpenAIApi } from "openai";
import { promisify } from "util";
import { exec as originalExec, execSync } from "child_process";
import prompts from "prompts";

let openai;

function splitString(inputStr) {
  const maxLen = 1024 * 3;
  const parts = [];
  for (let i = 0; i < inputStr.length; i += maxLen) {
    parts.push(inputStr.substring(i, i + maxLen));
  }
  return parts;
}

function cutString(str, len = 50) {
  if (str.length > len) {
    return str.substring(0, len) + "...";
  } else {
    return str;
  }
}

export async function getGitSummary() {
  try {
    const dotenv = await import("dotenv");
    dotenv.config();
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
      basePath: process.env.OPENAI_BASE_PATH,
    });
    openai = new OpenAIApi(configuration);

    const exec = promisify(originalExec);
    const excludeFiles = process.env.SKIP_FILE.split(",");
    let cmd = "git diff --cached -- .";
    for (let i = 0; i < excludeFiles.length; i++) {
      cmd += ` ':!${excludeFiles[i]}'`;
    }
    console.log("git diff cmd: ", cmd);
    const { stdout } = await exec(cmd);
    const summary = stdout.trim();
    if (summary.length === 0) {
      return null;
    }

    // transfer summary to mulptiple strings, each length is less then 2048
    const summaries = splitString(summary);

    return summaries;
  } catch (error) {
    console.error("Error while summarizing Git changes:", error);
    process.exit(1);
  }
}

async function openaiCompletion(prompt) {
  const parameters = {
    model: "gpt-3.5-turbo",
    prompt,
    temperature: 0.7,
    max_tokens: 50,
    n: 1,
    stop: null,
  };

  console.log(`--->>prompt: ${cutString(prompt)}`);
  const response = await openai.createCompletion(parameters);

  const message = response.data.choices[0].text.trim();
  console.log(`<<---answer: ${cutString(message)}`);
  return message;
}

async function openaiGpt35turboCompletion(messages) {
  const response = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: messages,
    temperature: 0.7,
  });

  return response.data.choices[0].message.content;
}

const gptCommit = async (args) => {
  const gitSummary = await getGitSummary();
  if (!gitSummary) {
    console.log("No changes to commit. Commit canceled.");
    process.exit(0);
  }

  console.log("summaries count: ", gitSummary.length);

  let prompt =
    "Given a Git diff result, please help me generate a Git commit message. I will send you the Git diff result in sections. " +
    "There's no need to respond at this point. Please note that you should skip the following file: ${process.env.SKIP_FILE}" +
    '; After I say "ALL SECIONS SENDED", please merge each part of the Git diff and send the Git commit message to me.';
  // GPT-3.5-Turbo model prompt example
  const gpt35turboMessages = [
    { role: "system", content: `You are a JavaScript developer.` },
    {
      role: "user",
      content: prompt,
    },
    {
      role: "assistant",
      content: "OK.",
    },
  ];
  // let message = await openaiCompletion(prompt);
  for (let i = 0; i < gitSummary.length; i++) {
    gpt35turboMessages.push({
      role: "user",
      content: `section ${i + 1}: ${gitSummary[i]}`,
    });
    gpt35turboMessages.push({ role: "assistant", content: "OK." });
  }
  prompt =
    "ALL SECIONS SENDED, combine git diff sections and give me the commit message";
  gpt35turboMessages.push({ role: "user", content: prompt });
  // message = await openaiCompletion(prompt);
  let message = await openaiGpt35turboCompletion(gpt35turboMessages);
  const [print] = args;
  if (print) {
    console.log("=======COMMIT MESSAGE:");
    console.log(message);
    return;
  }

  const confirm = await prompts({
    type: "confirm",
    name: "value",
    message: `Suggested commit message: "${message}". Do you want to use it?`,
    initial: true,
  });

  if (confirm.value) {
    execSync(`git commit -m "${message}"`);
    console.log("Committed with the suggested message.");
  } else {
    console.log("Commit canceled.");
  }
};

export default gptCommit;
