import OpenAI from "openai";
import { CreateChatCompletionRequestMessage } from "openai/resources/chat";
import { getAllLinkedIssuesAndPullsInBody } from "../utils/get-issue-comments";
import { StreamlinedComment } from "../types/response";
import { Issue } from "@octokit/webhooks-types";
import { Context } from "../types/context";
import { addCommentToIssue } from "../utils/add-comment";

export const sysMsg = `
You are the UbiquityAI, a context aware Github assistant, designed to update issue specifications. \n
Based on the report you are given and the current state of the issue, you are to decide if the spec needs updating. \n

If changes are to be made ensure that the original spec is preserved and the new changes are clearly marked. \n
If a new issue is warranted, suggest it in the footnotes of the spec. \n

Maintain the current format and structure of the issue body, you are not to stylize and reformat the entire body, only update the spec if required. \n

Format your response using GitHub Flavored Markdown. Utilize tables, lists, and code blocks for clear and concise specifications. \n
`;

const contextMsg = `
Using the conversational context spanning the issue, linked issues and pull requests, you are to decide if the spec needs updating. \n

- More weight should be given to the comments from the issue author as they'll likely have the clearest vision. \n
- A spec should be updated only if the conversation warrants it, you are to use your best judgement. \n
- If you believe that the conversation warrants a new issue entirely, you are to suggest in the footnotes of the spec. \n
- A new issue is only warranted if the conversation implies changes that are wholly different from the original issue, within a reasonable extent. \n

Your response should aim to collect all of the relevant information from the conversation to make an informed decision. \n
That decision is not yours to make, just collect the information and present it in a report-like manner. \n

Example:

Based on the conversation, the issue spec should be updated to include the following: \n
...
This is because bob said this was needed and alice agreed. \n
...
it was implied here that changes to repo x was needed, so this may require a new issue. \n
...
`;

/**
 * @notice best used alongside getAllLinkedIssuesAndPullsInBody() in helpers/issue
 * @param chatHistory the conversational context to provide to GPT
 * @param streamlined an array of comments in the form of { login: string, body: string }
 * @param linkedPullStreamlined an array of comments in the form of { login: string, body: string }
 * @param linkedIssueStreamlined an array of comments in the form of { login: string, body: string }
 */
export async function gptDecideContext(
  context: Context,
  repository: Context["payload"]["repository"],
  issue: Context["payload"]["issue"] | Issue | undefined,
  streamlined: StreamlinedComment[],
  linkedPullStreamlined: StreamlinedComment[],
  linkedIssueStreamlined: StreamlinedComment[]
) {
  const logger = console;
  if (!issue) {
    logger.info(`Error getting issue or pr`);
    return;
  }

  const chatHistory: CreateChatCompletionRequestMessage[] = [];
  const issueAuthor = issue.user.login;

  streamlined.forEach(async (comment) => {
    if (comment.login === issueAuthor) comment.login = "author";
  });

  const links = await getAllLinkedIssuesAndPullsInBody(context, repository, issue.number);

  if (typeof links === "string" || !links) {
    logger.info(`Error getting linked issues or prs: ${links}`);
  } else {
    linkedIssueStreamlined = links.linkedIssues;
    linkedPullStreamlined = links.linkedPrs;
  }

  chatHistory.push(
    {
      role: "system",
      content: contextMsg,
    },
    {
      role: "user",
      content: "This issue/Pr context: \n" + JSON.stringify(streamlined),
    },
    {
      role: "assistant",
      content: "Are there any linked issues?",
    },
    {
      role: "user",
      content: "Linked issue(s) context: \n" + JSON.stringify(linkedIssueStreamlined),
    },
    {
      role: "assistant",
      content: "Are there any linked PRs?",
    },
    {
      role: "user",
      content: "Linked Pr(s) context: \n" + JSON.stringify(linkedPullStreamlined),
    },
    {
      role: "assistant",
      content: "Finally, what is the issue body?",
    },
    {
      role: "user",
      content: "Issue body: " + JSON.stringify(issue.body),
    }
  );

  // we'll use the first response to determine the context of future calls
  return await gptAsk(context, "", chatHistory);
}

/**
 * @notice base gptAsk function
 * @param question the question to ask
 * @param chatHistory the conversational context to provide to GPT
 */
export async function gptAsk(context: Context, question: string | null, chatHistory: CreateChatCompletionRequestMessage[]) {
  const {
    logger,
    config: {
      keys: { openAi },
    },
  } = context;
  if (!openAi) {
    logger.error(`No OpenAI API Key provided`);
    await addCommentToIssue(context, "```diff\n!No OpenAI API Key provided to the /reseach plugin.\n```");
    return;
  }

  const llm = new OpenAI({
    apiKey: openAi,
  });

  const res: OpenAI.Chat.Completions.ChatCompletion = await llm.chat.completions.create({
    messages: chatHistory,
    model: "gpt-3.5-turbo-16k",
    temperature: 0,
  });

  const answer = res.choices[0].message.content;

  console.log(answer);

  const tokenUsage = {
    output: res.usage?.completion_tokens,
    input: res.usage?.prompt_tokens,
    total: res.usage?.total_tokens,
  };

  if (!res) {
    console.info(`No answer found for question: ${question}`);
  }

  return { answer, tokenUsage };
}
