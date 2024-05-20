/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */

import { Comment, StreamlinedComment, UserType } from "../types/response";
import { Context } from "../types/context";

export async function getAllIssueComments(
  context: Context,
  repository: Partial<Context["payload"]["repository"]>,
  issueNumber: number,
  format: "raw" | "html" | "text" | "full" = "raw"
): Promise<Comment[] | undefined> {
  const { logger } = context;
  const result: Comment[] = [];
  let shouldFetch = true;
  let pageNumber = 1;

  if (!repository.owner || !repository.name) {
    logger.error(`Repository owner or name is missing`);
    return;
  }

  try {
    while (shouldFetch) {
      const response = await context.octokit.rest.issues.listComments({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: issueNumber,
        per_page: 100,
        page: pageNumber,
        mediaType: {
          format,
        },
      });

      if (response?.data?.length > 0) {
        const { data } = response;
        data.forEach((item: unknown) => {
          result.push(item as Comment);
        });
        pageNumber++;
      } else {
        shouldFetch = false;
      }
    }
  } catch (e: unknown) {
    shouldFetch = false;
  }

  return result;
}

async function getIssueByNumber(context: Context, repository: { owner: string; repo: string; issueNumber: number }) {
  const { owner, repo, issueNumber } = repository;
  const { logger } = context;
  try {
    const { data: issue } = await context.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return issue;
  } catch (e: unknown) {
    logger.error(`Fetching issue failed! reason: `, e);
    return;
  }
}

async function getPullByNumber(context: Context, repository: { owner: string; repo: string; issueNumber: number }) {
  const { owner, repo, issueNumber } = repository;
  const { logger } = context;
  try {
    const { data: pull } = await context.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: issueNumber,
    });
    return pull;
  } catch (error) {
    logger.error(`Fetching pull failed! reason: ${error}`);
    return;
  }
}

// Strips out all links from the body of an issue or pull request and fetches the conversational context from each linked issue or pull request
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function getAllLinkedIssuesAndPullsInBody(context: Context, repository: Context["payload"]["repository"], pullNumber: number) {
  const { logger } = context;

  const issue = await getIssueByNumber(context, {
    owner: repository.owner.login,
    repo: repository.name,
    issueNumber: pullNumber,
  });

  if (!issue) {
    return `Failed to fetch using issueNumber: ${pullNumber}`;
  }

  if (!issue.body) {
    return `No body found for issue: ${pullNumber}`;
  }

  const body = issue.body;
  const linkedPRStreamlined: StreamlinedComment[] = [];
  const linkedIssueStreamlined: StreamlinedComment[] = [];

  const regex = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+)/gi;
  const matches = body.match(regex);

  if (matches) {
    try {
      const linkedIssues: {
        owner: string;
        repo: string;
        issueNumber: number;
      }[] = [];
      const linkedPrs: {
        owner: string;
        repo: string;
        issueNumber: number;
      }[] = [];

      // this finds refs via all patterns: #<issue number>, full url or [#25](url.to.issue)
      const issueRef = issue.body.match(/(#(\d+)|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+))/gi);

      // if they exist, strip out the # or the url and push them to their arrays
      if (issueRef) {
        issueRef.forEach((issue) => {
          const [owner, repo, type, issueNumber] = issue.split("/").slice(-4);
          if (type === "issues") {
            linkedIssues.push({
              owner,
              repo,
              issueNumber: parseInt(issueNumber),
            });
          } else if (type === "pull") {
            linkedPrs.push({
              owner,
              repo,
              issueNumber: parseInt(issueNumber),
            });
          }
        });
      } else {
        logger.info(`No linked issues or prs found`);
      }

      if (linkedPrs.length > 0) {
        for (let i = 0; i < linkedPrs.length; i++) {
          const pr = await getPullByNumber(context, linkedPrs[i]);

          if (pr) {
            linkedPRStreamlined.push({
              login: "system",
              body: `=============== Pull Request #${pr.number}: ${pr.title} + ===============\n ${pr.body}}`,
            });

            const prComments = await getAllIssueComments(
              context,
              {
                owner: {
                  login: linkedPrs[i].owner,
                },
                name: linkedPrs[i].repo,
              },
              linkedPrs[i].issueNumber
            );

            if (!prComments) return;
            prComments.forEach(async (comment, i) => {
              if (comment.user.type == UserType.User || prComments[i].body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
                linkedPRStreamlined.push({
                  login: comment.user.login,
                  body: comment.body,
                });
              }
            });
          }
        }
      }

      if (linkedIssues.length > 0) {
        for (let i = 0; i < linkedIssues.length; i++) {
          const issue = await getIssueByNumber(context, linkedIssues[i]);
          if (issue) {
            linkedIssueStreamlined.push({
              login: "system",
              body: `=============== Issue #${issue.number}: ${issue.title} + ===============\n ${issue.body} `,
            });
            const issueComments = await getAllIssueComments(
              context,
              {
                owner: {
                  login: linkedIssues[i].owner,
                },
                name: linkedIssues[i].repo,
              },
              linkedIssues[i].issueNumber
            );

            if (!issueComments) return;

            issueComments.forEach(async (comment, i) => {
              if (comment.user.type == UserType.User || issueComments[i].body.includes("<!--- { 'UbiquityAI': 'answer' } --->")) {
                linkedIssueStreamlined.push({
                  login: comment.user.login,
                  body: comment.body,
                });
              }
            });
          }
        }
      }

      return {
        linkedIssues: linkedIssueStreamlined,
        linkedPrs: linkedPRStreamlined,
      };
    } catch (error) {
      logger.info(`Error getting linked issues or prs: ${error}`);
      return `Error getting linked issues or prs: ${error}`;
    }
  } else {
    logger.info(`No matches found`);
    return {
      linkedIssues: [],
      linkedPrs: [],
    };
  }
}
