import { User } from "@octokit/webhooks-types";

export type StreamlinedComment = {
  login?: string;
  body?: string;
};

export type Comment = {
  url: string;
  html_url: string;
  issue_url: string;
  id: number;
  node_id: string;
  user: User;
  created_at: string;
  updated_at: string;
  author_association: string;
  body: string;
  body_html?: string;
  body_text?: string;
};

export enum UserType {
  User = "User",
}
