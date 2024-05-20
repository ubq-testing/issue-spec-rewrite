import { CreateChatCompletionRequestMessage } from "openai/resources";
import { Context } from "../types/context";
import { StreamlinedComment, UserType } from "../types/response";
import { getAllIssueComments, getAllLinkedIssuesAndPullsInBody } from "../utils/get-issue-comments";
import { gptAsk, gptDecideContext, sysMsg } from "./gpt";

export async function rewrite(context: Context) {
  const { payload } = context;
  const body = payload.comment.body;

  const regex = /^\/rewrite\s(.+)$/;
  const matches = body?.match(regex);

  if (matches) {
    return await processComment(context);
  }

  return "Invalid syntax for rewrite \n usage: '/rewrite What is pi?";
}

async function processComment(context: Context) {
  const { payload } = context;

  const issue = payload.issue;
  const repository = payload.repository;

  const chatHistory: CreateChatCompletionRequestMessage[] = [];
  const streamlined: StreamlinedComment[] = [];
  let linkedPullStreamlined: StreamlinedComment[] = [];
  let linkedIssueStreamlined: StreamlinedComment[] = [];

  const { logger } = context;
  const comments = await getAllIssueComments(context, repository, issue.number, "raw");

  if (!comments) {
    logger.info(`Error getting issue comments`);
  }

  comments?.forEach(async (comment) => {
    if (comment.user.type == UserType.User || comment.body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
      streamlined.push({
        login: comment.user.login,
        body: comment.body,
      });
    }
  });

  // returns the conversational context from all linked issues and prs
  const links = await getAllLinkedIssuesAndPullsInBody(context, repository, issue.number);

  if (typeof links === "string" || !links) {
    logger.info(`Error getting linked issues or prs: ${links}`);
  } else {
    linkedIssueStreamlined = links.linkedIssues;
    linkedPullStreamlined = links.linkedPrs;
  }

  const gptDecidedContext = await gptDecideContext(context, repository, issue, streamlined, linkedPullStreamlined, linkedIssueStreamlined);
  const issueBody = issue.body;

  chatHistory.push(
    {
      role: "system",
      content: sysMsg,
      name: "UbiquityAI",
    },
    {
      role: "user",
      content: "Report: " + JSON.stringify(gptDecidedContext?.answer), // provide the context
      name: "system",
    },
    {
      role: "assistant",
      content: "What is the current state of the issue?",
    },
    {
      role: "user",
      content: "Current body: " + issueBody,
      name: "user",
    }
  );

  const gptResponse = await gptAsk(context, issueBody, chatHistory);

  if (typeof gptResponse === "string") {
    return gptResponse;
  } else if (gptResponse?.answer) {
    return gptResponse.answer;
  } else {
    return "```diff\n!Error getting response from GPT```";
  }
}
